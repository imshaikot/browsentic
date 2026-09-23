import { mkdirSync, writeFileSync } from 'node:fs';
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
