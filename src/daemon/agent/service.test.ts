import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { FOCUS_SHOT_ACTION } from '@/lib/actions/reserved';
import type { RunEvent } from '@/lib/actions/protocol';
import { failure } from '@/lib/actions/protocol';
import { configPath } from './config';
import { AgentSession } from './service';

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

async function offerTo(runId: string, context: { sessionId?: string; liveTools?: boolean }) {
  session.handle({ t: 'instruct', id: runId, text: 'click Sign in', context });
  const offer = session.offerFor(runId);
  await vi.waitFor(() => expect(ended).toContain(runId), { timeout: 5_000 });
  return offer;
}

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
    const agent = `${dirname(configPath)}/agent-that-waits.sh`;
    writeFileSync(agent, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
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

// Claude Code and Codex go on sending the system prompt a session began with, so a turn that changes it
// has to say what changed in its own message — and a turn that changes nothing says nothing more.
describe('a follow-up in a conversation whose agent keeps its first prompt', () => {
  test('carries what changed since the session began, once, and then nothing it already has', async () => {
    const dir = `${dirname(configPath)}/prompt-turns`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const agent = `${dir}/claude.sh`;
    writeFileSync(
      agent,
      [
        '#!/bin/sh',
        'if [ "$1" = "--version" ]; then echo "2.1.283 (Claude Code)"; exit 0; fi',
        `n=$(ls "${dir}" | grep -c '^turn-'); printf '%s' "$2" > "${dir}/turn-$n"`,
        'echo \'{"type":"system","subtype":"init","session_id":"sess-1","mcp_servers":[{"name":"browsentic","status":"connected"}]}\'',
        'echo \'{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","result":"ok"}\'',
      ].join('\n'),
      { mode: 0o755 },
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
