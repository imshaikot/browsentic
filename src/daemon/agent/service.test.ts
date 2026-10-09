import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { FOCUS_SHOT_ACTION } from '@/lib/actions/reserved';
import type { RunEvent } from '@/lib/actions/protocol';
import { failure, success } from '@/lib/actions/protocol';
import { profilePath } from '../profile';
import { configPath } from './config';
import { stubCli } from './runners/fixtures/support';
import { AgentSession } from './service';
import { hashManifest } from '@/lib/actions/manifest';
import { describeActions } from '@/lib/actions/registry';
import { PHONE_TOOLS } from '@/lib/phone/features';
import type { PhoneContext } from '@/lib/phone/types';

const CODE_TOOLS = ['page.injectCode', 'page.runCode'];

let session: AgentSession;
let ended: string[];

beforeEach(() => {
  // No agent to find, so every run is refused once it has been admitted — after its offer can be read.
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ claudeBin: '/nonexistent/claude' }));
  ended = [];
  session = new AgentSession({
    invoke: async () => failure('EXTENSION_OFFLINE', 'no browser'),
    emit: (runId: string, event: RunEvent) => void (event.kind === 'error' && ended.push(runId)),
    draft: () => {},
    actionNames: () => [],
  });
});

async function offerTo(runId: string, context: { sessionId?: string; liveTools?: boolean; phone?: PhoneContext }) {
  session.handle({ t: 'instruct', id: runId, text: 'click Sign in', context });
  const offer = session.offerFor(runId);
  await vi.waitFor(() => expect(ended).toContain(runId), { timeout: 5_000 });
  return offer;
}

const PHONE: PhoneContext = { serial: 'emulator-5554', model: 'Pixel 8', android: '16', chrome: '150', viewport: { width: 411, height: 675, dpr: 2.625 } };

describe('what a phone run is offered', () => {
  const names = describeActions('chromium').map(({ name }) => name);

  beforeEach(() => {
    session = new AgentSession({
      invoke: async () => failure('EXTENSION_OFFLINE', 'no browser'),
      emit: (runId: string, event: RunEvent) => void (event.kind === 'error' && ended.push(runId)),
      draft: () => {},
      actionNames: () => names,
    });
  });

  test('exactly the phone’s tools, and no reserved ones, even with Live tool on', async () => {
    const offer = await offerTo('p', { sessionId: 's1', phone: PHONE, liveTools: true });
    expect(names.filter((name) => !offer!.withheld.includes(name)).sort()).toEqual([...PHONE_TOOLS].sort());
    expect(offer!.reserved).toEqual([]);
  });

  test('a desktop run beside it is offered what it always was', async () => {
    expect(await offerTo('d', { sessionId: 's2' })).toEqual({ withheld: CODE_TOOLS, reserved: [FOCUS_SHOT_ACTION] });
  });

  test('a phone run leaves the tool list the browser describes, and so its hash, as it was', async () => {
    const before = hashManifest(describeActions('chromium'));
    await offerTo('p', { sessionId: 's1', phone: PHONE });
    expect(hashManifest(describeActions('chromium'))).toBe(before);
  });

  test('a call to a tool off the list is refused before the browser hears of it', async () => {
    const invoked: string[] = [];
    const phoneSession = new AgentSession({
      invoke: async (action) => (invoked.push(action), success({})),
      emit: () => {},
      draft: () => {},
      actionNames: () => names,
    });
    phoneSession.handle({ t: 'instruct', id: 'p2', text: 'look', context: { sessionId: 's3', phone: PHONE } });
    expect(await phoneSession.invokeForRun('p2', 'page.hoverElement', {})).toMatchObject({ ok: false, error: { code: 'NOT_ON_PHONE' } });
    expect(invoked).toEqual([]);
    phoneSession.dispose();
  });
});

