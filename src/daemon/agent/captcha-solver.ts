import { SOLVE_CAPTCHA_TIMEOUT_MS } from '@/lib/actions/page/solve-captcha';
import type { ActionResult } from '@/lib/actions/protocol';
import { log } from '../log';
import { analystSees, answerChallenge, type Challenge, type ChallengeAnswer } from './captcha-analyst';
import type { AgentConfig } from './config';

const MAX_ROUNDS = 10;
const ROUND_FLOOR_MS = 12_000;
const CLICK_RESERVE_MS = 8_000;

interface Asked {
  tiles?: unknown;
  reload?: unknown;
  waitMs?: unknown;
  timeoutMs?: unknown;
}

type Answer = (challenge: Challenge, config: AgentConfig, signal: AbortSignal) => Promise<ChallengeAnswer | null>;

/**
 * page.solveCaptcha with an analyst in the loop. The extension does the clicking and the
 * photographing; each time it comes back with an image grid still open, a one-shot analyst
 * session looks at that single picture and is stopped the moment it has answered, and the
 * answer goes back to the extension. The caller sees the outcome — or, when no analyst could
 * finish the job, the open grid itself, so it can answer the rest.
 */
export async function solveCaptchaWithAnalyst(
  invoke: (input: unknown) => Promise<ActionResult>,
  input: unknown,
  config: AgentConfig,
  answer: Answer = answerChallenge,
): Promise<ActionResult> {
  const asked = (input ?? {}) as Asked;
  const budget = typeof asked.timeoutMs === 'number' ? asked.timeoutMs : SOLVE_CAPTCHA_TIMEOUT_MS;
  const until = Date.now() + budget;
  const first = await invoke({ ...asked, timeoutMs: budget });
  if (asked.tiles !== undefined || asked.reload !== undefined || !analystSees(config)) return first;

  let result = first;
  const answers: ChallengeAnswer[] = [];
  let stopped: string | undefined;
  while (openChallenge(result)) {
    if (answers.length >= MAX_ROUNDS) {
      stopped = 'reached its round limit';
      break;
    }
    const left = until - Date.now();
    if (left < ROUND_FLOOR_MS) {
      stopped = 'ran out of time';
      break;
    }
    const given = await answerWithin(answer, openChallenge(result)!, config, left - CLICK_RESERVE_MS);
    if (!given) {
      stopped = 'could not answer this round';
      break;
    }
    answers.push(given);
    log(`captcha analyst round ${answers.length}: ${describeAnswer(given)}`);
    result = await invoke({
      ...given,
      ...(typeof asked.waitMs === 'number' ? { waitMs: asked.waitMs } : {}),
      timeoutMs: Math.max(until - Date.now(), CLICK_RESERVE_MS),
    });
  }
  return annotate(result, answers, stopped);
}

const describeAnswer = (given: ChallengeAnswer) =>
  'reload' in given
    ? 'asked for another challenge'
    : 'tiles' in given
      ? `tiles ${given.tiles.join(',') || 'none'}`
      : `${given.points.length} point${given.points.length === 1 ? '' : 's'}`;

function openChallenge(result: ActionResult): Challenge | null {
  if (!result.ok) return null;
  const data = result.data as { state?: unknown; challenge?: Challenge } | null;
  return data?.state === 'challenge' && data.challenge?.image ? data.challenge : null;
}

async function answerWithin(answer: Answer, challenge: Challenge, config: AgentConfig, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await answer(challenge, config, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function annotate(result: ActionResult, answers: ChallengeAnswer[], stopped: string | undefined): ActionResult {
  if (!result.ok) return result;
  if (openChallenge(result)) return handBack(result, answers.length, stopped ?? 'stopped');
  return answers.length ? withRounds(result, answers.length) : result;
}

function withRounds(result: Extract<ActionResult, { ok: true }>, rounds: number): ActionResult {
  return { ok: true, data: { ...(result.data as object), analystRounds: rounds } };
}

function handBack(result: Extract<ActionResult, { ok: true }>, rounds: number, why: string): ActionResult {
  const data = result.data as { note?: string };
  return {
    ok: true,
    data: {
      ...data,
      analystRounds: rounds,
      note: [
        data.note,
        `Browsentic’s captcha analyst ${why}${rounds ? ` after ${rounds} round${rounds === 1 ? '' : 's'}` : ''}. The challenge is yours now: look at the image and call page.solveCaptcha with your answer.`,
      ]
        .filter(Boolean)
        .join(' '),
    },
  };
}
