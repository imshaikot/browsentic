import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { deepseekRunner, rowsOfTree, unvetted } from './deepseek';
import { jsonContext, readThrough, streamContext, stubCli, transcript, type Call } from './fixtures/support';
import type { Conversation, StreamContext, StreamSink } from './types';

const SESSION = '942f4fe8-050b-49f9-8426-40bef1b73a35';
const SETTINGS = { bin: 'dsh' };

interface Written {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
}

const parsed = (line: string): Written & { result?: { configOptions?: { id: string }[] } } => {
  try {
    return JSON.parse(line) as Written;
  } catch {
    return {};
  }
};
const frames = (name: string) => transcript('deepseek', `0.2.1-rc.2-acp-${name}.jsonl`);
const answerTo = (name: string, id: number) => frames(name).find((line) => parsed(line).id === id) as string;
const notices = (name: string) => frames(name).filter((line) => parsed(line).method === 'session/update');
const headless = (name: string) => transcript('deepseek', `0.2.1-rc.2-headless-${name}.jsonl`);

/** A tool update the recordings do not hold, in the shape dsh sends one. */
const update = (sessionUpdate: string, fields: Record<string, unknown>, sessionId = SESSION) =>
  JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate, ...fields } } });

function holding(overrides: Partial<StreamContext> = {}) {
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
  const conversation = deepseekRunner.converse?.(streamContext(SETTINGS, overrides)) as Conversation;
  conversation.open(io);
  const feed = (...lines: string[]) => lines.forEach((line) => conversation.read(line, sink, io));
  return {
    conversation,
    written,
    calls,
    feed,
    asked: (method: string) => written.filter((message) => message.method === method),
    signals: (signal: keyof StreamSink) => calls.filter(([name]) => name === signal),
    /** Opens the recorded session and lets its prompt go. */
    async opened() {
      feed(answerTo('turn', 1), answerTo('turn', 3));
      await vi.runAllTimersAsync();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a turn over ACP', () => {
  test('a new session and a resumed one are each handed the browser server, with the run id in its own environment', () => {
    const fresh = holding();
    fresh.feed(answerTo('turn', 1));
    const resumed = holding({ sessionId: SESSION });
    resumed.feed(answerTo('turn', 1));
    const server = {
      name: 'browsentic',
      command: '/usr/local/bin/node',
      args: ['/usr/local/lib/node_modules/browsentic/dist/cli.js', 'mcp'],
      env: [{ name: 'BROWSENTIC_AGENT_RUN', value: 'run-1' }],
    };
    expect(fresh.asked('session/new')[0].params).toEqual({ cwd: fresh.conversation.plan.cwd, mcpServers: [server] });
    expect(resumed.asked('session/resume')[0].params).toEqual({ sessionId: SESSION, cwd: resumed.conversation.plan.cwd, mcpServers: [server] });
  });

  test('a recorded turn reaches the panel as its answer alone: the browser call draws itself, and dsh’s own log line is passed over', async () => {
    const turn = holding();
    await turn.opened();
    expect(turn.asked('session/prompt')).toHaveLength(1);
    turn.feed(...frames('turn').filter((line) => !line.startsWith('{')), ...notices('turn'), answerTo('turn', 6));
    expect(turn.calls).toEqual([
      ['session', SESSION],
      ['text', 'The page title is "Example Domain".'],
      ['done', 'end_turn'],
    ]);
  });

  test('a pinned model is asked for under the provider the session opened on, and one the account lacks is named', async () => {
    const pinned = holding({ settings: { ...SETTINGS, model: 'deepseek-v4-pro' } });
    await pinned.opened();
    expect(pinned.asked('session/set_config_option')[0].params).toMatchObject({ configId: 'model', value: '["deepseek-account","deepseek-v4-pro"]' });

    const missing = holding({ settings: { ...SETTINGS, model: 'deepseek-r9' } });
    await missing.opened();
    expect(missing.signals('fail')).toEqual([
      ['fail', 'AGENT_FAILED', 'DeepSeek Harness offers no model "deepseek-r9" here. It offers deepseek-flash, deepseek-v4-pro, among others. Pick one in the Browsentic side panel, then try again.'],
    ]);
  });

  test('an effort goes as its reasoning_effort', async () => {
    const effort = holding({ settings: { ...SETTINGS, effort: 'max' } });
    await effort.opened();
    expect(effort.asked('session/set_config_option')[0].params).toMatchObject({ configId: 'reasoning_effort', value: 'max' });
  });

  test('each message the model commits is a paragraph of its own', async () => {
    const turn = holding();
    await turn.opened();
    const messages = notices('messages').map((line) => line.replace(/"sessionId":"[^"]+"/, `"sessionId":"${SESSION}"`));
    turn.feed(...messages);
    expect(turn.signals('text')).toEqual([['text', 'First.'], ['text', '\n\n'], ['text', 'Done 4.']]);
  });

  test('a tool the model only named is not taken for one that ran', async () => {
    const turn = holding();
    await turn.opened();
    turn.feed(...notices('unknown-tool').map((line) => line.replace(/"sessionId":"[^"]+"/, `"sessionId":"${SESSION}"`)));
    expect(turn.signals('fail')).toEqual([]);
  });

  test('a built-in that ran stops the run, whether it finished or failed', async () => {
    for (const status of ['completed', 'failed']) {
      const turn = holding();
      await turn.opened();
      turn.feed(
        update('tool_call', { toolCallId: 't1', title: 'bash', kind: 'other', status: 'in_progress' }),
        update('tool_call_update', { toolCallId: 't1', status, content: [{ type: 'content', content: { type: 'text', text: 'Error: exit 1' } }] }),
      );
      expect(turn.signals('fail')[0]?.slice(0, 2)).toEqual(['fail', 'AGENT_UNSAFE']);
    }
  });

  test('its to-do list and a browser call that dsh abandoned pass quietly, and the web draws itself on research', async () => {
    const turn = holding({ research: true });
    await turn.opened();
    turn.feed(
      update('tool_call', { toolCallId: 't1', title: 'todo_write', kind: 'other', status: 'in_progress' }),
      update('tool_call_update', { toolCallId: 't1', status: 'completed' }),
      ...notices('timeout').map((line) => line.replace(/"sessionId":"[^"]+"/, `"sessionId":"${SESSION}"`)),
      update('tool_call', { toolCallId: 't2', title: 'web_search', kind: 'other', status: 'in_progress' }),
      update('tool_call_update', { toolCallId: 't2', status: 'completed' }),
    );
    expect(turn.calls.filter(([signal]) => signal !== 'text' && signal !== 'session')).toEqual([
      ['tool', 't2', 'web_search'],
      ['toolResult', 't2', true],
    ]);
  });

  test('a cancelled prompt ends the run as cancelled', async () => {
    const turn = holding();
    await turn.opened();
    turn.feed(answerTo('cancelled', 6));
    expect(turn.signals('fail')).toEqual([['fail', 'CANCELLED', 'Run cancelled.']]);
  });

  test('a session dsh no longer holds is started afresh', () => {
    const turn = holding({ sessionId: '00000000-0000-4000-8000-000000000000' });
    turn.feed(answerTo('turn', 1), answerTo('resume-missing', 2));
    expect(turn.asked('session/new')).toHaveLength(1);
  });

  test('a turn with no sign-in says how to sign in', async () => {
    const turn = holding();
    await turn.opened();
    turn.feed(answerTo('signed-out', 6));
    expect(turn.signals('fail')).toEqual([
      ['fail', 'AGENT_FAILED', expect.stringMatching(/^DeepSeek Harness is not signed in\. Run "dsh web" and sign in with your DeepSeek account, or set DEEPSEEK_API_KEY\./)],
    ]);
  });
});

describe('headless', () => {
  test('a turn it falls back to reaches the panel as its answer and its usage, with the browser call left to draw itself', () => {
    expect(readThrough(deepseekRunner, headless('browser'))).toEqual([
      ['session', 'session-80cd2744-55c8-423c-a9b7-7efa8e3610bc'],
      ['usage', { contextTokens: 13, outputTokens: 3 }],
      ['text', 'Done 3.'],
      ['usage', { contextTokens: 13, outputTokens: 6 }],
      ['done', 'end_turn'],
    ]);
  });

  test('a one-shot answers with its final text, past a line of dsh’s own that is not JSON', () => {
    const stdout = ['[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)', ...headless('read')].join('\n');
    expect(deepseekRunner.answer(stdout)).toEqual({ text: 'Done 3.' });
  });

  test('a one-shot with no sign-in, and the line it leaves on stderr, say how to sign in', () => {
    expect(deepseekRunner.answer(headless('signed-out').join('\n')).error).toMatch(/^DeepSeek Harness is not signed in/);
    const stderr = 'dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY …';
    expect(deepseekRunner.hint?.(stderr)).toMatch(/^DeepSeek Harness is not signed in/);
  });

  test('a dsh whose plugin tree moved on asks for both to be updated', () => {
    expect(deepseekRunner.hint?.('dsh: [/x/browsentic.patch.yml] patch: entry "tool-goal" not found')).toMatch(/^Your DeepSeek Harness has changed/);
  });
});

describe('plans', () => {
  const rowsOf = (content: string) => JSON.parse(content) as { id?: string; disabled?: boolean; config?: Record<string, unknown>; insert?: unknown[] }[];

  test('a turn borrows the user’s sign-in from their own dsh home, and keeps a home of Browsentic’s', () => {
    const plan = (deepseekRunner.converse?.(streamContext(SETTINGS)) as Conversation).plan;
    const rows = rowsOf(plan.files!.find((file) => file.path === 'browsentic.patch.yml')!.content);
    expect(rows.find((row) => row.id === 'credentials')).toEqual({ id: 'credentials', disabled: false, config: { path: join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml') } });
    expect(plan.env?.DSH_HOME).toMatch(/agents[\\/]deepseek[\\/]home$/);
    expect(plan.files!.find((file) => file.path === 'AGENTS.md')?.content).toBe('You are Browsentic.');
  });

  test('the web stays off but on research, and a one-shot that reads is given read and nothing else', () => {
    const turnRows = (research: boolean) => rowsOf((deepseekRunner.converse?.(streamContext(SETTINGS, { research })) as Conversation).plan.files![0].content);
    expect(turnRows(false).some((row) => row.id === 'tool-web' && row.disabled)).toBe(true);
    expect(turnRows(true).some((row) => row.id === 'tool-web')).toBe(false);
    const reading = rowsOf(deepseekRunner.json(jsonContext(SETTINGS, { reads: true })).files![0].content);
    expect(reading.filter((row) => row.id === 'tool-fs')).toEqual([{ id: 'tool-fs', config: { read: true, readImage: false, write: false, edit: false } }]);
    expect(rowsOf(deepseekRunner.json(jsonContext(SETTINGS)).files![0].content).find((row) => row.id === 'tool-fs')).toEqual({ id: 'tool-fs', disabled: true });
  });

  test('the turn it falls back to mounts the browser server through the patch, and resumes only a session of its own kind', () => {
    const plan = deepseekRunner.stream(streamContext(SETTINGS, { sessionId: SESSION }));
    expect(rowsOf(plan.files![0].content).filter((row) => row.insert)).toHaveLength(1);
    expect(plan.args).not.toContain('--session-id');
    expect(deepseekRunner.stream(streamContext(SETTINGS, { sessionId: 'session-1' })).args).toEqual(expect.arrayContaining(['--session-id', 'session-1']));
  });
});

describe('the plugin tree a release composes', () => {
  const tree = readFileSync(new URL('./fixtures/deepseek/0.2.1-rc.2-tree.yml', import.meta.url), 'utf8');

  test('is read row by row, and 0.2.1-rc.2’s leaves no tool on that Browsentic has not vetted', () => {
    const rows = rowsOfTree(tree);
    expect(rows.find((row) => row.id === 'tool-bash')).toEqual({ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', on: false });
    expect(rows.find((row) => row.id === 'tool-web')).toEqual({ id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', on: true });
    expect(unvetted(rows)).toEqual([]);
  });

  test('a tool row a later release adds, left on, is found', () => {
    const later = `${tree}- id: tool-terminal\n  name: '@deepseek-ai/dsh-tool-terminal'\n`;
    expect(unvetted(rowsOfTree(later))).toEqual(['tool-terminal']);
  });
});

describe('readiness', () => {
  const was = { home: process.env.DSH_HOME, key: process.env.DEEPSEEK_API_KEY };
  const tree = readFileSync(new URL('./fixtures/deepseek/0.2.1-rc.2-tree.yml', import.meta.url), 'utf8');
  let home: string;
  let SETTINGS: { bin: string };
  /** A stand-in dsh that prints this tree for `--dump-config`. */
  const printing = (name: string, printed: string) => ({
    bin: stubCli(join(home, name), `process.stdout.write(${JSON.stringify(printed)});`),
  });
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    process.env.DSH_HOME = home;
    delete process.env.DEEPSEEK_API_KEY;
    SETTINGS = printing('dsh', tree);
    vi.useRealTimers();
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    for (const [name, value] of [['DSH_HOME', was.home], ['DEEPSEEK_API_KEY', was.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test('a DeepSeek account `dsh web` signed in to, a stored key, or one in the environment is enough', async () => {
    writeFileSync(join(home, '.credentials.yaml'), 'version: 1\nrecords:\n  deepseek-account-platform/default:\n    kind: token\n');
    expect(await deepseekRunner.check?.(SETTINGS)).toBeNull();
    writeFileSync(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-x\n');
    expect(await deepseekRunner.check?.(SETTINGS)).toBeNull();
    rmSync(join(home, '.credentials.yaml'));
    process.env.DEEPSEEK_API_KEY = 'sk-x';
    expect(await deepseekRunner.check?.(SETTINGS)).toBeNull();
  });

  test('no sign-in at all asks for one', async () => {
    expect(await deepseekRunner.check?.(SETTINGS)).toMatchObject({ code: 'AGENT_NEEDS_PERMISSION', fix: 'dsh web' });
  });

  test('a release whose tree leaves a tool on that the patch does not cover is not used', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-x';
    const later = printing('dsh-later', `${tree}- id: tool-terminal\n  name: '@deepseek-ai/dsh-tool-terminal'\n`);
    expect(await deepseekRunner.check?.(later, '0.3.0')).toMatchObject({ code: 'AGENT_UNUSABLE', message: expect.stringContaining('tool-terminal') });
    expect(await deepseekRunner.check?.(SETTINGS, '0.2.1-rc.2')).toBeNull();
  });

  test('a release older than the one this runner was written against is not used', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-x';
    expect(await deepseekRunner.check?.(SETTINGS, '0.1.9')).toMatchObject({ code: 'AGENT_UNUSABLE', fix: 'npm i -g @deepseek-ai/dsh' });
  });
});
