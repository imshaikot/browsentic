export type CaptchaKind = 'checkbox' | 'interactive' | 'invisible';

export interface CaptchaVendor {
  id: string;
  label: string;
  kind: CaptchaKind;
  hostMarkers: string[];
  frame?: string;
  challengeFrame?: string;
  checkbox?: string;
  solvedInPage?: string;
  solvedInFrame?: string;
}

export const CAPTCHA_VENDORS: readonly CaptchaVendor[] = [
  {
    id: 'turnstile',
    label: 'Cloudflare Turnstile',
    kind: 'checkbox',
    hostMarkers: ['.cf-turnstile', '#cf-turnstile', '#challenge-stage', '#cf-challenge-running', '#challenge-running'],
    frame: 'challenges.cloudflare.com',
    checkbox: 'input[type="checkbox"]',
    solvedInPage: '!!document.querySelector(\'input[name="cf-turnstile-response"]\')?.value',
  },
  {
    id: 'recaptcha-v2',
    label: 'reCAPTCHA v2',
    kind: 'checkbox',
    hostMarkers: ['.g-recaptcha', '#g-recaptcha', 'iframe[src*="recaptcha/api2/anchor"]', 'iframe[src*="recaptcha/enterprise/anchor"]'],
    frame: 'recaptcha/api2/anchor',
    challengeFrame: 'recaptcha/api2/bframe',
    checkbox: '#recaptcha-anchor',
    solvedInFrame: '!!document.querySelector(\'#recaptcha-anchor.recaptcha-checkbox-checked\')',
    solvedInPage: '!!document.querySelector(\'textarea#g-recaptcha-response\')?.value',
  },
  {
    id: 'hcaptcha',
    label: 'hCaptcha',
    kind: 'checkbox',
    hostMarkers: ['.h-captcha', '[data-hcaptcha-widget-id]', 'iframe[src*="hcaptcha.com/captcha"]'],
    frame: 'frame=checkbox',
    challengeFrame: 'frame=challenge',
    checkbox: '#checkbox',
    solvedInPage: '!!document.querySelector(\'textarea[name="h-captcha-response"]\')?.value',
  },
  {
    id: 'geetest',
    label: 'GeeTest',
    kind: 'checkbox',
    hostMarkers: ['.geetest_holder', '.geetest_radar_tip', '.geetest_btn'],
    checkbox: '.geetest_radar_tip',
    solvedInPage: '!!document.querySelector(\'.geetest_success_radar_tip\')',
  },
  {
    id: 'arkose',
    label: 'Arkose FunCaptcha',
    kind: 'interactive',
    hostMarkers: ['#funcaptcha', '#arkose', '[data-pkey]', 'iframe[src*="arkoselabs.com"]'],
    frame: 'arkoselabs.com',
  },
  {
    id: 'aws-waf',
    label: 'AWS WAF Captcha',
    kind: 'interactive',
    hostMarkers: ['#captcha-container', 'script[src*="captcha.awswaf.com"]', 'iframe[src*="awswaf.com"]'],
    frame: 'awswaf.com',
  },
  {
    id: 'recaptcha-v3',
    label: 'reCAPTCHA v3',
    kind: 'invisible',
    hostMarkers: ['script[src*="recaptcha/api.js?render="]', 'script[src*="recaptcha/enterprise.js?render="]'],
    solvedInPage: '!!document.querySelector(\'textarea#g-recaptcha-response\')?.value',
  },
] as const;
