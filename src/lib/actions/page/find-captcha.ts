import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const findCaptcha = defineAction({
  name: 'page.findCaptcha',
  chromiumOnly: true,
  description:
    'Report what captcha is on the page, without touching it: the vendor (Cloudflare Turnstile, reCAPTCHA v2/v3, hCaptcha, GeeTest, Arkose, AWS WAF), how many frames deep it sits, its on-screen bounds, whether it is already satisfied, and — while an image challenge is open — its prompt and grid. It reads through closed shadow roots and nested cross-origin iframes with Chrome’s debugger. Read-only. To get past a captcha, call page.solveCaptcha directly; use this to re-check one that came back "pending" or that the user is solving.',
  input: z.object({}),
  execute() {
    throw new ActionError('page.findCaptcha is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
