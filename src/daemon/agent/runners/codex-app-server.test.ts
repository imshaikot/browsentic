import { describe, expect, test, vi } from 'vitest';
import type { ToolHost } from '../../tool-host';
import { codexRunner } from './codex';
import { streamContext, transcript } from './fixtures/support';
import { CONVERSATION_REFUSED, type Conversation, type StreamSink } from './types';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const schema = { type: 'object' as const, properties: {} };

const host = () => {
  const tools: ToolHost = {
    list: vi.fn(async () => ({
      tools: [
        { name: 'page_echo', description: 'Echo', inputSchema: schema },
        { name: 'page_shot', description: 'Shot', inputSchema: schema },
      ],
      withheld: [{ name: 'page_runCode', description: 'Run page code', inputSchema: schema }],
    })),
    call: vi.fn(async (name: string) =>
      name === 'page_shot'
        ? { content: [{ type: 'image' as const, data: PNG, mimeType: 'image/png' }, { type: 'text' as const, text: 'the shot' }] }
        : { content: [{ type: 'text' as const, text: 'echoed' }] },
    ),
  };
  return tools;
};

/** A conversation fed lines by hand: what it wrote to Codex, and what it told the run. */
function hold({ bin = 'codex', sessionId = null as string | null, transport = undefined as string | undefined } = {}) {
  const tools = host();
  const conversation = codexRunner.converse?.(
    streamContext({ bin, transport }, { sessionId, systemPrompt: 'You are Browsentic.', tools: async () => tools }),
  ) as Conversation;
  const written: Record<string, unknown>[] = [];
  const calls: unknown[][] = [];
  const record =
    (signal: keyof StreamSink) =>
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
  const io = { write: (message: unknown) => void written.push(message as Record<string, unknown>) };
  conversation?.open(io);
  const feed = async (...lines: (string | object)[]) => {
    for (const line of lines) {
      conversation.read(typeof line === 'string' ? line : JSON.stringify(line), sink, io);
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return { conversation, tools, written, calls, feed };
}

const recorded = transcript('codex', '0.155.1-app-server-turn.jsonl');
const response = (id: number) => recorded.find((line) => JSON.parse(line).id === id && !JSON.parse(line).method)!;
const sent = (written: Record<string, unknown>[], method: string) => written.find((message) => message.method === method);

describe('the handshake', () => {
  test("starts a thread with the browser tools as its own, the withheld ones out of sight, and every server of the user's switched off", async () => {
    const { written, feed } = hold({ bin: 'codex-handshake' });
    expect(written[0]).toMatchObject({ id: 1, method: 'initialize', params: { capabilities: { experimentalApi: true } } });
    await feed(response(1), response(2));
    const start = sent(written, 'thread/start')?.params as Record<string, unknown> & { config: object; dynamicTools: object[] };
    expect({
      initialized: written.some((message) => message.method === 'initialized'),
      sandbox: start.sandbox,
      approvals: start.approvalPolicy,
      prompt: String(start.developerInstructions).startsWith('You are Browsentic.') && String(start.developerInstructions).includes('# Your browser tools in Codex'),
      config: start.config,
      tools: start.dynamicTools,
    }).toEqual({
      initialized: true,
      sandbox: 'read-only',
      approvals: 'never',
      prompt: true,
      config: { 'mcp_servers.decoy.enabled': false },
      tools: [
        { type: 'function', name: 'page_echo', description: 'Echo', inputSchema: schema, deferLoading: false },
        { type: 'function', name: 'page_shot', description: 'Shot', inputSchema: schema, deferLoading: false },
        {
          type: 'namespace',
          name: 'browsentic',
          description: 'Browsentic tools that answer only once the user has switched them on for a message.',
          tools: [{ type: 'function', name: 'page_runCode', description: 'Run page code', inputSchema: schema, deferLoading: true }],
        },
      ],
    });
  });

  test('once the thread is named, the turn starts with the instruction', async () => {
    const { written, calls, feed } = hold({ bin: 'codex-named' });
    await feed(response(1), response(2), response(3));
    expect([calls[0], sent(written, 'turn/start')?.params]).toEqual([
      ['session', '01a0e2bc-4675-7451-bab0-c6b9d7740962'],
      { threadId: '01a0e2bc-4675-7451-bab0-c6b9d7740962', input: [{ type: 'text', text: 'what does this page cost', text_elements: [] }] },
    ]);
  });

  test('a resumed thread is resumed rather than started, and is sent no tools, which it kept from its start', async () => {
    const { written, tools, feed } = hold({ bin: 'codex-resume', sessionId: 'thread-1' });
    await feed(response(1), response(2));
    expect([sent(written, 'thread/resume')?.params, sent(written, 'thread/start'), vi.mocked(tools.list).mock.calls.length]).toEqual([
      expect.objectContaining({ threadId: 'thread-1', sandbox: 'read-only', approvalPolicy: 'never', config: { 'mcp_servers.decoy.enabled': false } }),
      undefined,
      0,
    ]);
  });
});

describe('a recorded turn', () => {
  test("answers each tool call through the run's own tools, streams the reply, and counts each request's tokens", async () => {
    const { written, tools, calls, feed } = hold({ bin: 'codex-turn' });
    await feed(...recorded);
    const answers = written.filter((message) => 'result' in message && !('method' in message));
    expect({
      called: vi.mocked(tools.call).mock.calls.map(([name]) => name),
      answers: answers.map((message) => [message.id, message.result]),
      said: calls.filter(([signal]) => signal === 'text').map(([, delta]) => delta).join(''),
      usage: calls.filter(([signal]) => signal === 'usage').map(([, usage]) => usage),
      end: calls.at(-1),
    }).toEqual({
      called: ['page_echo', 'page_shot'],
      answers: [
        [0, { contentItems: [{ type: 'inputText', text: 'echoed' }], success: true }],
        [1, { contentItems: [{ type: 'inputImage', imageUrl: `data:image/png;base64,${PNG}` }, { type: 'inputText', text: 'the shot' }], success: true }],
      ],
      said: 'It costs\ntwelve dollars.',
      usage: [
        { contextTokens: 110, outputTokens: 10 },
        { contextTokens: 110, outputTokens: 20 },
        { contextTokens: 3030, outputTokens: 50 },
      ],
      end: ['done', 'end_turn'],
    });
  });

  test('a message that came whole, without deltas, is said once when it completes', async () => {
    const { calls, feed } = hold({ bin: 'codex-whole' });
    await feed(response(1), response(2), response(3));
    const thread = '01a0e2bc-4675-7451-bab0-c6b9d7740962';
    await feed(
      { method: 'item/agentMessage/delta', params: { threadId: thread, itemId: 'm1', delta: 'It costs' } },
      { method: 'item/completed', params: { threadId: thread, item: { type: 'agentMessage', id: 'm1', text: 'It costs $12.' } } },
      { method: 'item/completed', params: { threadId: thread, item: { type: 'agentMessage', id: 'm2', text: 'Done.' } } },
    );
    expect(calls.filter(([signal]) => signal === 'text')).toEqual([
      ['text', 'It costs'],
      ['text', ' $12.'],
      ['text', 'Done.'],
    ]);
  });

  test("a sub-agent's thread says nothing to the panel, though its tool calls are still answered", async () => {
    const { calls, tools, feed } = hold({ bin: 'codex-sub-agent' });
    await feed(response(1), response(2), response(3));
    await feed(
      { method: 'item/agentMessage/delta', params: { threadId: 'child', itemId: 'm1', delta: 'thinking aloud' } },
      { id: 9, method: 'item/tool/call', params: { threadId: 'child', tool: 'page_echo', arguments: {} } },
    );
    expect([calls.filter(([signal]) => signal === 'text'), vi.mocked(tools.call).mock.calls.length]).toEqual([[], 1]);
  });

  test('a call the daemon cannot be reached for is answered as failed, not left waiting', async () => {
    const { written, tools, feed } = hold({ bin: 'codex-unreachable' });
    vi.mocked(tools.call).mockRejectedValueOnce(new Error('socket closed'));
    await feed({ id: 5, method: 'item/tool/call', params: { tool: 'page_echo', arguments: {} } });
    expect(written.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 5,
      result: { contentItems: [{ type: 'inputText', text: 'DAEMON_UNREACHABLE: Error: socket closed' }], success: false },
    });
  });

  test('a web search opens a row when it starts and closes it when it ends', async () => {
    const { calls, feed } = hold({ bin: 'codex-search' });
    await feed(response(1), response(2), response(3));
    const thread = '01a0e2bc-4675-7451-bab0-c6b9d7740962';
    await feed(
      { method: 'item/started', params: { threadId: thread, item: { type: 'webSearch', id: 'ws1' } } },
      { method: 'item/completed', params: { threadId: thread, item: { type: 'webSearch', id: 'ws1' } } },
    );
    expect(calls.slice(1)).toEqual([
      ['tool', 'ws1', 'web_search'],
      ['toolResult', 'ws1', true],
    ]);
  });

  test('anything else it asks of the client is declined, so it never waits on nobody', async () => {
    const { written, feed } = hold({ bin: 'codex-ask' });
    await feed({ id: 7, method: 'item/commandExecution/requestApproval', params: {} });
    expect(written.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32601, message: 'Browsentic does not answer item/commandExecution/requestApproval' },
    });
  });

  test('a failed turn fails with what Codex said', async () => {
    const { calls, feed } = hold({ bin: 'codex-failed' });
    await feed(response(1), response(2), response(3), {
      method: 'turn/completed',
      params: { threadId: '01a0e2bc-4675-7451-bab0-c6b9d7740962', turn: { status: 'failed', error: { message: 'You hit your usage limit.' } } },
    });
    expect(calls.at(-1)).toEqual(['fail', 'AGENT_FAILED', 'You hit your usage limit.']);
  });
});

