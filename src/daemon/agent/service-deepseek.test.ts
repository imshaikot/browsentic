import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { RunEvent } from '@/lib/actions/protocol';
import { failure } from '@/lib/actions/protocol';
import { configPath } from './config';
import { stubCli } from './runners/fixtures/support';
import { AgentSession } from './service';

// The whole way a side-panel turn takes to DeepSeek Harness: the plan vetted and written, the CLI
// held over ACP with the run's browser server in its session, and its words back in the panel.
describe('a DeepSeek Harness turn', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('starts dsh on its patch in a home of its own, hands it the run’s browser server, and brings its answer back', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test');
    mkdirSync(dirname(configPath), { recursive: true });
    const heard = join(dirname(configPath), 'dsh-heard.log');
    rmSync(heard, { force: true });
    const bin = stubCli(
      join(dirname(configPath), 'dsh-acp'),
      `const fs = require('node:fs');
const note = (line) => fs.appendFileSync(${JSON.stringify(heard)}, JSON.stringify(line) + '\\n');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('0.2.1-rc.2'); process.exit(0); }
if (args.includes('--dump-config')) { process.stdout.write("- id: tool-bash\\n  name: '@deepseek-ai/dsh-tool-bash'\\n  disabled: true\\n"); process.exit(0); }
note({ args, home: process.env.DSH_HOME, sandbox: process.env.DSH_PERMISSION_MODE, files: fs.readdirSync(process.cwd()).sort() });
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  note({ method: message.method, mcpServers: message.params && message.params.mcpServers });
  if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } });
  if (message.method === 'session/new') send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'ds-1', configOptions: [] } });
  if (message.method === 'session/prompt') {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ds-1', update: { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'It costs $4.' } } } });
    send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
  }
});`,
    );
    writeFileSync(configPath, JSON.stringify({ agent: 'deepseek', agents: { deepseek: { bin } } }));
    const events: RunEvent[] = [];
    const session = new AgentSession({
      invoke: async () => failure('EXTENSION_OFFLINE', 'no browser'),
      emit: (_runId: string, event: RunEvent) => void events.push(event),
      draft: () => {},
      actionNames: () => [],
    });
    session.handle({ t: 'instruct', id: 'r1', text: 'what does this cost', context: { sessionId: 's1' } });
    // dsh starts the run's browser server while it opens the session, and the server lists its tools then.
    await vi.waitFor(() => expect(readFileSync(heard, 'utf8')).toContain('session/new'), { timeout: 15_000 });
    session.described('r1');
    await vi.waitFor(() => expect(events.some((event) => event.kind === 'done' || event.kind === 'error')).toBe(true), { timeout: 15_000 });

    expect(events.filter((event) => event.kind === 'error')).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'text', delta: 'It costs $4.' }));
    const said = readFileSync(heard, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(said[0]).toMatchObject({
      args: ['--profile', 'acp', '--patch', expect.stringMatching(/browsentic\.patch\.yml$/)],
      home: expect.stringMatching(/agents[\\/]deepseek[\\/]home$/),
      sandbox: 'read-only',
      files: ['AGENTS.md', 'browsentic.patch.yml'],
    });
    const opened = said.find((line) => line.method === 'session/new') as { mcpServers: { name: string; env: { name: string; value: string }[] }[] };
    expect(opened.mcpServers).toEqual([expect.objectContaining({ name: 'browsentic', env: expect.arrayContaining([{ name: 'BROWSENTIC_AGENT_RUN', value: 'r1' }]) })]);
  }, 30_000);
});
