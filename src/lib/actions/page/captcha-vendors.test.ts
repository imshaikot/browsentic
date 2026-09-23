import { describe, expect, test } from 'vitest';
import { isInvisibleWidget, markersTell, vendorById, vendorForFrame } from './captcha-vendors';

const roleOf = (url: string) => {
  const match = vendorForFrame(url);
  return match && `${match.vendor.id}:${match.role}`;
};

describe('telling a vendor by its frame', () => {
  test('reCAPTCHA’s widget and challenge frames, on google.com, recaptcha.net and Enterprise', () => {
    expect([
      roleOf('https://www.google.com/recaptcha/api2/anchor?ar=1&k=key'),
      roleOf('https://www.recaptcha.net/recaptcha/api2/bframe?k=key'),
      roleOf('https://www.google.com/recaptcha/enterprise/anchor?ar=1&k=key'),
      roleOf('https://www.google.com/recaptcha/enterprise/bframe?k=key'),
    ]).toEqual(['recaptcha-v2:widget', 'recaptcha-v2:challenge', 'recaptcha-v2:widget', 'recaptcha-v2:challenge']);
  });

  test('hCaptcha, whose role lives in the fragment', () => {
    expect([
      roleOf('https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox&id=1'),
      roleOf('https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge&id=1'),
    ]).toEqual(['hcaptcha:widget', 'hcaptcha:challenge']);
  });

  test('Turnstile, and nothing for an ordinary frame', () => {
    expect([roleOf('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile/if/ov2'), roleOf('https://ads.example/frame')]).toEqual([
      'turnstile:widget',
      null,
    ]);
  });

  test('an invisible widget is known by its frame, which is why its markers alone cannot be trusted', () => {
    const recaptcha = vendorById('recaptcha-v2')!;
    const hcaptcha = vendorById('hcaptcha')!;
    expect([
      isInvisibleWidget(recaptcha, 'https://www.google.com/recaptcha/api2/anchor?k=key&size=invisible'),
      isInvisibleWidget(hcaptcha, 'https://newassets.hcaptcha.com/x#frame=checkbox-invisible'),
      markersTell(recaptcha),
      markersTell(vendorById('turnstile')!),
    ]).toEqual([true, true, false, true]);
  });
});
