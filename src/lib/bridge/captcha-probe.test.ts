import { describe, expect, test } from 'vitest';
import { flagFor, type ProbedFrame } from './captcha-probe';

const frame = (url: string, extra: Partial<ProbedFrame> = {}): ProbedFrame => ({ url, marked: [], solved: [], challenge: false, ...extra });

const ANCHOR = 'https://www.google.com/recaptcha/api2/anchor?ar=1&k=key&size=normal';
const INVISIBLE_ANCHOR = 'https://www.google.com/recaptcha/api2/anchor?ar=1&k=key&size=invisible';
const BFRAME = 'https://www.google.com/recaptcha/api2/bframe?hl=en&k=key';
const TURNSTILE = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2';

describe('the captcha flag on a page snapshot', () => {
  test('a checkbox widget, however deep its frame, is flagged with the step to take', () => {
    expect(flagFor([frame('https://shop.example/'), frame('https://checkout.example/'), frame(ANCHOR)], false)).toEqual({
      vendor: 'recaptcha-v2',
      label: 'reCAPTCHA v2',
      solved: false,
      next: expect.stringContaining('page.solveCaptcha'),
    });
  });

  test('nothing on a page without one', () => {
    expect(flagFor([frame('https://example.com/')], false)).toBeUndefined();
  });

  test('an invisible reCAPTCHA is left out, its standing challenge frame too, until a challenge is drawn in it', () => {
    const idle = [frame('https://login.example/', { marked: ['recaptcha-v2'] }), frame(INVISIBLE_ANCHOR), frame(BFRAME)];
    const challenged = [...idle.slice(0, 2), frame(BFRAME, { challenge: true })];
    expect([flagFor(idle, false), flagFor(challenged, false)?.vendor]).toEqual([undefined, 'recaptcha-v2']);
  });

  test('a reCAPTCHA marker whose frame has not loaded yet is not taken for a visible widget', () => {
    expect(flagFor([frame('https://login.example/', { marked: ['recaptcha-v2', 'recaptcha-v3'] })], false)).toBeUndefined();
  });

  test('Turnstile is flagged from its marker before its frame arrives', () => {
    expect(flagFor([frame('https://site.example/', { marked: ['turnstile'] })], false)?.vendor).toBe('turnstile');
  });

  test('a satisfied widget says so and asks for nothing', () => {
    expect(flagFor([frame('https://site.example/', { solved: ['turnstile'] }), frame(TURNSTILE)], false)).toEqual({
      vendor: 'turnstile',
      label: 'Cloudflare Turnstile',
      solved: true,
    });
  });

  test('a puzzle Browsentic does not answer, and any captcha on Firefox, go to the user', () => {
    const arkose = flagFor([frame('https://client-api.arkoselabs.com/fc/gc/')], false)?.next;
    const firefox = flagFor([frame(ANCHOR)], true)?.next;
    expect([arkose?.includes('ask the user'), firefox?.includes('ask the user')]).toEqual([true, true]);
  });
});
