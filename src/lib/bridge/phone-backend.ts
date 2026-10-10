import { browser } from 'wxt/browser';
import { z } from 'zod';
import type { LensCommand } from '@/lib/actions/page/lens';
import { PICK_DEFAULT_TIMEOUT_MS } from '@/lib/actions/page/pick-element';
import { pressKey } from '@/lib/actions/page/press-key';
import { scrollTo } from '@/lib/actions/page/scroll-to';
import { switchFrame } from '@/lib/actions/page/switch-frame';
import { typeText } from '@/lib/actions/page/type-text';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { PHONE_API } from '@/lib/phone/page-api';
import { drag, keyPress, onScreen, tap, typing, wheel, type InputStep, type Point, type Viewport } from '@/lib/phone/touch';
import type { EvaluateReply, ToolkitPlace } from './code-toolkit';
import { currentTarget, type PhoneSession } from './phone';
import { attachedSession, steerLensFromMirror } from './phone-mirror';
import { refusalFor } from './site-guard';
import { sendCdp } from './socket';

const BUNDLE = '/phone-page.js';
const WORLD = 'browsentic';
const CALL_TIMEOUT_MS = 20_000;
const LOAD_TIMEOUT_MS = 15_000;
const LOAD_POLL_MS = 150;
const SETTLE_MS = 300;
const SCROLL_PAGE = 0.85;
const MAX_SHOT_SCREENS = 8;
const PICK_PADDING_CSS_PX = 16;
const MAX_PICK_SHOT_SIDE = 1200;
const PICK_SHOT_QUALITY = 85;
const PAINT_SETTLE_MS = 120;
/** Under the relay's 180 s cap on one command, so the page's own timeout answers first. */
const MAX_PICK_WAIT_MS = 170_000;
const GONE = 'The phone disconnected. Reconnect it and switch Android on again.';

type CdpResult = ActionResult<Record<string, unknown>>;