describe("what a run's tool list holds", () => {
  test('nothing, for a run that is not active', () => {
    expect(session.offerFor('gone')).toBeNull();
  });

  test('the page-code tools only with Live tool on, and the pick’s screenshot either way', async () => {
    expect([await offerTo('a', { sessionId: 's1' }), await offerTo('b', { sessionId: 's2', liveTools: true })]).toEqual([
      { withheld: CODE_TOOLS, reserved: [FOCUS_SHOT_ACTION] },
      { withheld: [], reserved: [FOCUS_SHOT_ACTION] },
    ]);
  });

  test('a conversation that was shown the page-code tools keeps them, until it is reset', async () => {
    await offerTo('a', { sessionId: 's1', liveTools: true });
    const switchedOff = await offerTo('b', { sessionId: 's1' });
    session.handle({ t: 'reset', sessionId: 's1' });
    const afterReset = await offerTo('c', { sessionId: 's1' });
    expect([switchedOff?.withheld, afterReset?.withheld]).toEqual([[], CODE_TOOLS]);
  });
});

describe('answering a captcha', () => {
  test('asks once, then lets the rest of that run’s rounds through without asking again', async () => {
    const agent = stubCli(join(dirname(configPath), 'agent-that-waits'), 'setTimeout(() => {}, 30_000);');
    writeFileSync(configPath, JSON.stringify({ claudeBin: agent }));
    const events: RunEvent[] = [];
    const invoked: string[] = [];
    const waiting = new AgentSession({
      invoke: async (action) => {
        invoked.push(action);
        return failure('CAPTCHA_NOT_FOUND', 'none');
      },
      emit: (_runId: string, event: RunEvent) => void events.push(event),
      draft: () => {},
      actionNames: () => [],
    });
    waiting.handle({ t: 'instruct', id: 'r1', text: 'sign me up', context: { sessionId: 's1' } });
    await vi.waitFor(() => expect(waiting.offerFor('r1')).not.toBeNull());

    const first = waiting.invokeForRun('r1', 'page.solveCaptcha', {});
    await vi.waitFor(() => expect(events.some((event) => event.kind === 'approval')).toBe(true));
    const asked = events.find((event) => event.kind === 'approval') as Extract<RunEvent, { kind: 'approval' }>;
    waiting.handle({ t: 'decision', id: 'r1', toolId: asked.toolId, allow: true });
    await first;
    await waiting.invokeForRun('r1', 'page.solveCaptcha', { tiles: [1, 4] });
    waiting.dispose();

    expect({ prompts: events.filter((event) => event.kind === 'approval').length, invoked }).toEqual({
      prompts: 1,
      invoked: ['page.solveCaptcha', 'page.solveCaptcha'],
    });
  });
});