describe('what stops a run', () => {
  const stopped = (what: string) =>
    `Codex ${what} in a run Browsentic keeps to the browser, so the run was stopped. Update Codex and Browsentic; if it persists, please report it.`;

  test('an MCP server starting, even before the thread is named', async () => {
    const { calls, feed } = hold({ bin: 'codex-mcp' });
    await feed(response(1), { method: 'mcpServer/startupStatus/updated', params: { threadId: 'any', name: 'decoy', status: 'starting' } });
    expect(calls).toEqual([['fail', 'AGENT_UNSAFE', stopped('started an MCP server')]]);
  });

  test('a shell command or a changed file', async () => {
    const shell = hold({ bin: 'codex-shell' });
    const patch = hold({ bin: 'codex-patch' });
    await shell.feed({ method: 'item/started', params: { item: { type: 'commandExecution', id: 'c1' } } });
    await patch.feed({ method: 'item/completed', params: { item: { type: 'fileChange', id: 'f1' } } });
    expect([shell.calls, patch.calls]).toEqual([
      [['fail', 'AGENT_UNSAFE', stopped('ran a shell command')]],
      [['fail', 'AGENT_UNSAFE', stopped('changed a file')]],
    ]);
  });
});

describe('a conversation Codex will not hold', () => {
  test("an app-server that will not start a session hands the turn back, and this Codex's later turns skip it", async () => {
    const { calls, feed } = hold({ bin: 'codex-old' });
    await feed({ id: 1, error: { code: -32600, message: 'unknown capability experimentalApi' } });
    expect([calls, hold({ bin: 'codex-old' }).conversation, hold({ bin: 'codex-other' }).conversation !== null]).toEqual([
      [['fail', CONVERSATION_REFUSED, 'its app-server would not start a session: unknown capability experimentalApi']],
      null,
      true,
    ]);
  });

  test('a thread start refused as unknown hands the turn back; refused for any other reason, the turn fails', async () => {
    const unknown = hold({ bin: 'codex-unknown-param' });
    const other = hold({ bin: 'codex-signed-out' });
    await unknown.feed(response(1), response(2), { id: 3, error: { code: -32602, message: 'unknown field dynamicTools' } });
    await other.feed(response(1), response(2), { id: 3, error: { code: -32000, message: 'Not signed in.' } });
    expect([unknown.calls.at(-1)?.[1], other.calls.at(-1)]).toEqual([CONVERSATION_REFUSED, ['fail', 'AGENT_FAILED', 'Not signed in.']]);
  });

  test('transport "exec" in config.json keeps Codex on exec', () => {
    expect(hold({ bin: 'codex-configured', transport: 'exec' }).conversation).toBeNull();
  });
});