interface Here {
  phone: PhoneSession;
  targetId: string;
  url: string;
  sessionId: string;
  cdp(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<CdpResult>;
}

let bundle: Promise<string> | null = null;
const worlds = new Map<string, number>();
const topFrames = new Map<string, string>();
const framePaths = new Map<string, { url: string; frames: string[] }>();

const loadBundle = (): Promise<string> =>
  (bundle ??= fetch((browser.runtime.getURL as (path: string) => string)(BUNDLE)).then((response) => {
    if (!response.ok) throw new Error(`the phone page bundle is missing (${response.status})`);
    return response.text();
  }));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function hereOn(phone: PhoneSession): Promise<Here | null> {
  const target = currentTarget(phone);
  const sessionId = target && (await attachedSession(phone.serial, target.targetId));
  if (!target || !sessionId) return null;
  return {
    phone,
    targetId: target.targetId,
    url: target.url,
    sessionId,
    cdp: (method, params, timeoutMs) => sendCdp(phone.serial, method, params, sessionId, timeoutMs),
  };
}

/** Waits for the phone tab's document to finish loading, read from its main world, which outlives no navigation but needs none. */
export async function waitForLoad(here: Here): Promise<{ url: string; title: string; loaded: boolean }> {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let seen = { url: here.url, title: '', readyState: '' };
  while (Date.now() < deadline) {
    await pause(LOAD_POLL_MS);
    const state = await here.cdp('Runtime.evaluate', {
      expression: 'JSON.stringify({ url: location.href, title: document.title, readyState: document.readyState })',
      returnByValue: true,
    });
    if (!state.ok) continue;
    seen = JSON.parse(String((state.data.result as { value?: unknown }).value ?? '{}'));
    if (seen.readyState === 'complete' && seen.url !== 'about:blank') return { url: seen.url, title: seen.title, loaded: true };
  }
  return { url: seen.url, title: seen.title, loaded: false };
}

async function topFrame(here: Here): Promise<string> {
  const known = topFrames.get(here.sessionId);
  if (known) return known;
  const tree = await here.cdp('Page.getFrameTree');
  const id = tree.ok ? String((tree.data.frameTree as { frame: { id: string } }).frame.id) : here.targetId;
  topFrames.set(here.sessionId, id);
  return id;
}

/** The frame a page action runs in: the one `switchFrame` entered, until the tab's address changes. */
async function focusedFrame(here: Here): Promise<{ frameId: string; path: string[] }> {
  const held = framePaths.get(here.targetId);
  const path = held && held.url === here.url ? held.frames : [];
  return { frameId: path.at(-1) ?? (await topFrame(here)), path };
}

/**
 * An isolated world per frame, with the action bundle evaluated in it on first use. A world dies
 * with its document, so a call that finds its context gone makes the world again and retries once.
 */
async function world(here: Here, frameId: string, fresh: boolean): Promise<number | null> {
  const key = `${here.sessionId}:${frameId}`;
  const known = worlds.get(key);
  if (known !== undefined && !fresh) return known;
  worlds.delete(key);
  const created = await here.cdp('Page.createIsolatedWorld', { frameId, worldName: WORLD });
  if (!created.ok) return null;
  const contextId = Number(created.data.executionContextId);
  const loaded = await here.cdp('Runtime.evaluate', { expression: await loadBundle(), contextId });
  if (!loaded.ok || loaded.data.exceptionDetails) return null;
  worlds.set(key, contextId);
  return contextId;
}

const contextGone = (message: string) => /Cannot find context|context was destroyed|Execution context/i.test(message);

async function evaluateIn(here: Here, frameId: string, expression: string, options: { timeoutMs?: number; byValue?: boolean } = {}): Promise<ActionResult<unknown>> {
  const { timeoutMs = CALL_TIMEOUT_MS, byValue = true } = options;
  for (const fresh of [false, true]) {
    const contextId = await world(here, frameId, fresh);
    if (contextId === null) return failure('PHONE_PAGE_UNREACHABLE', 'Browsentic could not reach this page on the phone. It may still be loading; try again.');
    const evaluated = await here.cdp('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: byValue }, timeoutMs);
    if (!evaluated.ok) {
      if (!fresh && contextGone(evaluated.error.message)) continue;
      return evaluated;
    }
    const thrown = evaluated.data.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
    if (thrown) {
      const message = thrown.exception?.description?.split('\n')[0] ?? thrown.text ?? 'The page threw';
      if (!fresh && contextGone(message)) continue;
      return failure('ACTION_FAILED', message);
    }
    const result = evaluated.data.result as { value?: unknown } | undefined;
    return success(byValue ? result?.value : result);
  }
  return failure('PHONE_PAGE_UNREACHABLE', 'The page on the phone kept changing under Browsentic. Try again once it has loaded.');
}

const declaredWait = (input: unknown): number | undefined => {
  const declared = (input as { timeoutMs?: unknown } | undefined)?.timeoutMs;
  return typeof declared === 'number' && declared > 0 ? declared + 5_000 : undefined;
};

/** The action's own page-side code, unchanged, run in the phone page's isolated world. */
async function inPage(here: Here, action: string, input: unknown, frameId?: string): Promise<ActionResult> {
  const frame = frameId ?? (await focusedFrame(here)).frameId;
  const ran = await evaluateIn(here, frame, `${PHONE_API}.dispatch(${JSON.stringify(action)}, ${JSON.stringify(input ?? {})})`, { timeoutMs: declaredWait(input) });
  return ran.ok ? (ran.data as ActionResult) : ran;
}

async function visualViewport(here: Here): Promise<Viewport | null> {
  const metrics = await here.cdp('Page.getLayoutMetrics');
  const visual = metrics.ok ? (metrics.data.cssVisualViewport as { offsetX: number; offsetY: number; clientWidth: number; clientHeight: number }) : null;
  return visual && { offsetX: visual.offsetX, offsetY: visual.offsetY, width: visual.clientWidth, height: visual.clientHeight };
}

/** A frame's page point in the top document: the frame's content box is where its own coordinates start. */
async function inTopDocument(here: Here, point: Point): Promise<Point> {
  const { path } = await focusedFrame(here);
  const innermost = path.at(-1);
  if (!innermost) return point;
  await here.cdp('DOM.getDocument', { depth: 0 });
  const owner = await here.cdp('DOM.getFrameOwner', { frameId: innermost });
  const box = owner.ok ? await here.cdp('DOM.getBoxModel', { backendNodeId: owner.data.backendNodeId }) : null;
  const content = box?.ok ? ((box.data.model as { content: number[] }).content ?? []) : [];
  return { x: point.x + (content[0] ?? 0), y: point.y + (content[1] ?? 0) };
}

async function screenPoint(here: Here, point: Point): Promise<Point | null> {
  const viewport = await visualViewport(here);
  return viewport && onScreen(await inTopDocument(here, point), viewport);
}

/** `screenPoint` backwards: where a touch would land, in the client coordinates of the frame actions run in. */
async function framePoint(here: Here, point: Point): Promise<Point | null> {
  const viewport = await visualViewport(here);
  if (!viewport) return null;
  const frame = await inTopDocument(here, { x: 0, y: 0 });
  return { x: point.x + viewport.offsetX - frame.x, y: point.y + viewport.offsetY - frame.y };
}

async function play(here: Here, steps: InputStep[]): Promise<CdpResult | null> {
  for (const step of steps) {
    const sent = await here.cdp(step.method, step.params);
    if (!sent.ok) return sent;
    if (step.waitMs) await pause(step.waitMs);
  }
  return null;
}

const missed = () => failure('TAP_MISSED', 'That point is outside the visible part of the phone screen, so nothing was touched. Scroll it into view first.');

const PLAN_ONLY = ['point', 'from', 'button', 'clickCount', 'modifiers', 'moveSteps', 'hoverMs', 'holdMs'];

/** A click on the phone is a real tap where the page says the element's centre is: the page sees touch, pointer and click events, all trusted. */
async function tapOn(here: Here, input: Record<string, unknown>, asClick: boolean): Promise<ActionResult> {
  const planned = await inPage(here, 'page.trustedClick', asClick ? { target: input.target, scrollIntoView: input.scrollIntoView ?? true } : input);
  if (!planned.ok) return planned;
  const plan = planned.data as Record<string, unknown> & { point: Point };
  const at = await screenPoint(here, plan.point);
  if (!at) return missed();
  const failed = await play(here, tap(at));
  if (failed) return failed;
  const described = Object.fromEntries(Object.entries(plan).filter(([key]) => !PLAN_ONLY.includes(key)));
  return success(asClick ? described : { ...described, tapped: at });
}

async function dragOn(here: Here, input: Record<string, unknown>): Promise<ActionResult> {
  const planned = await inPage(here, 'page.dragElement', { ...input, trusted: true });
  if (!planned.ok) return planned;
  const plan = planned.data as { grip: Point; drop: Point; steps: number; from?: unknown; to?: unknown; mechanism: string };
  const [from, to] = await Promise.all([screenPoint(here, plan.grip), screenPoint(here, plan.drop)]);
  if (!from || !to) return missed();
  const failed = await play(here, drag(from, to, plan.steps));
  return failed ?? success({ from: plan.from, to: plan.to, mechanism: plan.mechanism, trusted: true, gesture: 'touch' });
}

const SELECT_FOCUSED = `(() => { const el = document.activeElement; if (el && typeof el.select === 'function') el.select(); else if (el && el.isContentEditable) document.execCommand('selectAll'); return !!el; })()`;

/** Typing focuses the field in the page, which keeps the phone's own keyboard closed, then types with real input events. */
async function typeOn(here: Here, input: unknown): Promise<ActionResult> {
  const parsed = typeText.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { target, text, clear } = parsed.data;
  const focused = target ? await inPage(here, 'page.focusInput', { target }) : null;
  if (focused && !focused.ok) return focused;
  const { frameId } = await focusedFrame(here);
  if (clear) await evaluateIn(here, frameId, SELECT_FOCUSED);
  const failed = await play(here, typing(text));
  return failed ?? success({ ...(focused?.ok ? (focused.data as object) : {}), typed: text.length, cleared: clear });
}

async function pressOn(here: Here, input: unknown): Promise<ActionResult> {
  const parsed = pressKey.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { key, modifiers, target } = parsed.data;
  if (target) {
    const focused = await inPage(here, 'page.focusInput', { target });
    if (!focused.ok && focused.error.code !== 'INVALID_TARGET') return focused;
  }
  const failed = await play(here, keyPress(key, modifiers));
  return failed ?? success({ pressed: key, modifiers });
}

/** Scrolling by a screen is wheel steps at the middle of the screen, so lazy lists load as they would under a finger. Everything else is the page's own scroll. */
async function scrollOn(here: Here, input: unknown): Promise<ActionResult> {
  const parsed = scrollTo.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { direction } = parsed.data;
  if (direction !== 'up' && direction !== 'down') return inPage(here, scrollTo.name, { ...parsed.data, behavior: 'instant' });
  const viewport = await visualViewport(here);
  if (!viewport) return failure('PHONE_GONE', GONE);
  const middle = { x: viewport.width / 2, y: viewport.height / 2 };
  const failed = await play(here, wheel(middle, (direction === 'down' ? 1 : -1) * Math.round(viewport.height * SCROLL_PAGE)));
  if (failed) return failed;
  const position = await evaluateIn(here, await topFrame(here), '({ scrollX: Math.round(scrollX), scrollY: Math.round(scrollY) })');
  return success({ direction, ...(position.ok ? (position.data as object) : {}) });
}

interface ShotPlan {
  mode: 'fullPage' | 'viewport' | 'element';
  dpr: number;
  viewport: { w: number; h: number };
  region: { x: number; y: number; w: number; h: number };
  format: 'png' | 'jpeg';
  quality?: number;
  maxLongSide: number;
}

/** A screenshot's clip in CSS px, its scale against device pixels, and the image size that comes out (spike Q9). */
export function shotClip(plan: ShotPlan): { clip: { x: number; y: number; width: number; height: number; scale: number }; width: number; height: number; truncated: boolean } {
  const height = Math.min(plan.region.h, plan.viewport.h * MAX_SHOT_SCREENS);
  const fit = Math.min(1, plan.maxLongSide / Math.max(plan.region.w, height));
  return {
    clip: { x: plan.region.x, y: plan.region.y, width: plan.region.w, height, scale: fit / (plan.dpr || 1) },
    width: Math.max(1, Math.round(plan.region.w * fit)),
    height: Math.max(1, Math.round(height * fit)),
    truncated: height < plan.region.h,
  };
}

async function screenshotOn(here: Here, input: unknown): Promise<ActionResult> {
  const planned = await inPage(here, 'page.screenshot', input, await topFrame(here));
  if (!planned.ok) return planned;
  const plan = planned.data as ShotPlan;
  const { clip, width, height, truncated } = shotClip(plan);
  const shot = await here.cdp(
    'Page.captureScreenshot',
    { format: plan.format, ...(plan.format === 'jpeg' ? { quality: plan.quality ?? 80 } : {}), clip, captureBeyondViewport: plan.mode !== 'viewport', fromSurface: true },
    30_000,
  );
  if (!shot.ok) return shot;
  return success({ format: plan.format, width, height, dataUrl: `data:image/${plan.format};base64,${String(shot.data.data)}`, ...(truncated ? { truncated } : {}) });
}

interface PickCapture {
  region: { x: number; y: number; w: number; h: number };
  viewport: { w: number; h: number };
  dpr: number;
}

interface LayoutViewport {
  pageX: number;
  pageY: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * The picked element's photograph: its box padded and kept on screen, in the document coordinates a
 * phone screenshot clips in, at device resolution up to the longest side the desktop pick allows.
 */
export function pickClip(corner: Point, capture: PickCapture, layout: LayoutViewport): { clip: { x: number; y: number; width: number; height: number; scale: number }; width: number; height: number } | null {
  const x = Math.max(0, corner.x - PICK_PADDING_CSS_PX);
  const y = Math.max(0, corner.y - PICK_PADDING_CSS_PX);
  const w = Math.min(layout.clientWidth, corner.x + capture.region.w + PICK_PADDING_CSS_PX) - x;
  const h = Math.min(layout.clientHeight, corner.y + capture.region.h + PICK_PADDING_CSS_PX) - y;
  if (w < 1 || h < 1) return null;
  const dpr = capture.dpr || 1;
  const perCssPx = Math.min(dpr, MAX_PICK_SHOT_SIDE / Math.max(w, h));
  return {
    clip: { x: x + layout.pageX, y: y + layout.pageY, width: w, height: h, scale: perCssPx / dpr },
    width: Math.max(1, Math.round(w * perCssPx)),
    height: Math.max(1, Math.round(h * perCssPx)),
  };
}

/**
 * A-Eye on the phone: the pick's own lens in the page, steered from the mirror tab while it waits
 * (a tap on the phone itself still picks), then the element photographed before anything moves it.
 */
async function pickOn(here: Here, input: Record<string, unknown>): Promise<ActionResult> {
  const timeoutMs = Math.min(Number(input.timeoutMs) || PICK_DEFAULT_TIMEOUT_MS, MAX_PICK_WAIT_MS);
  const { frameId } = await focusedFrame(here);
  const release = steerLensFromMirror(here.targetId, (command) => steerLensOn(here, frameId, command));
  const picked = await inPage(here, 'page.pickElement', { ...input, timeoutMs }, frameId).finally(release);
  if (!picked.ok) return picked;
  const { capture, ...data } = picked.data as { capture?: PickCapture } & Record<string, unknown>;
  const shot = capture ? await pickShot(here, capture).catch(() => null) : null;
  return success(shot ? { ...data, shot } : data);
}

async function steerLensOn(here: Here, frameId: string, command: LensCommand): Promise<void> {
  const placed = 'x' in command ? await framePoint(here, command) : {};
  if (placed) await evaluateIn(here, frameId, `${PHONE_API}.lens(${JSON.stringify({ ...command, ...placed })})`);
}

async function pickShot(here: Here, capture: PickCapture): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const metrics = await here.cdp('Page.getLayoutMetrics');
  if (!metrics.ok) return null;
  const planned = pickClip(await inTopDocument(here, { x: capture.region.x, y: capture.region.y }), capture, metrics.data.cssLayoutViewport as LayoutViewport);
  if (!planned) return null;
  await pause(PAINT_SETTLE_MS);
  const shot = await here.cdp('Page.captureScreenshot', { format: 'jpeg', quality: PICK_SHOT_QUALITY, clip: planned.clip, fromSurface: true }, 30_000);
  return shot.ok ? { dataUrl: `data:image/jpeg;base64,${String(shot.data.data)}`, width: planned.width, height: planned.height } : null;
}

async function switchFrameOn(here: Here, input: unknown): Promise<ActionResult> {
  const parsed = switchFrame.input.safeParse(input ?? {});
  if (!parsed.success) return failure('INVALID_INPUT', z.prettifyError(parsed.error));
  const { frame, to } = parsed.data;
  const { frameId, path } = await focusedFrame(here);
  if (!frame) {
    const frames = to === 'parent' ? path.slice(0, -1) : [];
    framePaths.set(here.targetId, { url: here.url, frames });
    return success({ frame: frames.length ? { depth: frames.length } : 'top' });
  }
  const element = await evaluateIn(here, frameId, `${PHONE_API}.frame(${JSON.stringify(frame)})`, { byValue: false });
  if (!element.ok) return element;
  const described = await here.cdp('DOM.describeNode', { objectId: (element.data as { objectId?: string }).objectId });
  const childFrame = described.ok ? (described.data.node as { frameId?: string } | undefined)?.frameId : undefined;
  if (!childFrame) return failure('UNSUPPORTED', 'That frame cannot be entered on the phone: Chrome keeps it in another process.');
  const frames = [...path, childFrame];
  framePaths.set(here.targetId, { url: here.url, frames });
  return success({ frame: { depth: frames.length, frameId: childFrame } });
}

async function thenLoaded(here: Here, action: string, input: unknown): Promise<ActionResult> {
  const result = await inPage(here, action, input);
  if (!result.ok) return result;
  await pause(SETTLE_MS);
  const landing = await waitForLoad(here);
  return success({ ...(result.data as object), finalUrl: landing.url, loaded: landing.loaded });
}

type PhoneTool = (here: Here, input: Record<string, unknown>, action: string) => Promise<ActionResult>;

const TOOLS: Record<string, PhoneTool> = {
  'page.clickElement': (here, input) => tapOn(here, input, true),
  'page.trustedClick': (here, input) => tapOn(here, input, false),
  'page.dragElement': dragOn,
  'page.typeText': typeOn,
  'page.pressKey': pressOn,
  'page.scrollTo': scrollOn,
  'page.screenshot': screenshotOn,
  'page.switchFrame': switchFrameOn,
  'page.pickElement': pickOn,
  'page.searchSite': (here, input, action) => thenLoaded(here, action, input),
  'page.submitForm': (here, input, action) => thenLoaded(here, action, input),
};

const TOP_DOCUMENT_ONLY = 'Page code on the phone installs in the top document. Call page.switchFrame with no arguments first.';

/** The phone's front tab as the home of approved page code: installed in its top document's main world, called from the bundle's world. */
export async function phoneToolkitPlace(phone: PhoneSession): Promise<ToolkitPlace | null> {
  const here = await hereOn(phone);
  if (!here) return null;
  return {
    key: `phone:${here.targetId}`,
    evaluate: async (source) => {
      if ((await focusedFrame(here)).path.length) return failure('FRAME_UNREACHABLE', TOP_DOCUMENT_ONLY);
      const evaluated = await here.cdp('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true });
      return evaluated.ok ? success(evaluated.data as EvaluateReply) : evaluated;
    },
    call: (input) => inPage(here, 'page.runCode', input),
    refusal: () => refusalFor(here.url),
  };
}

/** Every page-side tool on the phone: its own code in the page where it can be, real input where the page cannot fake it. */
export async function pageSideOnPhone(action: string, input: unknown, phone: PhoneSession): Promise<ActionResult> {
  const here = await hereOn(phone);
  if (!here) return failure('PHONE_GONE', GONE);
  const tool = TOOLS[action];
  return tool ? tool(here, (input ?? {}) as Record<string, unknown>, action) : inPage(here, action, input);
}
