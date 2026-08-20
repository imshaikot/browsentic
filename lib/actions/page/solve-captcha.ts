import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const solveCaptcha = defineAction({
  name: 'page.solveCaptcha',
  description:
    'Tick a captcha’s “I am a human” checkbox with a real browser-level click and wait for the widget to settle. Works where an ordinary click cannot reach: the checkbox lives inside a closed shadow root inside a cross-origin iframe, and it only responds to genuine pointer input. Returns state "solved" when the widget accepted it. When the vendor escalates to a challenge a person has to answer — an image grid, Arkose, AWS WAF — it returns state "needsHuman" with the widget bounds and does not attempt the challenge; screenshot that region, tell the user it needs them, and poll page.findCaptcha until they are done. State "invisible" means a scoring captcha with nothing to click. Chrome only, shows the debugger bar while it runs, and it is gated for approval because it acts on another site’s security control.',
  input: z.object({
    waitMs: z
      .number()
      .int()
      .min(0)
      .max(120_000)
      .default(20_000)
      .describe('How long to wait after clicking for the widget to report a verdict.'),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(180_000)
      .default(60_000)
      .describe('Overall budget for the whole attempt, including finding the widget.'),
  }),
  execute() {
    throw new ActionError('page.solveCaptcha is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
