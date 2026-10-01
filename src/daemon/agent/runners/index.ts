import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENTS,
  AGENT_KINDS,
  type AgentKind,
  type AgentProblem,
  type AgentState,
  type RunnerStatus,
} from '@/lib/agents/catalog';
import { activeAgent, configPath, type AgentConfig, type AgentSettings } from '../config';
import { log } from '../../log';
import { antigravityRunner } from './antigravity';
import { claudeRunner } from './claude';
import { codexRunner } from './codex';
import { spawnCli, stopTree, type CliProcess } from './command';
import { cursorRunner } from './cursor';
import { grokRunner } from './grok';
import { modelsFor, refreshModels } from './models';
import { opencodeRunner } from './opencode';
import { qwenRunner } from './qwen';
import type { CallLimits, McpServer, Runner } from './types';
import { installHint } from './util';
import { vibeRunner } from './vibe';

export const RUNNERS: Record<AgentKind, Runner> = {
  claude: claudeRunner,
  codex: codexRunner,
  antigravity: antigravityRunner,
  vibe: vibeRunner,
  grok: grokRunner,
  cursor: cursorRunner,
  qwen: qwenRunner,
  opencode: opencodeRunner,
};

const cliPath = join(dirname(fileURLToPath(import.meta.url)), 'cli.js');

/**
 * The stdio MCP server every agent talks to — this same package, pointed back at the daemon.
 *
 * The `mcp` argument is load-bearing. Bare invocation only serves MCP when the binary was
 * called as `browsentic-mcp`; called any other way it prints help, which an agent would read
 * as a broken handshake. BROWSENTIC_AGENT_RUN separately forces serving, so this is belt and
 * braces, but the explicit argument is the one that says what is meant.
 *
 * A CLI that keeps long results from the model has its limit passed on, so the server refuses
 * what would be kept rather than sending it.
 */
export function mcpServerFor(runId: string, limits?: CallLimits): McpServer {
  const env: Record<string, string> = { BROWSENTIC_AGENT_RUN: runId };
  if (limits?.resultBytes) env.BROWSENTIC_RESULT_BYTES = String(limits.resultBytes);
  return { command: process.execPath, args: [cliPath, 'mcp'], env };
}

export interface SelectedRunner {
  runner: Runner;
  settings: AgentSettings;
}

export function runnerFor(config: AgentConfig): SelectedRunner {
  const active = activeAgent(config);
  return { runner: RUNNERS[active.kind], settings: active };
}

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_TTL_MS = 30_000;

let cached: { at: number; signature: string; state: AgentState } | null = null;

export async function agentState(config: AgentConfig, { refresh = false } = {}): Promise<AgentState> {
  const signature = JSON.stringify(config.agents);
  if (!refresh && cached && cached.signature === signature && Date.now() - cached.at < PROBE_TTL_MS) {
    return { ...cached.state, active: config.agent };
  }
  const runners = await Promise.all(AGENT_KINDS.map((kind) => probe(RUNNERS[kind], config.agents[kind])));
  const state: AgentState = { active: config.agent, runners };
  cached = { at: Date.now(), signature, state };
  return state;
}

function forgetProbes(): void {
  cached = null;
}

/**
 * Re-reads the model lists that are due, for every installed agent, or only the one named. One still
 * to be set up is read too, so its list is there the moment it is. Resolves to whether any list the
 * picker shows changed — the caller's cue to push the state again.
 */
export async function refreshModelLists(
  config: AgentConfig,
  { force = false, only }: { force?: boolean; only?: AgentKind } = {},
): Promise<boolean> {
  const state = await agentState(config);
  const reads = state.runners
    .filter((status) => (status.ready || status.problem?.code === 'AGENT_NEEDS_PERMISSION') && (!only || status.kind === only))
    .map((status) => refreshModels(RUNNERS[status.kind], config.agents[status.kind], status.version, { force }));
  const changed = (await Promise.all(reads)).some(Boolean);
  // A forced read restamps the list even when it came back the same, and the next state should say so.
  if (changed || force) forgetProbes();
  return changed;
}

export async function grantRunner(kind: AgentKind): Promise<AgentProblem | null> {
  const problem = (await RUNNERS[kind].grant?.()) ?? null;
  forgetProbes();
  if (problem) log(`could not set up ${AGENTS[kind].label}: ${problem.message}`);
  else log(`${AGENTS[kind].label} is set up`);
  return problem;
}

async function probe(runner: Runner, settings: AgentSettings): Promise<RunnerStatus> {
  const agent = AGENTS[runner.kind];
  const found = await version(settings.bin, runner.versionArgs);

  if (found.code === 'ENOENT') {
    return {
      kind: runner.kind,
      bin: settings.bin,
      model: settings.model,
      ready: false,
      problem: {
        code: 'AGENT_MISSING',
        message: `${agent.label} is not installed, or "${settings.bin}" is not on the daemon's PATH.`,
        fix: installHint(runner.kind),
      },
    };
  }
  if (found.code === 'AGENT_UNUSABLE') {
    return {
      kind: runner.kind,
      bin: settings.bin,
      model: settings.model,
      ready: false,
      problem: {
        code: 'AGENT_UNUSABLE',
        message: found.detail ?? `"${settings.bin}" could not be started.`,
        fix: `{"agents":{"${runner.kind}":{"bin":"<the program itself>"}}} in ${configPath}`,
      },
    };
  }
  if (!found.ok) {
    return {
      kind: runner.kind,
      bin: settings.bin,
      model: settings.model,
      ready: false,
      problem: {
        code: 'AGENT_UNUSABLE',
        message: `"${settings.bin} ${runner.versionArgs.join(' ')}" failed${found.detail ? `: ${found.detail}` : ''}.`,
        fix: installHint(runner.kind),
      },
    };
  }

  const problem = (await runner.check?.(settings)) ?? null;
  return {
    kind: runner.kind,
    bin: settings.bin,
    model: settings.model,
    ready: !problem,
    version: found.detail,
    models: modelsFor(runner.kind),
    problem: problem ?? undefined,
  };
}

interface Found {
  ok: boolean;
  code?: string;
  detail?: string;
}

function version(bin: string, args: string[]): Promise<Found> {
  let child: CliProcess;
  try {
    child = spawnCli(bin, args);
  } catch (error) {
    // One agent that cannot be started must not take the others' answers down with it.
    return Promise.resolve({ ok: false, code: (error as { code?: string }).code, detail: (error as Error).message });
  }
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const done = (result: Found) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      stopTree(child, 'SIGKILL');
      done({ ok: false, detail: 'timed out' });
    }, PROBE_TIMEOUT_MS);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error: NodeJS.ErrnoException) => done({ ok: false, code: error.code, detail: error.message }));
    child.on('close', (exitCode) => done({ ok: exitCode === 0, detail: firstLine(output) }));
  });
}

function firstLine(output: string): string | undefined {
  const line = output
    .split('\n')
    .map((text) => text.trim())
    .find(Boolean);
  return line ? line.slice(0, 80) : undefined;
}