// Cursor abandons a tool call at 60 s, so an approval cannot simply hold the call open until the user answers.
describe('an approval, on an agent that abandons a call before the user answers', () => {
  const tracked = async (agent: 'cursor' | 'claude') => {
    const bin = stubCli(join(dirname(configPath), `${agent}-that-waits`), 'setTimeout(() => {}, 30_000);');
    writeFileSync(configPath, JSON.stringify(agent === 'cursor' ? { agent, agents: { cursor: { bin } } } : { claudeBin: bin }));
    const events: RunEvent[] = [];
    const invoked: [string, unknown][] = [];
    const running = new AgentSession({
      invoke: async (action, input) => {
        invoked.push([action, input]);
        return success({ done: true });
      },
      emit: (_runId: string, event: RunEvent) => void events.push(event),
      draft: () => {},
      actionNames: () => [],
    });
    running.handle({ t: 'instruct', id: 'r1', text: 'sign me up', context: { sessionId: 's1' } });
    await vi.waitFor(() => expect(running.offerFor('r1')).not.toBeNull());
    const asked = () => events.find((event) => event.kind === 'approval') as Extract<RunEvent, { kind: 'approval' }>;
    const kinds = () => events.flatMap((event) => (['tool', 'approval', 'toolResult'].includes(event.kind) ? [event.kind] : []));
    const results = () => events.flatMap((event) => (event.kind === 'toolResult' ? [`${event.toolId === asked()?.toolId ? 'asked' : 'other'}: ${event.summary}`] : []));
    return { running, events, invoked, asked, kinds, results };
  };
  const codeOf = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);

  afterEach(() => vi.useRealTimers());

  test('is handed back before the agent gives up, stays on screen, and the same call again waits on it', async () => {
    const { running, invoked, asked, kinds } = await tracked('cursor');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = running.invokeForRun('r1', 'page.solveCaptcha', {});
    await vi.advanceTimersByTimeAsync(50_000);
    const handedBack = codeOf(await first);
    const shownBeforeAnswer = kinds();
    const second = running.invokeForRun('r1', 'page.solveCaptcha', {});
    running.handle({ t: 'decision', id: 'r1', toolId: asked().toolId, allow: true });
    const answered = codeOf(await second);
    running.dispose();
    expect({ handedBack, shownBeforeAnswer, answered, shown: kinds(), invoked: invoked.map(([action]) => action) }).toEqual({
      handedBack: 'APPROVAL_PENDING',
      shownBeforeAnswer: ['tool', 'approval'],
      answered: 'ok',
      shown: ['tool', 'approval', 'toolResult'],
      invoked: ['page.solveCaptcha'],
    });
  });

  test('is withdrawn by any other call, and a yes that comes after does nothing', async () => {
    const { running, invoked, asked, results } = await tracked('cursor');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = running.invokeForRun('r1', 'page.solveCaptcha', {});
    await vi.advanceTimersByTimeAsync(50_000);
    await first;
    await running.invokeForRun('r1', 'page.getPageInfo', {});
    running.handle({ t: 'decision', id: 'r1', toolId: asked().toolId, allow: true });
    running.dispose();
    expect({ results: results(), invoked: invoked.map(([action]) => action) }).toEqual({
      results: ['asked: the agent stopped waiting', 'other: done'],
      invoked: ['page.getPageInfo'],
    });
  });

  test('is withdrawn when the run is stopped while it is handed back', async () => {
    const { running, results } = await tracked('cursor');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const first = running.invokeForRun('r1', 'page.solveCaptcha', {});
    await vi.advanceTimersByTimeAsync(50_000);
    await first;
    running.handle({ t: 'cancel', id: 'r1' });
    running.dispose();
    expect(results()).toEqual(['asked: the agent stopped waiting']);
  });

  test('on any agent, is withdrawn when the caller stops waiting, and a late yes does nothing', async () => {
    const { running, invoked, asked, results } = await tracked('claude');
    const abandoned = new AbortController();
    const call = running.invokeForRun('r1', 'page.solveCaptcha', {}, abandoned.signal);
    abandoned.abort();
    const code = codeOf(await call);
    running.handle({ t: 'decision', id: 'r1', toolId: asked().toolId, allow: true });
    running.dispose();
    expect({ code, results: results(), invoked }).toEqual({ code: 'CANCELLED', results: ['asked: the agent stopped waiting'], invoked: [] });
  });

  test('on an agent that waits as long as it takes, is never handed back', async () => {
    const { running, asked, kinds } = await tracked('claude');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const call = running.invokeForRun('r1', 'page.solveCaptcha', {});
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const before = kinds();
    running.handle({ t: 'decision', id: 'r1', toolId: asked().toolId, allow: true });
    const code = codeOf(await call);
    running.dispose();
    expect({ before, code }).toEqual({ before: ['tool', 'approval'], code: 'ok' });
  });
});

describe('a wait inside a call, on an agent that abandons a call at 60 s', () => {
  const invokedWith = async (agent: 'cursor' | 'claude', action: string, input: unknown) => {
    const bin = stubCli(join(dirname(configPath), `${agent}-that-waits`), 'setTimeout(() => {}, 30_000);');
    writeFileSync(configPath, JSON.stringify(agent === 'cursor' ? { agent, agents: { cursor: { bin } } } : { claudeBin: bin }));
    let seen: unknown;
    const running = new AgentSession({
      invoke: async (_action, given) => {
        seen = given;
        return success({});
      },
      emit: () => {},
      draft: () => {},
      actionNames: () => [],
    });
    running.handle({ t: 'instruct', id: 'r1', text: 'wait for it', context: { sessionId: 's1' } });
    await vi.waitFor(() => expect(running.offerFor('r1')).not.toBeNull());
    await running.invokeForRun('r1', action, input);
    running.dispose();
    return seen as { timeoutMs?: number };
  };

  test('is cut to end before the agent gives up — its own default too — and a short one is left alone', async () => {
    expect([
      (await invokedWith('cursor', 'page.awaitMonitor', { monitorId: 'm1' })).timeoutMs,
      (await invokedWith('cursor', 'page.awaitMonitor', { monitorId: 'm1', timeoutMs: 300_000 })).timeoutMs,
      (await invokedWith('cursor', 'page.waitForElement', { target: { selector: '#go' }, timeoutMs: 3_000 })).timeoutMs,
    ].map((timeoutMs) => (timeoutMs === undefined ? 'unset' : timeoutMs <= 50_000 && timeoutMs > 45_000 ? 'cut' : timeoutMs))).toEqual([
      'cut',
      'cut',
      3_000,
    ]);
  });

  test('is left as asked on an agent that waits as long as it takes', async () => {
    expect((await invokedWith('claude', 'page.awaitMonitor', { monitorId: 'm1' })).timeoutMs).toBeUndefined();
  });
});

