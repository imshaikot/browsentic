import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const SOLVE_CAPTCHA_TIMEOUT_MS = 120_000;

export const solveCaptcha = defineAction({
  name: 'page.solveCaptcha',
  chromiumOnly: true,
  description:
    'Get past a captcha. Call it as soon as page.getPageInfo reports a "captcha", or a page stalls on “verify you are human” — nothing else reaches the widget, so do not try clicks or selectors first. It finds the widget in any frame at any depth, through closed shadow roots and cross-origin iframes, waits out one that is still loading, ticks the checkbox with a real browser-level click, and sees an image challenge through: Browsentic’s own vision analyst answers reCAPTCHA and hCaptcha challenges round by round when it can. State "solved" means carry on. State "challenge" means a challenge is still open and waiting on you: the result carries it as an image plus its prompt — a tile grid with each tile numbered (answer with "tiles") or a picture to tap on (answer with "points") — look at it and call this again with your answer, repeating until "solved". "invisible" is a scoring captcha with nothing to click; "needsHuman" is a puzzle it cannot answer (Arkose, AWS WAF) — hand that one to the user. Shows the debugger bar while it runs, and is gated for approval because it acts on another site’s security control.',
  input: z.object({
    tiles: z
      .array(z.number().int().min(1).max(25))
      .max(25)
      .optional()
      .describe(
        'Your answer to an open challenge of kind "tiles": the number of every tile that matches its prompt, as painted on the challenge image — 1 is top-left, counting along each row. This is the whole selection, not a change to it. [] means none match.',
      ),
    points: z
      .array(
        z.object({
          x: z.number().min(0).describe('Pixels from the left edge of the challenge image'),
          y: z.number().min(0).describe('Pixels from the top edge of the challenge image'),
        }),
      )
      .min(1)
      .max(16)
      .optional()
      .describe(
        'Your answer to an open challenge of kind "points" (a picture to tap on): where to tap, in pixels on the challenge image as delivered — x from its left edge, y from its top, within imageWidth × imageHeight. Taps go in the order given, then the challenge’s own submit button is pressed.',
      ),
    reload: z
      .boolean()
      .optional()
      .describe('Swap the open challenge for a different one instead of answering — for a prompt or pictures you cannot make out.'),
    waitMs: z
      .number()
      .int()
      .min(0)
      .max(120_000)
      .default(20_000)
      .describe('How long to wait after each click for the widget to report a verdict.'),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(300_000)
      .default(SOLVE_CAPTCHA_TIMEOUT_MS)
      .describe('Overall budget for the whole attempt, image rounds included.'),
  }),
  execute() {
    throw new ActionError('page.solveCaptcha is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
