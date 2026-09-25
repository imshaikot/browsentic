import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { RunEvent } from '@/lib/actions/protocol';
import { AGENTS, type AgentKind } from '@/lib/agents/catalog';
import { describeContainment, sealEnv, sealedAway, sealingStream, vetPlan, type SpawnMode } from '../../guardrails';
import { configPath, type AgentSettings } from '../config';
import { stateDir } from '../../lockfile';
import { log } from '../../log';
import {
  RunError,
  type JsonContext,
  type Plan,
  type RunOutcome,
  type Runner,
  type StreamContext,
  type StreamSink,
} from './types';

const KILL_GRACE_MS = 5_000;

const STRIPPED = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'BROWSENTIC_AGENT_RUN'];

type Child = ChildProcessByStdio<Writable | null, Readable, Readable>;

/**
 * Vet, then spawn. Every run reaches the CLI through here, so this is where a plan that
 * has lost its containment is stopped — before the process exists, not after it has
 * been asked nicely to behave.
 */
export function launch(
  kind: AgentKind,
  mode: SpawnMode,
  settings: AgentSettings,
  plan: Plan,
  signal: AbortSignal,
): { child: Child; release: () => void; stop: () => void } {
  const problems = vetPlan(kind, mode, plan, stateDir);
  if (problems.length) {
    throw new RunError(
      'AGENT_UNSAFE',
      `Browsentic refused to start ${AGENTS[kind].label}: ${problems.join(' ')} This is a bug in Browsentic, not something you did — please report it.`,
    );
  }
  log(describeContainment(kind));

  mkdirSync(plan.cwd, { recursive: true, mode: 0o700 });
  for (const file of plan.files ?? []) {
    const path = join(plan.cwd, file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.content, { mode: 0o600 });
  }
  // The sweep ages a workspace by its folder's time, which rewriting a file already in it leaves
  // alone — so a conversation's folder would be swept a day after its first turn, not its last.
  const now = new Date();
  utimesSync(plan.cwd, now, now);

  const dropped = sealedAway(kind, process.env);
  if (dropped.length) log(`sealed ${dropped.length} credential-shaped variables out of the ${kind} environment`);
  const env = { ...childEnv(kind), ...plan.env };

  const child = spawn(settings.bin, plan.args, {
    cwd: plan.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as Child;

  const kill = () => {
    child.kill('SIGTERM');
    const hardKill = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    hardKill.unref();
  };
  if (signal.aborted) kill();
  else signal.addEventListener('abort', kill, { once: true });
  return { child, release: () => signal.removeEventListener('abort', kill), stop: kill };
}

/** The environment any process of this agent's CLI starts with, before a plan adds its own. */
export function childEnv(kind: AgentKind): NodeJS.ProcessEnv {
  const env = sealEnv(kind, process.env);
  for (const key of STRIPPED) delete env[key];
  return env;
}

function notInstalled(runner: Runner, settings: AgentSettings): RunError {
  const agent = AGENTS[runner.kind];
  return new RunError(
    'AGENT_MISSING',
    `Could not run "${settings.bin}" — ${agent.label} is not installed, or not on the daemon's PATH. ` +
      `Install it (${agent.install}), or set {"agents":{"${runner.kind}":{"bin":"/absolute/path/to/${agent.bin}"}}} ` +
      `in ${configPath}.`,
  );
}

function spawnError(runner: Runner, settings: AgentSettings, error: NodeJS.ErrnoException): RunError {
  return error.code === 'ENOENT' ? notInstalled(runner, settings) : new RunError('AGENT_FAILED', error.message);
}

export function runStream(
  runner: Runner,
  context: StreamContext,
  signal: AbortSignal,
  emit: (event: RunEvent) => void,
): Promise<RunOutcome> {
  const plan = runner.stream(context);
  const label = AGENTS[runner.kind].label;

  return new Promise<RunOutcome>((resolve, reject) => {
    const { child, release, stop } = launch(runner.kind, 'run', context.settings, plan, signal);

    let sessionId: string | null = null;
    let settled = false;
    let stderrTail = '';

    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      outcome();
    };

    // What the agent says reaches the user and the transcript, so it goes through the
    // same sanitizer page text does. Deltas split a credential across two writes, which
    // is why this holds back the tail of the stream rather than sealing each one.
    const outbound = sealingStream();
    const say = (delta: string) => delta && emit({ kind: 'text', delta });
    const flush = () => say(outbound.flush());

    const sink: StreamSink = {
      text: (delta) => delta && say(outbound.push(delta)),
      tool: (toolId, name) => emit({ kind: 'tool', toolId, action: name, input: {} }),
      session: (id) => {
        if (id) sessionId = id;
      },
      usage: (usage) => emit({ kind: 'usage', usage }),
      done: (stopReason) =>
        settle(() => {
          flush();
          resolve({ stopReason, sessionId });
        }),
      // A run the reader has failed is over, and its process would otherwise go on spending and acting.
      fail: (code, message) =>
        settle(() => {
          flush();
          stop();
          reject(new RunError(code, message));
        }),
    };

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
    });

    const read = runner.reader();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        read(line, sink);
      } catch (error) {
        log(`${runner.kind} runner could not read a stream line: ${String(error)}`);
      }
    });

    child.on('error', (error: NodeJS.ErrnoException) =>
      settle(() => reject(spawnError(runner, context.settings, error))),
    );

    child.on('close', (exitCode) => {
      release();
      if (settled) return;
      if (signal.aborted) return settle(() => reject(new RunError('CANCELLED', 'Run cancelled.')));
      if (runner.endsOnExit && exitCode === 0) return sink.done('end_turn');
      const hint = runner.hint?.(stderrTail);
      settle(() =>
        reject(
          new RunError(
            'AGENT_FAILED',
            hint ?? `${label} exited with code ${exitCode} before finishing${tail(stderrTail)}`,
          ),
        ),
      );
    });
  });
}

export interface JsonOptions {
  timedOut: string;
  empty: string;
  /** A complete answer ends the task there and then: the CLI is stopped rather than waited out. */
  accept?: (text: string) => boolean;
}

export function runJson(
  runner: Runner,
  context: JsonContext,
  signal: AbortSignal,
  { timedOut, empty, accept }: JsonOptions,
): Promise<string> {
  const plan = runner.json(context);
  const label = AGENTS[runner.kind].label;

  return new Promise<string>((resolve, reject) => {
    const { child, release, stop } = launch(runner.kind, 'task', context.settings, plan, signal);
    let stdout = '';
    let stderrTail = '';
    let settled = false;

    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      release();
      outcome();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!accept || settled) return;
      const text = runner.answer(stdout).text?.trim();
      if (text && accept(text)) {
        settle(() => {
          stop();
          resolve(text);
        });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
    });

    child.on('error', (error: NodeJS.ErrnoException) => settle(() => reject(spawnError(runner, context.settings, error))));

    child.on('close', () =>
      settle(() => {
        if (signal.aborted) return reject(signal.reason instanceof RunError ? signal.reason : new RunError('TIMEOUT', timedOut));
        const answer = runner.answer(stdout);
        if (answer.error) return reject(new RunError('AGENT_FAILED', answer.error));
        const text = answer.text?.trim();
        if (!text) {
          const hint = runner.hint?.(stderrTail);
          return reject(new RunError('AGENT_FAILED', hint ?? (stderrTail.trim() ? `${label}: ${stderrTail.trim()}` : empty)));
        }
        resolve(text);
      }),
    );
  });
}

const tail = (stderr: string) => (stderr.trim() ? `: ${stderr.trim()}` : '');
