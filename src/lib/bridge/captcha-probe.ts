import { browser } from 'wxt/browser';
import { CAPTCHA_VENDORS, isInvisibleWidget, markersTell, vendorById, vendorForFrame } from '@/lib/actions/page/captcha-vendors';

export interface ProbedFrame {
  url: string;
  marked: string[];
  solved: string[];
  challenge: boolean;
}

export interface CaptchaFlag {
  vendor: string;
  label: string;
  solved: boolean;
  next?: string;
}

interface Probe {
  id: string;
  markers: string[];
  tokenField?: string;
  solvedMarker?: string;
  checkedInFrame?: string;
  gridRoot?: string;
}

export const PROBES: Probe[] = CAPTCHA_VENDORS.map(({ id, hostMarkers, tokenField, solvedMarker, checkedInFrame, grid }) => ({
  id,
  markers: hostMarkers,
  tokenField,
  solvedMarker,
  checkedInFrame,
  gridRoot: grid?.root,
}));

/**
 * Whether the tab holds a captcha, read without the debugger: a one-line probe runs in every
 * frame the browser knows of — including the cross-origin ones behind closed shadow roots —
 * and the frames' own addresses say which vendor served them. Cheap enough to ride along
 * with every page.getPageInfo, which is how an agent learns to reach for page.solveCaptcha.
 */
export async function captchaOnPage(tabId: number): Promise<CaptchaFlag | undefined> {
  const results = await browser.scripting
    .executeScript({ target: { tabId, allFrames: true }, func: probeFrame, args: [PROBES] })
    .catch(() => []);
  const frames = results.map((result) => result.result as ProbedFrame | undefined).filter((frame) => !!frame);
  return flagFor(frames, import.meta.env.FIREFOX === true);
}

export function flagFor(frames: ProbedFrame[], firefox: boolean): CaptchaFlag | undefined {
  const framed = new Set<string>();
  const visible = new Set<string>();
  for (const frame of frames) {
    const match = vendorForFrame(frame.url);
    if (!match) continue;
    framed.add(match.vendor.id);
    const shown = match.role === 'challenge' ? frame.challenge : !isInvisibleWidget(match.vendor, frame.url);
    if (shown) visible.add(match.vendor.id);
  }
  for (const id of frames.flatMap((frame) => frame.marked)) {
    const vendor = vendorById(id);
    if (vendor && !framed.has(id) && vendor.kind !== 'invisible' && markersTell(vendor)) visible.add(id);
  }
  const vendor = CAPTCHA_VENDORS.find(({ id, kind }) => visible.has(id) && kind !== 'invisible');
  if (!vendor) return undefined;

  const solved = frames.some((frame) => frame.solved.includes(vendor.id));
  if (solved) return { vendor: vendor.id, label: vendor.label, solved };
  return { vendor: vendor.id, label: vendor.label, solved, next: nextStep(vendor.kind, firefox) };
}

function nextStep(kind: string, firefox: boolean): string {
  if (firefox) return 'This browser cannot answer captchas — ask the user to solve it in the page, then carry on.';
  if (kind === 'interactive') return 'A puzzle Browsentic does not answer — ask the user to solve it in the page, then carry on.';
  return 'Call page.solveCaptcha now — it reaches the widget in whatever frame it sits and answers an image challenge itself.';
}

export function probeFrame(probes: Probe[]): ProbedFrame {
  const found = (selector?: string) => {
    try {
      return !!selector && !!document.querySelector(selector);
    } catch {
      return false;
    }
  };
  const filled = (selector?: string) =>
    !!selector && [...document.querySelectorAll(selector)].some((field) => !!(field as HTMLInputElement).value);
  return {
    url: location.href,
    marked: probes.filter(({ markers }) => markers.some(found)).map(({ id }) => id),
    solved: probes
      .filter(({ tokenField, solvedMarker, checkedInFrame }) => filled(tokenField) || found(solvedMarker) || found(checkedInFrame))
      .map(({ id }) => id),
    challenge: probes.some(({ gridRoot }) => found(gridRoot)),
  };
}
