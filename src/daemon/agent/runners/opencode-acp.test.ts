import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { opencodeRunner, signInLine } from './opencode';
import { streamContext, transcript, type Call } from './fixtures/support';
import type { Conversation, StreamContext, StreamSink } from './types';

const V2 = 'opencode v2.0.32';
const SESSION = 'ses_eb66f4f81ffeKv3ZUQKMU5Z0Jv';

interface Written {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number };
}

const frames = (name: string) => transcript('opencode', `2.0.32-acp-${name}.jsonl`);
const answerTo = (name: string, id: number) => frames(name).find((line) => (JSON.parse(line) as Written).id === id) as string;
const notices = (name: string) => frames(name).filter((line) => (JSON.parse(line) as Written).method === 'session/update');

/** The session the `turn` recording opened, as a different `mode` or model would have it. */
function opened(change: (options: { id: string; currentValue: string; options: { value: string }[] }[]) => void, sessionId = SESSION): string {
  const message = JSON.parse(answerTo('turn', 3)) as { result: { sessionId: string; configOptions: Parameters<typeof change>[0] } };
  change(message.result.configOptions);
  message.result.sessionId = sessionId;
  return JSON.stringify(message);
}

function holding(overrides: Partial<StreamContext> = {}) {
  let listTools = () => {};
  const listed = new Promise<void>((resolve) => (listTools = resolve));
  const written: Written[] = [];
  const calls: Call[] = [];
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
  const io = { write: (message: unknown) => void written.push(message as Written) };
  const conversation = opencodeRunner.converse?.(
    streamContext({ bin: 'opencode' }, { version: V2, toolsListed: () => listed, ...overrides }),
  ) as Conversation;
  conversation.open(io);
  return {
    conversation,
    written,
    calls,
    listTools,
    feed: (...lines: string[]) => lines.forEach((line) => conversation.read(line, sink, io)),
    asked: (method: string) => written.filter((message) => message.method === method),
    failed: () => calls.filter(([signal]) => signal === 'fail'),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('opening a session', () => {
  test('a new session is asked for with no MCP server of its own, which the config already names', () => {
    const turn = holding();
    turn.feed(answerTo('turn', 1));
    expect(turn.asked('session/new')).toEqual([
      { jsonrpc: '2.0', id: 3, method: 'session/new', params: { cwd: turn.conversation.plan.cwd, mcpServers: [] } },
    ]);
  });

  // `session/load` would replay the whole history to the panel first.
  test('a held session is resumed, and one this database never had is opened afresh', () => {
    const turn = holding({ sessionId: 'ses_0000000000000000000000000' });
    turn.feed(answerTo('turn', 1));
    expect(turn.asked('session/resume')[0].params).toMatchObject({ sessionId: 'ses_0000000000000000000000000', mcpServers: [] });
    turn.feed(answerTo('resume-missing', 2));
    expect(turn.asked('session/new')).toHaveLength(1);
    expect(turn.failed()).toEqual([]);
  });

  test('a session opened in any agent but the contained one stops the run', () => {
    const turn = holding();
    const inBuild = opened((options) => {
      for (const option of options) if (option.id === 'mode') option.currentValue = 'build';
    });
    turn.feed(answerTo('turn', 1), inBuild);
    expect(turn.failed()).toEqual([['fail', 'AGENT_UNSAFE', expect.stringContaining('"build" agent')]]);
    expect(turn.conversation.holding).toBe(false);
  });

  test('an OpenCode with no ACP server is turned down, so later turns go through run', () => {
    const turn = holding({ settings: { bin: '/opt/opencode-no-acp' } });
    turn.feed(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }));
    expect(turn.failed()).toEqual([['fail', 'CONVERSATION_REFUSED', expect.stringContaining('Method not found')]]);
    expect(opencodeRunner.converse?.(streamContext({ bin: '/opt/opencode-no-acp' }, { version: V2 }))).toBeNull();
  });
});

