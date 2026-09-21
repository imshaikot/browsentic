import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { AgentKind } from '@/lib/agents/catalog';
import { stateDir } from '../../../lockfile';
import type { AgentSettings } from '../../config';
import type { JsonContext, McpServer, Plan, Runner, StreamContext, StreamSink } from '../types';

export type Signal = keyof StreamSink;
export type Call = [Signal, ...unknown[]];

export function transcript(agent: AgentKind, name: string): string[] {
  return readFileSync(new URL(`./${agent}/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'));
}

/** Every sink call a fresh reader makes for these lines, in order. */
export function readThrough(runner: Runner, lines: string[], only?: Signal): Call[] {
  const calls: Call[] = [];
  const record =
    (signal: Signal) =>
    (...args: unknown[]) =>
      void calls.push([signal, ...args]);
  const sink: StreamSink = {
    text: record('text'),
    tool: record('tool'),
    session: record('session'),
    usage: record('usage'),
    done: record('done'),
    fail: record('fail'),
  };
  const reader = runner.reader();
  for (const line of lines) reader(line, sink);
  return only ? calls.filter(([signal]) => signal === only) : calls;
}

// A fixed server rather than mcpServerFor(), whose node path differs on every machine.
const mcp: McpServer = {
  command: '/usr/local/bin/node',
  args: ['/usr/local/lib/node_modules/browsentic/dist/cli.js', 'mcp'],
  env: { BROWSENTIC_AGENT_RUN: 'run-1' },
};

export const streamContext = (settings: AgentSettings, overrides: Partial<StreamContext> = {}): StreamContext => ({
  runId: 'run-1',
  instruction: 'what does this page cost',
  systemPrompt: 'You are Browsentic.',
  research: false,
  settings,
  sessionId: null,
  workspace: stateDir,
  mcp,
  ...overrides,
});

export const jsonContext = (settings: AgentSettings, overrides: Partial<JsonContext> = {}): JsonContext => ({
  prompt: 'summarize this',
  settings,
  workspace: stateDir,
  reads: false,
  ...overrides,
});

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** A plan as a snapshot shows it: the sandbox's paths and any freshly minted id replaced by names. */
export function shown(plan: Plan): Plan {
  const text = JSON.stringify(plan).replaceAll(stateDir, '<state>').replaceAll(homedir(), '<home>').replace(UUID, '<uuid>');
  return JSON.parse(text) as Plan;
}

/** The value a flag takes, or undefined when the flag is absent. */
export function valueOf(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

/** The values a variadic flag takes, up to the next flag. */
export function valuesOf(args: string[], flag: string): string[] {
  const at = args.indexOf(flag);
  if (at === -1) return [];
  const values: string[] = [];
  for (let i = at + 1; i < args.length && !args[i].startsWith('--'); i++) values.push(args[i]);
  return values;
}
