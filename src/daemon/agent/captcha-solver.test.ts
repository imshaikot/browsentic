import { describe, expect, test, vi } from 'vitest';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import type { Challenge, ChallengeAnswer } from './captcha-analyst';
import { readAgentConfig } from './config';
import { solveCaptchaWithAnalyst } from './captcha-solver';

const config = readAgentConfig();
const IMAGE = 'data:image/jpeg;base64,AAAA';

const open = (prompt = 'Select all images with a bus'): ActionResult =>
  success({ vendor: 'recaptcha-v2', state: 'challenge', challenge: { kind: 'tiles', prompt, tiles: 9, image: IMAGE } });
const solved = success({ vendor: 'recaptcha-v2', state: 'solved', solved: true });

function extension(...results: ActionResult[]) {
  const asked: Record<string, unknown>[] = [];
  const invoke = vi.fn(async (input: unknown) => {
    asked.push(input as Record<string, unknown>);
    return results.shift() ?? failure('CAPTCHA_NOT_FOUND', 'gone');
  });
  return { invoke, asked };
}

const analyst = (...answers: (ChallengeAnswer | null)[]) =>
  vi.fn(async (_challenge: Challenge) => answers.shift() ?? null);

describe('solving with the analyst in the loop', () => {
  test('a checkbox that is accepted outright never wakes the analyst', async () => {
    const { invoke } = extension(solved);
    const answer = analyst();
    expect(await solveCaptchaWithAnalyst(invoke, {}, config, answer)).toEqual(solved);
    expect(answer).not.toHaveBeenCalled();
  });

  test('answers each round it is shown until the widget is satisfied', async () => {
    const { invoke, asked } = extension(open(), open(), solved);
    const answer = analyst({ tiles: [2, 5] }, { tiles: [] });
    const result = await solveCaptchaWithAnalyst(invoke, {}, config, answer);
    expect({
      result: result.ok && (result.data as { state: string; analystRounds: number }),
      answers: asked.map(({ tiles }) => tiles),
    }).toEqual({
      result: expect.objectContaining({ state: 'solved', analystRounds: 2 }),
      answers: [undefined, [2, 5], []],
    });
  });

  test('each call to the extension gets what is left of the one budget', async () => {
    const { invoke, asked } = extension(open(), solved);
    await solveCaptchaWithAnalyst(invoke, { timeoutMs: 60_000 }, config, analyst({ tiles: [1] }));
    const [first, second] = asked.map(({ timeoutMs }) => timeoutMs as number);
    expect([first, second <= first, second > 50_000]).toEqual([60_000, true, true]);
  });

  test('when the analyst cannot answer, the open challenge goes back to the caller with a note saying so', async () => {
    const { invoke } = extension(open());
    const result = await solveCaptchaWithAnalyst(invoke, {}, config, analyst(null));
    const data = result.ok ? (result.data as { state: string; note: string; challenge: { image: string } }) : null;
    expect([data?.state, data?.challenge.image, data?.note.includes('The challenge is yours now')]).toEqual(['challenge', IMAGE, true]);
  });

  test('gives up after ten rounds rather than looping on a vendor that keeps asking', async () => {
    const { invoke } = extension(...Array.from({ length: 12 }, () => open()));
    const answer = analyst(...Array.from({ length: 12 }, () => ({ tiles: [1] })));
    const result = await solveCaptchaWithAnalyst(invoke, {}, config, answer);
    expect([answer.mock.calls.length, result.ok && (result.data as { note: string }).note.includes('round limit')]).toEqual([10, true]);
  });

  test('an answer the caller gave itself is passed straight through', async () => {
    const { invoke, asked } = extension(open());
    const answer = analyst({ tiles: [3] });
    await solveCaptchaWithAnalyst(invoke, { tiles: [1, 2] }, config, answer);
    expect([asked.length, asked[0].tiles, answer.mock.calls.length]).toEqual([1, [1, 2], 0]);
  });

  test('an agent that cannot see pictures leaves the challenge to the caller untouched', async () => {
    const { invoke } = extension(open());
    const answer = analyst({ tiles: [3] });
    expect(await solveCaptchaWithAnalyst(invoke, {}, { ...config, agent: 'codex' }, answer)).toEqual(open());
    expect(answer).not.toHaveBeenCalled();
  });
});
