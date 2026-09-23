export type CaptchaKind = 'checkbox' | 'interactive' | 'invisible';

export interface Offset {
  x: number;
  y: number;
}

export interface GridSpec {
  root: string;
  prompt: string;
  target?: string;
  tiles: string;
  selected: string;
  loading?: string;
  cover?: string;
  submit: string;
  reload?: string;
  errors: string;
  dynamic?: string;
}

export interface CanvasSpec {
  root: string;
  prompt: string;
  submit: string;
  reload?: string;
  errors: string;
  marks?: string;
}

export interface CaptchaVendor {
  id: string;
  label: string;
  kind: CaptchaKind;
  hostMarkers: string[];
  frames?: string[];
  challengeFrames?: string[];
  invisibleFrame?: string;
  checkbox?: string;
  checkboxAt?: Offset;
  tokenField?: string;
  solvedMarker?: string;
  checkedInFrame?: string;
  grid?: GridSpec;
  canvas?: CanvasSpec;
}

export type FrameRole = 'widget' | 'challenge';

export const CAPTCHA_VENDORS: readonly CaptchaVendor[] = [
  {
    id: 'recaptcha-v2',
    label: 'reCAPTCHA v2',
    kind: 'checkbox',
    hostMarkers: ['.g-recaptcha', '#g-recaptcha', 'iframe[src*="/recaptcha/api2/anchor"]', 'iframe[src*="/recaptcha/enterprise/anchor"]'],
    frames: ['/recaptcha/api2/anchor', '/recaptcha/enterprise/anchor'],
    challengeFrames: ['/recaptcha/api2/bframe', '/recaptcha/enterprise/bframe'],
    invisibleFrame: 'size=invisible',
    checkbox: '#recaptcha-anchor',
    checkboxAt: { x: 27, y: 39 },
    checkedInFrame: '#recaptcha-anchor[aria-checked="true"]',
    tokenField: '[name="g-recaptcha-response"]',
    grid: {
      root: '#rc-imageselect',
      prompt: '.rc-imageselect-desc-wrapper',
      target: '.rc-imageselect-desc-wrapper strong',
      tiles: 'td.rc-imageselect-tile',
      selected: '.rc-imageselect-tileselected',
      loading: '.rc-imageselect-dynamic-selected',
      cover: '.rc-image-tile-overlay',
      submit: '#recaptcha-verify-button',
      reload: '#recaptcha-reload-button',
      errors:
        '.rc-imageselect-incorrect-response, .rc-imageselect-error-select-more, .rc-imageselect-error-dynamic-more, .rc-imageselect-error-select-something',
      dynamic: 'none left',
    },
  },
  {
    id: 'hcaptcha',
    label: 'hCaptcha',
    kind: 'checkbox',
    hostMarkers: ['.h-captcha', '[data-hcaptcha-widget-id]', 'iframe[src*="hcaptcha.com/captcha"]'],
    frames: ['frame=checkbox'],
    challengeFrames: ['frame=challenge'],
    invisibleFrame: 'frame=checkbox-invisible',
    checkbox: '#checkbox',
    checkboxAt: { x: 30, y: 39 },
    checkedInFrame: '#checkbox[aria-checked="true"]',
    tokenField: '[name="h-captcha-response"]',
    grid: {
      root: '.task-grid',
      prompt: '.prompt-text',
      tiles: '.task-grid .task',
      selected: '[aria-pressed="true"], .selected',
      submit: '.button-submit',
      reload: '.refresh.button',
      errors: '.display-error',
    },
    canvas: {
      root: '.challenge-view canvas',
      prompt: '.prompt-text',
      submit: '.button-submit',
      reload: '.refresh.button',
      errors: '.display-error',
      marks: '.challenge-example .image',
    },
  },
  {
    id: 'turnstile',
    label: 'Cloudflare Turnstile',
    kind: 'checkbox',
    hostMarkers: [
      '.cf-turnstile',
      '#cf-turnstile',
      '[name="cf-turnstile-response"]',
      '#challenge-stage',
      '#cf-challenge-running',
      '#challenge-running',
    ],
    frames: ['challenges.cloudflare.com'],
    checkbox: 'input[type="checkbox"]',
    checkboxAt: { x: 30, y: 32 },
    tokenField: '[name="cf-turnstile-response"]',
  },
  {
    id: 'geetest',
    label: 'GeeTest',
    kind: 'checkbox',
    hostMarkers: ['.geetest_holder', '.geetest_radar_tip', '.geetest_btn', '.geetest_btn_click'],
    checkbox: '.geetest_radar_tip, .geetest_btn_click',
    solvedMarker: '.geetest_success_radar_tip, .geetest_lock_success',
  },
  {
    id: 'arkose',
    label: 'Arkose FunCaptcha',
    kind: 'interactive',
    hostMarkers: ['#funcaptcha', '#arkose', '[data-pkey]', 'iframe[src*="arkoselabs.com"]'],
    frames: ['arkoselabs.com', 'funcaptcha.com'],
  },
  {
    id: 'aws-waf',
    label: 'AWS WAF Captcha',
    kind: 'interactive',
    hostMarkers: ['#captcha-container', 'script[src*="captcha.awswaf.com"]', 'iframe[src*="awswaf.com"]'],
    frames: ['awswaf.com'],
  },
  {
    id: 'recaptcha-v3',
    label: 'reCAPTCHA v3',
    kind: 'invisible',
    hostMarkers: ['script[src*="recaptcha/api.js?render="]', 'script[src*="recaptcha/enterprise.js?render="]'],
    tokenField: '[name="g-recaptcha-response"]',
  },
] as const;

export function vendorForFrame(url: string): { vendor: CaptchaVendor; role: FrameRole } | null {
  for (const vendor of CAPTCHA_VENDORS) {
    if (vendor.challengeFrames?.some((fragment) => url.includes(fragment))) return { vendor, role: 'challenge' };
    if (vendor.frames?.some((fragment) => url.includes(fragment))) return { vendor, role: 'widget' };
  }
  return null;
}

export const isInvisibleWidget = (vendor: CaptchaVendor, url: string) =>
  !!vendor.invisibleFrame && url.includes(vendor.invisibleFrame);

/** A vendor whose widget is its frame, visible or not, cannot be judged from page markers alone. */
export const markersTell = (vendor: CaptchaVendor) => !vendor.invisibleFrame;

export const vendorById = (id: string) => CAPTCHA_VENDORS.find((vendor) => vendor.id === id);
