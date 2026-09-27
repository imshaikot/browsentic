import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { RunEvent } from '@/lib/actions/protocol';
import { AGENTS, type AgentKind } from '@/lib/agents/catalog';
import { describeContainment, sealEnv, sealedAway, sealingStream, vetPlan, type SpawnMode } from '../../guardrails';
import { configPath, type AgentSettings } from '../config';
import { stateDir } from '../../lockfile';
import { log } from '../../log';
import { spawnCli, stopTree, type CliProcess } from './command';
import { installHint } from './util';
import {
  CONVERSATION_REFUSED,
  RunError,
  type Conversation,
  type ConversationIO,
  type JsonContext,
  type Plan,
  type RunOutcome,
  type Runner,
  type StreamContext,
  type StreamSink,
} from './types';

const KILL_GRACE_MS = 5_000;

const STRIPPED = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'BROWSENTIC_AGENT_RUN'];

/** What a plan is spawned with: stdin stays closed unless the CLI is held in a conversation over it. */
type Stdin = 'ignore' | 'pipe';

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
  stdin: Stdin = 'ignore',
): { child: CliProcess; release: () => void; stop: () => void } {
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

  const child = spawnCli(settings.bin, plan.args, { cwd: plan.cwd, env, stdin: plan.input === undefined ? stdin : 'pipe' });
  // A CLI that is gone before it has read its stdin fails the write, and that must not take the daemon with it.
  child.stdin?.on('error', (error) => log(`${kind} stopped reading its stdin: ${error.message}`));
  if (plan.input !== undefined) child.stdin?.end(plan.input);

  const kill = () => {
    stopTree(child, 'SIGTERM');
    const hardKill = setTimeout(() => stopTree(child, 'SIGKILL'), KILL_GRACE_MS);
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
      `Install it (${installHint(runner.kind)}), or set {"agents":{"${runner.kind}":{"bin":"/absolute/path/to/${agent.bin}"}}} ` +
      `in ${configPath}.`,
  );
}

function spawnError(runner: Runner, settings: AgentSettings, error: NodeJS.ErrnoException): RunError {
  return error.code === 'ENOENT' ? notInstalled(runner, settings) : new RunError('AGENT_FAILED', error.message);
}

/**
 * A turn, through the conversation the runner offers when it has one. A conversation the CLI will
 * not hold — an older build, a handshake it refuses — is dropped before anything reached the user,
 * and the same turn goes through the runner's plain stream instead.
 */
export async function runStream(
  runner: Runner,
  context: StreamContext,
  signal: AbortSignal,
  emit: (event: RunEvent) => void,
): Promise<RunOutcome> {
  const conversation = runner.converse?.(context);
  if (conversation) {
    try {
      return await drive(runner, context, conversation.plan, signal, emit, conversation);
    } catch (error) {
      if (!(error instanceof RunError) || error.code !== CONVERSATION_REFUSED) throw error;
      log(`${runner.kind} would not hold a conversation (${error.message}); running this turn from its plan instead`);
    }
  }
  return drive(runner, context, runner.stream(context), signal, emit);
}

function drive(
  runner: Runner,
  context: StreamContext,
  plan: Plan,
  signal: AbortSignal,
  emit: (event: RunEvent) => void,
  conversation?: Conversation,
): Promise<RunOutcome> {
  const label = AGENTS[runner.kind].label;
  const mode = conversation ? 'conversation' : 'run';

  return new Promise<RunOutcome>((resolve, reject) => {
    const { child, release, stop } = launch(runner.kind, mode, context.settings, plan, signal, conversation ? 'pipe' : 'ignore');

    let sessionId: string | null = null;
    let settled = false;
    let stderrTail = '';

    const io: ConversationIO = {
      write: (message) => {
        if (child.stdin?.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
      },
    };

    // A conversation ends when its stdin does; the CLI is asked to go, and stopped if it lingers.
    const hangUp = () => {
      if (!conversation || !child.stdin) return;
      child.stdin.end();
      const lingering = setTimeout(stop, KILL_GRACE_MS);
      lingering.unref();
      child.once('close', () => clearTimeout(lingering));
    };

    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      outcome();
      hangUp();
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
      toolResult: (toolId, ok) => emit({ kind: 'toolResult', toolId, ok, summary: ok ? 'done' : 'failed' }),
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

    const reader = runner.reader();
    const read = (line: string) => (conversation ? conversation.read(line, sink, io) : reader(line, sink));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      try {
        read(line);
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
      if (conversation && !conversation.holding) {
        const reason = `it exited with code ${exitCode}${tail(stderrTail)}`;
        conversation.declined(reason);
        return settle(() => reject(new RunError(CONVERSATION_REFUSED, reason)));
      }
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

    conversation?.open(io);
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
