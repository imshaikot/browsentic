import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const findCaptcha = defineAction({
  name: 'page.findCaptcha',
  description:
    'Look for a captcha on the page and report what it is, without touching it. Ordinary selectors cannot see one: vendors build the widget inside a closed shadow root holding a cross-origin iframe holding another shadow root, so page.getPageInfo shows nothing where the captcha visibly is. This reads through all of that with Chrome’s debugger and reports the vendor (Cloudflare Turnstile, reCAPTCHA v2/v3, hCaptcha, GeeTest, Arkose, AWS WAF), the widget’s on-screen bounds, whether it is already satisfied, and a viewport point for its checkbox when it has one. Read-only — it never clicks. Call it when a page stalls on “verifying you are human”, refuses a form for no visible reason, or shows a checkbox no selector can find. Chrome only, and it briefly shows the “Browsentic is debugging this browser” bar.',
  input: z.object({}),
  execute() {
    throw new ActionError('page.findCaptcha is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
