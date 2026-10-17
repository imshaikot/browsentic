import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { RunEvent } from '@/lib/actions/protocol';
import { failure } from '@/lib/actions/protocol';
import { configPath } from './config';
import { stubCli } from './runners/fixtures/support';
import { AgentSession } from './service';

// OpenCode 2 connects MCP servers in the background and fixes each step's tool list as it sends it.
describe('a turn that waits for its tools', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('an OpenCode 2 turn is prompted only once its MCP server has listed the tools to it', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'zen-key');
    mkdirSync(dirname(configPath), { recursive: true });
    const heard = join(dirname(configPath), 'acp-heard.log');
    rmSync(heard, { force: true });
    const bin = stubCli(
      join(dirname(configPath), 'opencode-acp'),
      `const fs = require('node:fs');
if (process.argv[2] === '--version') { console.log('opencode v2.0.32'); process.exit(0); }
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(heard)}, message.method + '\\n');
  if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
  if (message.method === 'session/new') send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'ses_1', configOptions: [{ id: 'mode', currentValue: 'browsentic-contained' }] } });
  if (message.method === 'session/prompt') send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
});`,
    );
    writeFileSync(configPath, JSON.stringify({ agent: 'opencode', agents: { opencode: { bin } } }));
    const events: RunEvent[] = [];
    const waiting = new AgentSession({
      invoke: async () => failure('EXTENSION_OFFLINE', 'no browser'),
      emit: (_runId: string, event: RunEvent) => void events.push(event),
      draft: () => {},
      actionNames: () => [],
    });
    waiting.handle({ t: 'instruct', id: 'r1', text: 'what is on this page', context: { sessionId: 's1' } });
    const said = () => readFileSync(heard, 'utf8').trim().split('\n');
    await vi.waitFor(() => expect(said()).toContain('session/new'), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(said()).toEqual(['initialize', 'session/new']);

    waiting.described('r1');
    await vi.waitFor(() => expect(events.some((event) => event.kind === 'done')).toBe(true), { timeout: 5_000 });
    expect(said()).toEqual(['initialize', 'session/new', 'session/prompt']);
  }, 20_000);
});
