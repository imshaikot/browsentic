import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { AGENT_KINDS, AGENTS, type AgentKind } from '@/lib/agents/catalog';
import { stateDir } from '../../lockfile';
import type { AgentConfig, AgentSettings } from '../config';
import { MCP_RULE, settingsPath } from './antigravity';
import { agentState, grantRunner, mcpServerFor, RUNNERS, runnerFor } from './index';

const bin = join(stateDir, 'stub-bin');
const probes = join(stateDir, 'probes.log');

/**
 * A stand-in CLI that notes each version probe, then answers --version the given way. Only the
 * version probe is recorded: a runner's `check()` may call the binary again — Cursor asks it
 * whether it is signed in — and those are not what `rounds()` is counting.
 */
const stub = (name: string, { prints = `${name} 1.0.0`, exit = 0 } = {}) => {
  const path = join(bin, name);
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$1" in --version) echo ${name} >> "${probes}" ;; esac\necho "${prints}" >&2\nexit ${exit}\n`,
  );
  chmodSync(path, 0o755);
  return path;
};

/** The stubs probed so far, a round at a time. Every agent is probed at once, so each round is sorted. */
const rounds = () => {
  const lines = readFileSync(probes, 'utf8').split('\n').filter(Boolean);
  const size = AGENT_KINDS.length;
  return [lines.slice(0, size).sort(), lines.slice(size, size * 2).sort()].filter((round) => round.length);
};

const configWith = (agents: Partial<Record<AgentKind, AgentSettings>>, agent: AgentKind = 'claude'): AgentConfig => ({
  agent,
  agents: {
    claude: { bin: join(bin, 'claude') },
    codex: { bin: join(bin, 'codex') },
    antigravity: { bin: join(bin, 'agy') },
    vibe: { bin: join(bin, 'vibe') },
    grok: { bin: join(bin, 'grok') },
    cursor: { bin: join(bin, 'cursor-agent') },
    ...agents,
  },
  requireApproval: [],
});

const runner = async (kind: AgentKind, config: AgentConfig) =>
  (await agentState(config, { refresh: true })).runners.find((status) => status.kind === kind);

describe('the registry', () => {
  test('every agent in the catalog has a runner that answers to its name', () => {
    expect(AGENT_KINDS.map((kind) => RUNNERS[kind].kind)).toEqual([...AGENT_KINDS]);
  });

  test('the configured agent is the one that runs, with its own settings', () => {
    const config = configWith({ codex: { bin: '/opt/codex', model: 'gpt-5.4' } }, 'codex');
    expect(runnerFor(config)).toEqual({ runner: RUNNERS.codex, settings: { kind: 'codex', bin: '/opt/codex', model: 'gpt-5.4' } });
  });

  test("the MCP server an agent is handed is this CLI's own, serving MCP for that run", () => {
    const server = mcpServerFor('run-7');
    expect({ command: server.command, cli: basename(server.args[0]), args: server.args.slice(1), env: server.env }).toEqual({
      command: process.execPath,
      cli: 'cli.js',
      args: ['mcp'],
      env: { BROWSENTIC_AGENT_RUN: 'run-7' },
    });
  });
});

describe('readiness probes', () => {
  beforeAll(() => {
    mkdirSync(bin, { recursive: true });
    for (const name of ['claude', 'claude-next', 'codex', 'agy', 'vibe', 'grok', 'cursor-agent']) stub(name);
    stub('codex-expired', { prints: 'licence expired', exit: 3 });
  });

  beforeEach(() => {
    rmSync(probes, { force: true });
    rmSync(join(homedir(), '.gemini'), { recursive: true, force: true });
    rmSync(join(homedir(), '.grok'), { recursive: true, force: true });
    vi.stubEnv('XAI_API_KEY', '');
    vi.stubEnv('GROK_HOME', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('an installed agent is ready, with the version it printed', async () => {
    expect(await runner('claude', configWith({}))).toMatchObject({ ready: true, version: 'claude 1.0.0' });
  });

  test('an agent that is not installed is missing, with the command that installs it', async () => {
    expect(await runner('codex', configWith({ codex: { bin: join(bin, 'no-such-codex') } }))).toMatchObject({
      ready: false,
      problem: { code: 'AGENT_MISSING', fix: AGENTS.codex.install },
    });
  });

  test('an agent whose version check fails is unusable, and says what it printed', async () => {
    const expired = join(bin, 'codex-expired');
    expect((await runner('codex', configWith({ codex: { bin: expired } })))?.problem).toEqual({
      code: 'AGENT_UNUSABLE',
      message: `"${expired} --version" failed: licence expired.`,
      fix: AGENTS.codex.install,
    });
  });

  test('an installed agent that still needs setting up is not ready, and says why', async () => {
    expect(await runner('antigravity', configWith({}))).toMatchObject({
      ready: false,
      version: 'agy 1.0.0',
      problem: { code: 'AGENT_NEEDS_PERMISSION', grantable: true },
    });
  });

  test('a Grok Build nobody signed in to is not ready, and says how to sign in', async () => {
    expect(await runner('grok', configWith({}))).toMatchObject({
      ready: false,
      version: 'grok 1.0.0',
      problem: { code: 'AGENT_NEEDS_PERMISSION', fix: 'grok login' },
    });
  });

  test('a Grok Build that is signed in, or has an API key, is ready', async () => {
    const signedIn = join(homedir(), '.grok', 'auth.json');
    mkdirSync(dirname(signedIn), { recursive: true });
    writeFileSync(signedIn, '{}');
    const withLogin = await runner('grok', configWith({}));
    rmSync(signedIn);
    vi.stubEnv('XAI_API_KEY', 'xai-key');
    expect([withLogin?.ready, (await runner('grok', configWith({})))?.ready]).toEqual([true, true]);
  });

  test('probes are reused for half a minute, even when only the active agent changed', async () => {
    await agentState(configWith({}), { refresh: true });
    const again = await agentState(configWith({}, 'antigravity'));
    expect([rounds(), again.active]).toEqual([[['agy', 'claude', 'codex', 'cursor-agent', 'grok', 'vibe']], 'antigravity']);
  });

  test('asking for a refresh probes again', async () => {
    await agentState(configWith({}), { refresh: true });
    await agentState(configWith({}), { refresh: true });
    expect(rounds()).toHaveLength(2);
  });

  test('a different binary is probed afresh', async () => {
    await agentState(configWith({}), { refresh: true });
    await agentState(configWith({ claude: { bin: join(bin, 'claude-next') } }));
    expect(rounds()).toEqual([
      ['agy', 'claude', 'codex', 'cursor-agent', 'grok', 'vibe'],
      ['agy', 'claude-next', 'codex', 'cursor-agent', 'grok', 'vibe'],
    ]);
  });

  test('setting an agent up repairs it and forgets the stale probe', async () => {
    await agentState(configWith({}), { refresh: true });
    expect(await grantRunner('antigravity')).toBeNull();
    const state = await agentState(configWith({}));
    expect([JSON.parse(readFileSync(settingsPath, 'utf8')).permissions.allow, state.runners.find((status) => status.kind === 'antigravity')?.ready]).toEqual([
      [MCP_RULE],
      true,
    ]);
  });

  test('an agent with nothing to set up reports no problem', async () => {
    expect(await grantRunner('claude')).toBeNull();
  });
});
