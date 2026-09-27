import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import type { AgentKind } from '@/lib/agents/catalog';
import { stateDir } from '../../../lockfile';
import type { AgentSettings } from '../../config';
import type { JsonContext, Listing, McpServer, Plan, Runner, StreamContext, StreamSink } from '../types';

export type Signal = keyof StreamSink;
export type Call = [Signal, ...unknown[]];

/**
 * A stand-in CLI at `path` that runs the Node `script` with whatever arguments it is started with.
 * On Windows it is a batch shim of the shape npm writes, so a stub there is started the way an
 * npm-installed CLI is; elsewhere it is a shell script that hands over to Node.
 */
export function stubCli(path: string, script: string): string {
  const js = `${path}.js`;
  writeFileSync(js, script);
  if (process.platform === 'win32') {
    writeFileSync(`${path}.cmd`, `@ECHO off\r\n"${process.execPath}"  "%~dp0\\${basename(js)}" %*\r\n`);
  } else {
    writeFileSync(path, `#!/bin/sh\nexec '${process.execPath}' '${js}' "$@"\n`);
    chmodSync(path, 0o755);
  }
  return path;
}

export function transcript(agent: AgentKind, name: string): string[] {
  return readFileSync(new URL(`./${agent}/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'));
}

/** A recorded `models` listing: stdout, then stderr after a `# stderr` line, and the code from `# exit`. */
export function listing(agent: AgentKind, name: string): Listing {
  const streams = { stdout: [] as string[], stderr: [] as string[] };
  let into: keyof typeof streams = 'stdout';
  let code = 0;
  for (const line of readFileSync(new URL(`./${agent}/${name}`, import.meta.url), 'utf8').split('\n')) {
    const exit = /^# exit (\d+)$/.exec(line);
    if (exit) code = Number(exit[1]);
    else if (line === '# stderr') into = 'stderr';
    else if (!line.startsWith('#')) streams[into].push(line);
  }
  return { stdout: streams.stdout.join('\n'), stderr: streams.stderr.join('\n'), code };
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
    toolResult: record('toolResult'),
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
  conversation: 'conversation-1',
  instruction: 'what does this page cost',
  systemPrompt: 'You are Browsentic.',
  research: false,
  settings,
  sessionId: null,
  workspace: stateDir,
  mcp,
  mcpTools: ['page_getPageInfo', 'page_clickElement', 'browsentic_status'],
  tools: () => Promise.reject(new Error('no browser tools in a runner test')),
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
  // Each string is rewritten before it is escaped as JSON, where a Windows path's backslashes are doubled.
  const text = JSON.stringify(plan, (key, value: unknown) =>
    typeof value === 'string' ? portable(key, value.replaceAll(stateDir, '<state>').replaceAll(homedir(), '<home>')) : value,
  ).replace(UUID, '<uuid>');
  return JSON.parse(text) as Plan;
}

/** A workspace file's path, and any path under a placeholder, read the same on every platform. */
function portable(key: string, value: string): string {
  if (process.platform !== 'win32') return value;
  if (key === 'path') return value.replaceAll('\\', '/');
  return value.replace(/<(state|home)>[^"\s]*/g, (path) => path.replaceAll('\\', '/'));
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
