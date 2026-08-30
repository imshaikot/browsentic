import { spawn } from 'node:child_process';
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
import { activeAgent, type AgentConfig, type AgentSettings } from '../config';
import { log } from '../../log';
import { antigravityRunner } from './antigravity';
import { claudeRunner } from './claude';
import { codexRunner } from './codex';
import type { McpServer, Runner } from './types';

export const RUNNERS: Record<AgentKind, Runner> = {
  claude: claudeRunner,
  codex: codexRunner,
  antigravity: antigravityRunner,
};

const cliPath = join(dirname(fileURLToPath(import.meta.url)), 'cli.js');

/**
 * The stdio MCP server every agent talks to — this same package, pointed back at the daemon.
 *
 * The `mcp` argument is load-bearing. Bare invocation only serves MCP when the binary was
 * called as `browsentic-mcp`; called any other way it prints help, which an agent would read
 * as a broken handshake. BROWSENTIC_AGENT_RUN separately forces serving, so this is belt and
 * braces, but the explicit argument is the one that says what is meant.
 */
export function mcpServerFor(runId: string): McpServer {
  return { command: process.execPath, args: [cliPath, 'mcp'], env: { BROWSENTIC_AGENT_RUN: runId } };
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
        fix: agent.install,
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
        fix: agent.install,
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
    problem: problem ?? undefined,
  };
}

function version(bin: string, args: string[]): Promise<{ ok: boolean; code?: string; detail?: string }> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const done = (result: { ok: boolean; code?: string; detail?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
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