// Claude Code and Codex go on sending the system prompt a session began with, so a turn that changes it
// has to say what changed in its own message — and a turn that changes nothing says nothing more.
describe('a follow-up in a conversation whose agent keeps its first prompt', () => {
  test('carries what changed since the session began, once, and then nothing it already has', async () => {
    const dir = `${dirname(configPath)}/prompt-turns`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const agent = stubCli(
      join(dir, 'claude'),
      `const fs = require('node:fs');
if (process.argv[2] === '--version') {
  console.log('2.1.283 (Claude Code)');
  process.exit(0);
}
const turn = ${JSON.stringify(dir)} + '/turn-' + fs.readdirSync(${JSON.stringify(dir)}).filter((name) => name.startsWith('turn-')).length;
let heard = '';
process.stdin.on('data', (chunk) => (heard += chunk)).on('end', () => {
  fs.writeFileSync(turn, heard);
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1', mcp_servers: [{ name: 'browsentic', status: 'connected' }] }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', result: 'ok' }));
});`,
    );
    writeFileSync(configPath, JSON.stringify({ claudeBin: agent }));
    const done: string[] = [];
    const turns = new AgentSession({
      invoke: async () => failure('EXTENSION_OFFLINE', 'no browser'),
      emit: (runId: string, event: RunEvent) => void ((event.kind === 'done' || event.kind === 'error') && done.push(runId)),
      draft: () => {},
      actionNames: () => [],
    });
    const focus = { tag: 'button', selector: '#buy', content: 'Buy now', truncated: false, url: 'https://shop.example/', title: 'Shop' };
    const turn = async (id: string, context: object) => {
      turns.handle({ t: 'instruct', id, text: 'what does this cost?', context: { sessionId: 's1', ...context } });
      await vi.waitFor(() => expect(done).toContain(id), { timeout: 5_000 });
    };

    await turn('r1', {});
    await turn('r2', { focus });
    await turn('r3', { focus });
    const said = [0, 1, 2].map((n) => readFileSync(`${dir}/turn-${n}`, 'utf8'));
    turns.dispose();

    expect(said.map((message) => [message.includes("# Browsentic's instructions for this message"), message.includes('`#buy`')])).toEqual([
      [false, false],
      [true, true],
      [false, false],
    ]);
    expect(said.every((message) => message.endsWith('what does this cost?'))).toBe(true);
  });
});

