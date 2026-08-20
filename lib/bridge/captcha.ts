import { z } from 'zod';
import { CAPTCHA_VENDORS, type CaptchaVendor } from '@/lib/actions/page/captcha-vendors';
import { solveCaptcha } from '@/lib/actions/page/solve-captcha';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { frameSessions, send, settle, withDebugger, type DebuggerSession, type FrameSession } from './cdp';
import { dispatchClick, type ClickPlan, type Point } from './trusted-input';

type CaptchaState = 'idle' | 'pending' | 'solved' | 'needsHuman' | 'invisible';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Sighting {
  vendor: CaptchaVendor;
  frames: FrameSession[];
  state: CaptchaState;
  hasToken: boolean;
  bounds?: Rect;
  point?: Point;
  note?: string;
}

const FIREFOX_HINT =
  'Reading a captcha needs Chrome’s debugger, which Firefox does not expose — solve the captcha in the page yourself.';

const POLL_INTERVAL_MS = 500;

const CLICK_STYLE = {
  button: 'left' as const,
  clickCount: 1,
  modifiers: [] as string[],
  moveSteps: 14,
  hoverMs: 120,
  holdMs: 70,
};

export function findCaptchaInTab(tabId: number): Promise<ActionResult> {
  return withDebugger(tabId, FIREFOX_HINT, async (session) => {
    const seen = await scan(session);
    return success(seen ? report(seen) : { found: false });
  });
}

export function solveCaptchaInTab(tabId: number, input: unknown): Promise<ActionResult> {
  const parsed = solveCaptcha.input.safeParse(input ?? {});
  if (!parsed.success) return Promise.resolve(failure('INVALID_INPUT', z.prettifyError(parsed.error)));
  const { waitMs, timeoutMs } = parsed.data;

  return withDebugger(tabId, FIREFOX_HINT, async (session) => {
    const deadline = Date.now() + timeoutMs;
    const found = await scan(session);
    if (!found) {
      return failure(
        'CAPTCHA_NOT_FOUND',
        'No captcha widget on this page. If the page is still blocked, take a fresh page.getPageInfo — the block may be something else.',
      );
    }
    if (!found.point || found.state !== 'idle') return success({ ...report(found), clicked: false });

    await dispatchClick(session, clickPlanFor(found.point));
    const settled = await awaitVerdict(session, found, Math.min(waitMs, deadline - Date.now()));
    return success({ ...report(settled), clicked: true });
  });
}

function clickPlanFor(point: Point): ClickPlan {
  return {
    point,
    from: { x: Math.max(point.x - 140, 0), y: Math.max(point.y - 90, 0) },
    ...CLICK_STYLE,
  };
}

function report(seen: Sighting) {
  return {
    found: true,
    vendor: seen.vendor.id,
    label: seen.vendor.label,
    kind: seen.vendor.kind,
    state: seen.state,
    solved: seen.state === 'solved',
    hasToken: seen.hasToken,
    bounds: seen.bounds,
    point: seen.point,
    note: seen.note,
  };
}

async function scan(session: DebuggerSession): Promise<Sighting | null> {
  await readDocument(session);
  for (const vendor of CAPTCHA_VENDORS) {
    if (await present(session, vendor)) return inspect(session, vendor);
  }
  return null;
}

async function present(session: DebuggerSession, vendor: CaptchaVendor): Promise<boolean> {
  for (const marker of vendor.hostMarkers) {
    if ((await findNodes(session, marker)).length) return true;
  }
  return false;
}

async function inspect(session: DebuggerSession, vendor: CaptchaVendor): Promise<Sighting> {
  const frames = vendor.frame ? await frameSessions(session) : [];
  const hasToken = vendor.solvedInPage ? await truthy(session, vendor.solvedInPage) : false;

  if (hasToken || (await checkedInFrame(session, vendor, frames))) {
    return { vendor, frames, state: 'solved', hasToken };
  }
  if (vendor.kind === 'invisible') {
    return { vendor, frames, state: 'invisible', hasToken, note: `${vendor.label} scores in the background — there is nothing to click.` };
  }
  if (vendor.challengeFrame && (await truthy(session, visibleFrame(vendor.challengeFrame)))) {
    return {
      vendor,
      frames,
      state: 'needsHuman',
      hasToken,
      bounds: await frameBounds(session, vendor.challengeFrame),
      note: `${vendor.label} has escalated to a challenge only a person can answer.`,
    };
  }
  if (vendor.kind === 'interactive') {
    return {
      vendor,
      frames,
      state: 'needsHuman',
      hasToken,
      bounds: vendor.frame ? await frameBounds(session, vendor.frame) : undefined,
      note: `${vendor.label} asks for a puzzle rather than a checkbox.`,
    };
  }

  const located = await locateCheckbox(session, vendor, frames);
  return {
    vendor,
    frames,
    state: located.point ? 'idle' : 'needsHuman',
    hasToken,
    bounds: located.bounds,
    point: located.point,
    note: located.note,
  };
}

