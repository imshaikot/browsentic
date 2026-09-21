import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readAgentConfig } from './config';
import { RunError, runAgentJson } from './runner';
import { nameSession } from './title';

// What the agent answers is the agent's business; what is asked of it, and what is done with the answer, is this module's.
vi.mock('./runner', async (importOriginal) => ({ ...(await importOriginal<typeof import('./runner')>()), runAgentJson: vi.fn() }));

const agent = vi.mocked(runAgentJson);
const config = readAgentConfig();
const name = (messages: unknown[], host?: string) => nameSession({ t: 'nameSession', id: 'n1', host, messages: messages as string[] }, config);
const askedWith = () => agent.mock.calls[0];

beforeEach(() => {
  agent.mockReset();
  agent.mockResolvedValue('Refund a Stripe charge');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('naming a conversation', () => {
  test("the agent's title is the conversation's name", async () => {
    expect(await name(['refund the last charge'])).toEqual({ ok: true, data: { title: 'Refund a Stripe charge' } });
  });

  test('a conversation with nothing said yet is not sent to the agent at all', async () => {
    expect([await name(['', '   ', 42, null]), agent.mock.calls.length]).toEqual([
      { ok: false, error: { code: 'INVALID_INPUT', message: 'Nothing was said in that conversation yet.' } },
      0,
    ]);
  });

  test('only the last twelve messages are sent, numbered, each cut to 400 characters', async () => {
    const messages = Array.from({ length: 14 }, (_, i) => `message ${i + 1}`);
    messages[13] = `  ${'x'.repeat(500)}  `;
    await name(messages);
    const prompt = askedWith()[0];
    expect([prompt.includes('1. message 3\n'), prompt.includes('message 2\n'), prompt.includes(`12. ${'x'.repeat(400)}\n`), prompt.includes('x'.repeat(401))]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  test('on a site, the title is asked to end with it', async () => {
    await name(['refund it'], 'dashboard.stripe.com');
    expect(askedWith()[0]).toContain('while on dashboard.stripe.com.');
    expect(askedWith()[0]).toContain('End it with " — dashboard.stripe.com"');
  });

  test('off any site, the agent is told not to invent one', async () => {
    await name(['what is a refund']);
    expect(askedWith()[0]).toContain('Do not invent a site name.');
  });

  test('the answer is tidied: quotes and extra whitespace dropped, and cut to sixty characters', async () => {
    agent.mockResolvedValue(`  “Compare   three\nlaptop deals ${'and more '.repeat(10)}”  `);
    const result = await name(['compare laptops']);
    expect(result.ok && result.data.title).toBe('Compare three laptop deals and more and more and more and mo');
  });

  test('an answer that is only quotes is no name', async () => {
    agent.mockResolvedValue('""');
    expect(await name(['hi'])).toEqual({ ok: false, error: { code: 'AGENT_FAILED', message: 'The agent returned an empty name.' } });
  });

  test("the agent's failure is passed on as it was reported", async () => {
    agent.mockRejectedValue(new RunError('AGENT_MISSING', 'Claude Code is not installed.'));
    expect(await name(['hi'])).toEqual({ ok: false, error: { code: 'AGENT_MISSING', message: 'Claude Code is not installed.' } });
  });

  test('anything else that goes wrong is an agent failure', async () => {
    agent.mockRejectedValue(new Error('EPIPE'));
    expect(await name(['hi'])).toEqual({ ok: false, error: { code: 'AGENT_FAILED', message: 'Error: EPIPE' } });
  });

  test('an agent that takes longer than thirty seconds is stopped', async () => {
    vi.useFakeTimers();
    agent.mockImplementation(
      (_prompt, _config, signal, { timedOut }) =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new RunError('TIMEOUT', timedOut)))),
    );
    const naming = name(['hi']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await naming).toEqual({ ok: false, error: { code: 'TIMEOUT', message: 'Naming the conversation took too long.' } });
  });
});