describe("the user's profile in a run", () => {
  test('reaches the system prompt, and a later edit reaches a resumed turn', async () => {
    const dir = `${dirname(configPath)}/profile-turns`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const agent = stubCli(
      join(dir, 'claude'),
      `const fs = require('node:fs');
if (process.argv[2] === '--version') {
  console.log('2.1.283 (Claude Code)');
  process.exit(0);
}
const turn = ${JSON.stringify(dir)} + '/turn-' + fs.readdirSync(${JSON.stringify(dir)}).filter((name) => name.startsWith('turn-')).length;
const prompt = fs.readFileSync(process.argv[process.argv.indexOf('--append-system-prompt-file') + 1], 'utf8');
let heard = '';
process.stdin.on('data', (chunk) => (heard += chunk)).on('end', () => {
  fs.writeFileSync(turn, JSON.stringify({ prompt, heard }));
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1', mcp_servers: [{ name: 'browsentic', status: 'connected' }] }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', result: 'ok' }));
});`,
    );
    writeFileSync(configPath, JSON.stringify({ claudeBin: agent }));
    const saveProfile = (email: string) =>
      writeFileSync(profilePath, JSON.stringify({ fields: { email }, details: [], instructions: 'Always choose the cheapest shipping.' }));
    const done: string[] = [];
    const turns = new AgentSession({
      invoke: async () => failure('EXTENSION_OFFLINE', 'no browser'),
      emit: (runId: string, event: RunEvent) => void ((event.kind === 'done' || event.kind === 'error') && done.push(runId)),
      draft: () => {},
      actionNames: () => [],
    });
    const turn = async (id: string) => {
      turns.handle({ t: 'instruct', id, text: 'sign me up for the newsletter', context: { sessionId: 's1' } });
      await vi.waitFor(() => expect(done).toContain(id), { timeout: 5_000 });
    };

    try {
      saveProfile('ada@example.com');
      await turn('r1');
      saveProfile('ada@lovelace.dev');
      await turn('r2');
    } finally {
      turns.dispose();
      rmSync(profilePath, { force: true });
    }
    const [first, second] = [0, 1].map((n) => JSON.parse(readFileSync(`${dir}/turn-${n}`, 'utf8')) as { prompt: string; heard: string });

    expect([
      first.prompt.includes('# About the user'),
      first.prompt.includes('Email: ada@example.com'),
      first.prompt.includes('Always choose the cheapest shipping.'),
      first.heard,
    ]).toEqual([true, true, true, 'sign me up for the newsletter']);
    expect([
      second.heard.startsWith("# Browsentic's instructions for this message"),
      second.heard.includes('Email: ada@lovelace.dev'),
      second.heard.includes('Always choose the cheapest shipping.'),
    ]).toEqual([true, true, false]);
  });
});

describe('the prompt of a run on the phone', () => {
  test('is the phone skill and the device, and a turn back on a desktop tab hears that the phone no longer applies', async () => {
    const dir = `${dirname(configPath)}/phone-turns`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const agent = stubCli(
      join(dir, 'claude'),
      `const fs = require('node:fs');
if (process.argv[2] === '--version') {
  console.log('2.1.283 (Claude Code)');
  process.exit(0);
}
const turn = ${JSON.stringify(dir)} + '/turn-' + fs.readdirSync(${JSON.stringify(dir)}).filter((name) => name.startsWith('turn-')).length;
const prompt = fs.readFileSync(process.argv[process.argv.indexOf('--append-system-prompt-file') + 1], 'utf8');
let heard = '';
process.stdin.on('data', (chunk) => (heard += chunk)).on('end', () => {
  fs.writeFileSync(turn, JSON.stringify({ prompt, heard }));
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1', mcp_servers: [{ name: 'browsentic', status: 'connected' }] }));
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn', result: 'ok' }));
});`,
    );
    writeFileSync(configPath, JSON.stringify({ claudeBin: agent }));
    const done: string[] = [];
    const turns = new AgentSession({
      invoke: async () => failure('EXTENSION_OFFLINE', 'no browser'),
      emit: (runId: string, event: RunEvent) => void ((event.kind === 'done' || event.kind === 'error') && done.push(runId)),
      draft: () => {},
      actionNames: () => [],
    });
    const turn = async (id: string, phone?: PhoneContext) => {
      turns.handle({ t: 'instruct', id, text: 'click the first result', context: { sessionId: 's1', phone } });
      await vi.waitFor(() => expect(done).toContain(id), { timeout: 5_000 });
    };

    try {
      await turn('r1', PHONE);
      await turn('r2');
    } finally {
      turns.dispose();
    }
    const [first, second] = [0, 1].map((n) => JSON.parse(readFileSync(`${dir}/turn-${n}`, 'utf8')) as { prompt: string; heard: string });

    expect([
      first.prompt.startsWith("You are Browsentic, driving Chrome on the user's Android phone"),
      first.prompt.includes('# Skill: phone'),
      first.prompt.includes('Pixel 8 · Android 16 · Chrome 150 · viewport 411×675 CSS px at 2.625x'),
      first.prompt.includes('# Skill: browser-control'),
    ]).toEqual([true, true, true, false]);
    expect([
      second.heard.includes('# Skill: browser-control'),
      second.heard.includes('No longer in force: the Android phone'),
      second.heard.endsWith('click the first result'),
    ]).toEqual([true, true, true]);
  });
});