async function awaitVerdict(session: DebuggerSession, seen: Sighting, budgetMs: number): Promise<Sighting> {
  const { vendor, frames } = seen;
  const until = Date.now() + Math.max(0, budgetMs);

  while (Date.now() < until) {
    await settle(POLL_INTERVAL_MS);
    const hasToken = vendor.solvedInPage ? await truthy(session, vendor.solvedInPage) : false;
    if (hasToken || (await checkedInFrame(session, vendor, frames))) {
      return { ...seen, state: 'solved', hasToken };
    }
    if (vendor.challengeFrame && (await truthy(session, visibleFrame(vendor.challengeFrame)))) {
      return {
        ...seen,
        state: 'needsHuman',
        hasToken,
        bounds: (await frameBounds(session, vendor.challengeFrame)) ?? seen.bounds,
        note: `${vendor.label} answered the checkbox with a challenge only a person can answer.`,
      };
    }
  }
  return {
    ...seen,
    state: 'pending',
    note: `${vendor.label} accepted the click but had not settled within the wait — call page.findCaptcha again to re-check.`,
  };
}

async function locateCheckbox(
  session: DebuggerSession,
  vendor: CaptchaVendor,
  frames: FrameSession[],
): Promise<{ bounds?: Rect; point?: Point; note?: string }> {
  if (!vendor.checkbox) return { note: `${vendor.label} exposes no checkbox to click.` };

  if (!vendor.frame) {
    const [nodeId] = await findNodes(session, vendor.checkbox);
    const bounds = nodeId ? await boxOf(session, nodeId) : null;
    return bounds
      ? { bounds, point: centreOf(bounds) }
      : { note: `${vendor.label}’s checkbox is in the page but has no box on screen — scroll it into view, then retry.` };
  }

  const [frameNode] = await findNodes(session, `iframe[src*="${vendor.frame}"]`);
  const bounds = frameNode ? await boxOf(session, frameNode) : null;
  if (!bounds) return { note: `${vendor.label}’s widget iframe is not painted — scroll it into view, then retry.` };

  const child = frames.find((frame) => frame.url.includes(vendor.frame!));
  if (!child) return { bounds, note: `Chrome did not expose ${vendor.label}’s widget frame, so its checkbox cannot be located.` };

  const inner: DebuggerSession = { tabId: session.tabId, sessionId: child.sessionId };
  await readDocument(inner).catch(() => {});
  const [checkboxNode] = await findNodes(inner, vendor.checkbox);
  const box = checkboxNode ? await boxOf(inner, checkboxNode) : null;
  if (!box) return { bounds, note: `${vendor.label}’s widget is open but its checkbox could not be located inside the frame.` };

  const point = { x: Math.round(bounds.x + box.x + box.width / 2), y: Math.round(bounds.y + box.y + box.height / 2) };
  return contains(bounds, point)
    ? { bounds, point }
    : { bounds, note: `${vendor.label}’s checkbox resolved outside its own frame — refusing to click a guessed point.` };
}

async function checkedInFrame(
  session: DebuggerSession,
  vendor: CaptchaVendor,
  frames: FrameSession[],
): Promise<boolean> {
  if (!vendor.solvedInFrame || !vendor.frame) return false;
  const child = frames.find((frame) => frame.url.includes(vendor.frame!));
  if (!child) return false;
  return truthy({ tabId: session.tabId, sessionId: child.sessionId }, vendor.solvedInFrame);
}

async function frameBounds(session: DebuggerSession, fragment: string): Promise<Rect | undefined> {
  const [nodeId] = await findNodes(session, `iframe[src*="${fragment}"]`);
  return (nodeId ? await boxOf(session, nodeId) : null) ?? undefined;
}

const visibleFrame = (fragment: string) =>
  `[...document.querySelectorAll('iframe')].some((f) => f.src.includes(${JSON.stringify(fragment)}) && f.getBoundingClientRect().height > 40 && getComputedStyle(f).visibility !== 'hidden' && getComputedStyle(f.parentElement || f).visibility !== 'hidden')`;

const centreOf = (box: Rect): Point => ({
  x: Math.round(box.x + box.width / 2),
  y: Math.round(box.y + box.height / 2),
});

const contains = (box: Rect, point: Point) =>
  point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

async function readDocument(session: DebuggerSession): Promise<void> {
  await send(session, 'DOM.enable');
  await send(session, 'DOM.getDocument', { depth: -1, pierce: true });
}

async function findNodes(session: DebuggerSession, selector: string): Promise<number[]> {
  const search = await send<{ searchId?: string; resultCount?: number }>(session, 'DOM.performSearch', {
    query: selector,
    includeUserAgentShadowDOM: false,
  }).catch(() => null);
  if (!search?.searchId) return [];

  const found = search.resultCount
    ? await send<{ nodeIds?: number[] }>(session, 'DOM.getSearchResults', {
        searchId: search.searchId,
        fromIndex: 0,
        toIndex: search.resultCount,
      }).catch(() => null)
    : null;
  await send(session, 'DOM.discardSearchResults', { searchId: search.searchId }).catch(() => {});
  return found?.nodeIds ?? [];
}

async function boxOf(session: DebuggerSession, nodeId: number): Promise<Rect | null> {
  const box = await send<{ model?: { content?: number[] } }>(session, 'DOM.getBoxModel', { nodeId }).catch(() => null);
  const quad = box?.model?.content;
  if (!quad || quad.length < 8) return null;

  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return width > 0 && height > 0
    ? { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
    : null;
}

async function truthy(session: DebuggerSession, expression: string): Promise<boolean> {
  const evaluated = await send<{ result?: { value?: unknown } }>(session, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  }).catch(() => null);
  return evaluated?.result?.value === true;
}