describe('waiting for the browser tools', () => {
  // OpenCode connects MCP servers in the background and fixes each step's tools as it is sent.
  test('the prompt goes only once the run’s tools have reached OpenCode and it has had time to list them', async () => {
    const turn = holding();
    turn.feed(answerTo('turn', 1), answerTo('turn', 3));
    expect(turn.calls).toEqual([['session', SESSION]]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(turn.asked('session/prompt')).toEqual([]);
    turn.listTools();
    await vi.advanceTimersByTimeAsync(599);
    expect(turn.asked('session/prompt')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(turn.asked('session/prompt')).toEqual([
      { jsonrpc: '2.0', id: 6, method: 'session/prompt', params: { sessionId: SESSION, prompt: [{ type: 'text', text: 'what does this page cost' }] } },
    ]);
  });

  test('tools that never arrive end the turn rather than leave the model without them', async () => {
    const turn = holding();
    turn.feed(answerTo('turn', 1), answerTo('turn', 3));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(turn.failed()).toEqual([['fail', 'AGENT_FAILED', expect.stringContaining("could not start Browsentic's browser tools")]]);
    expect(turn.asked('session/prompt')).toEqual([]);
  });
});

describe('choosing the model and the effort', () => {
  // A model OpenCode does not know is swapped for another without a word.
  test('a pinned model it offers is asked for by name, and one it does not stops the turn with some it does', () => {
    const pinned = holding({ settings: { bin: 'opencode', model: 'opencode/big-pickle' } });
    pinned.feed(answerTo('turn', 1), answerTo('turn', 3));
    expect(pinned.asked('session/set_config_option')).toEqual([
      { jsonrpc: '2.0', id: 4, method: 'session/set_config_option', params: { sessionId: SESSION, configId: 'model', value: 'opencode/big-pickle' } },
    ]);
    const missing = holding({ settings: { bin: 'opencode', model: 'nowhere/model-x' } });
    missing.feed(answerTo('turn', 1), answerTo('turn', 3));
    expect(missing.failed()).toEqual([['fail', 'AGENT_FAILED', expect.stringMatching(/no model "nowhere\/model-x".*It offers mock\/m1, /)]]);
  });

  test('the model it already has is not asked for again', () => {
    const turn = holding({ settings: { bin: 'opencode', model: 'mock/m1' } });
    turn.feed(answerTo('turn', 1), answerTo('turn', 3));
    expect(turn.asked('session/set_config_option')).toEqual([]);
  });

  // 2.x refuses a run asking for an effort the model lacks, so only one it lists is asked for.
  test('an effort the model offers is set, and one it lacks is left out', async () => {
    const high = holding({ settings: { bin: 'opencode', effort: 'high' } });
    high.feed(answerTo('turn', 1), answerTo('turn', 3));
    expect(high.asked('session/set_config_option').map((message) => message.params)).toEqual([{ sessionId: SESSION, configId: 'effort', value: 'high' }]);
    const unknown = holding({ settings: { bin: 'opencode', effort: 'max' } });
    unknown.feed(answerTo('turn', 1), answerTo('turn', 3));
    unknown.listTools();
    await vi.advanceTimersByTimeAsync(600);
    expect([unknown.asked('session/set_config_option'), unknown.asked('session/prompt').length]).toEqual([[], 1]);
  });
});

describe('a turn', () => {
  const through = (name: string) => {
    const turn = holding();
    turn.feed(answerTo(name, 1), answerTo(name, 3), ...notices(name));
    const end = answerTo(name, 6);
    if (end) turn.feed(end);
    return turn.calls.filter(([signal]) => signal !== 'session');
  };

  test('says its words, leaves the browser call to the daemon, and ends with what it spent', () => {
    expect(through('turn')).toEqual([
      ['text', 'The page is Example Domain.'],
      ['usage', { contextTokens: 1230, outputTokens: 60 }],
      ['done', 'end_turn'],
    ]);
  });

  test("a research run's web fetch is drawn and closed", () => {
    expect(through('web').filter(([signal]) => signal === 'tool' || signal === 'toolResult')).toEqual([
      ['tool', 'call_35_0', 'webfetch'],
      ['toolResult', 'call_35_0', true],
    ]);
  });

  test('a tool the model was never offered is its mistake, and a built-in that ran stops the run', () => {
    expect(through('refused-tool').filter(([signal]) => signal === 'fail')).toEqual([]);
    expect(through('shell-ran').filter(([signal]) => signal === 'fail')).toEqual([['fail', 'AGENT_UNSAFE', expect.stringContaining('its own shell tool')]]);
  });

  test('a turn stopped from Browsentic is cancelled, not finished', () => {
    expect(through('cancelled').at(-1)).toEqual(['fail', 'CANCELLED', 'Run cancelled.']);
  });

  // Recorded against the real Zen endpoint with no sign-in: ACP passes on only "Authentication required".
  test('a refused model OpenCode chose itself is named, with the paid model to pick instead', () => {
    const failed = through('free-tier');
    expect(failed).toEqual([['fail', 'AGENT_FAILED', expect.stringMatching(/^OpenCode Zen refused opencode\/big-pickle, which OpenCode chose because no model is picked in Browsentic\. /)]]);
    expect(failed[0][2]).toContain(`Pick a paid model in the side panel, or sign Browsentic's OpenCode in to another provider with ${signInLine('opencode')}. (Authentication required`);
  });

  test('a refused model picked in Browsentic is named as picked, and one of another provider names the sign-in it lacks', () => {
    const refusedFor = (model: string) => {
      const turn = holding({ settings: { bin: 'opencode', model } });
      turn.feed(answerTo('free-tier', 1), answerTo('free-tier', 3), answerTo('free-tier', 6));
      return turn.failed();
    };
    expect(refusedFor('opencode/big-pickle')).toEqual([['fail', 'AGENT_FAILED', expect.stringMatching(/^OpenCode Zen refused opencode\/big-pickle\. Zen's free models/)]]);
    expect(refusedFor('mock/m1')).toEqual([
      ['fail', 'AGENT_FAILED', expect.stringMatching(/^Browsentic's OpenCode has no working sign-in for mock, so it could not run mock\/m1\. /)],
    ]);
    expect(refusedFor('mock/m1')[0][2]).toContain(`Sign it in with ${signInLine('opencode')}, or pick another model in the side panel.`);
  });

  test("another session's updates are not this turn's", () => {
    const turn = holding();
    turn.feed(answerTo('turn', 1), answerTo('turn', 3));
    turn.feed(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses_other', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'not ours' } } } }));
    expect(turn.calls).toEqual([['session', SESSION]]);
  });
});

describe('what OpenCode asks of Browsentic', () => {
  test('a permission is never granted, and nothing else it asks is answered', () => {
    const turn = holding();
    turn.feed(
      JSON.stringify({ jsonrpc: '2.0', id: 'p1', method: 'session/request_permission', params: { sessionId: SESSION, options: [] } }),
      JSON.stringify({ jsonrpc: '2.0', id: 'f1', method: 'fs/read_text_file', params: { path: '/etc/hosts' } }),
    );
    expect(turn.written.slice(-2)).toEqual([
      { jsonrpc: '2.0', id: 'p1', result: { outcome: { outcome: 'cancelled' } } },
      { jsonrpc: '2.0', id: 'f1', error: { code: -32601, message: 'Browsentic does not answer fs/read_text_file' } },
    ]);
  });
});
