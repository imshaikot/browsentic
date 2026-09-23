import { z } from 'zod';
import {
  CAPTCHA_VENDORS,
  isInvisibleWidget,
  markersTell,
  vendorById,
  vendorForFrame,
  type CaptchaVendor,
} from '@/lib/actions/page/captcha-vendors';
import type { Point } from '@/lib/actions/page/pointer';
import { solveCaptcha } from '@/lib/actions/page/solve-captcha';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { settle, withDebugger } from './cdp';
import {
  areaOf,
  centreOf,
  clickRects,
  insideArea,
  isSettled,
  photograph,
  pointsOnPage,
  readChallenge,
  selectedTiles,
  signatureOf,
  type CanvasReading,
  type ChallengeReading,
  type GridReading,
  type Photo,
} from './captcha-challenge';
import { FrameGraph, type FrameBox, type FrameNode, type FrameView, type Rect } from './frame-graph';

type CaptchaState = 'idle' | 'loading' | 'hidden' | 'pending' | 'solved' | 'challenge' | 'needsHuman' | 'invisible';

interface Widget {
  vendor: CaptchaVendor;
  host: FrameNode;
  frame?: FrameNode;
  challenge?: FrameNode;
  invisible: boolean;
}

interface Sighting {
  widget: Widget;
  state: CaptchaState;
  hasToken: boolean;
  depth: number;
  bounds?: Rect;
  point?: Point;
  note?: string;
}

interface Answer {
  tiles?: number[];
  points?: Point[];
  reload?: boolean;
}

interface Clock {
  until: number;
}

const FIREFOX_HINT =
  'Reading a captcha needs Chrome’s debugger, which Firefox does not expose — solve the captcha in the page yourself.';

const POLL_MS = 400;
const APPEAR_MS = 8_000;
const LOAD_MS = 15_000;
const IMAGES_MS = 8_000;
const SETTLE_MS = 350;
const REFILL_MS = 12_000;
const GONE_CONFIRMATIONS = 2;
const MAX_MARKER_FRAMES = 25;

const STATE_RANK: Record<CaptchaState, number> = {
  challenge: 0,
  idle: 1,
  loading: 2,
  pending: 3,
  needsHuman: 4,
  solved: 5,
  invisible: 6,
  hidden: 7,
};

const MARKERS = CAPTCHA_VENDORS.map(({ id, hostMarkers }) => ({ id, selectors: hostMarkers }));

export function findCaptchaInTab(tabId: number): Promise<ActionResult> {
  return withDebugger(tabId, FIREFOX_HINT, (session) =>
    withGraph(session, async (graph) => {
      const view = await graph.view();
      const seen = await scan(view);
      if (!seen) return success({ found: false });
      const reading = seen.state === 'challenge' ? await challengeOf(view, seen) : null;
      return success({ ...report(seen), ...(reading ? { challenge: describe(reading, null) } : {}) });
    }),
  );
}

export function solveCaptchaInTab(tabId: number, input: unknown): Promise<ActionResult> {
  const parsed = solveCaptcha.input.safeParse(input ?? {});
  if (!parsed.success) return Promise.resolve(failure('INVALID_INPUT', z.prettifyError(parsed.error)));
  const { waitMs, timeoutMs, tiles, points, reload } = parsed.data;

  return withDebugger(tabId, FIREFOX_HINT, (session) =>
    withGraph(session, (graph) => {
      const clock = clockOf(timeoutMs);
      return tiles || points || reload ? answer(graph, { tiles, points, reload }, clock, waitMs) : attempt(graph, clock, waitMs);
    }),
  );
}

async function withGraph(
  session: Parameters<typeof FrameGraph.open>[0],
  run: (graph: FrameGraph) => Promise<ActionResult>,
): Promise<ActionResult> {
  const graph = await FrameGraph.open(session);
  try {
    return await run(graph);
  } finally {
    await graph.close();
  }
}

async function attempt(graph: FrameGraph, clock: Clock, waitMs: number): Promise<ActionResult> {
  const appeared = await watch(graph, Math.min(clock.until, Date.now() + APPEAR_MS), (seen) => !!seen);
  if (!appeared.seen) {
    return failure(
      'CAPTCHA_NOT_FOUND',
      'No captcha widget on this page, in any frame. If the page is still blocked, take a fresh page.getPageInfo — the block may be something else.',
    );
  }

  const ready = await watch(graph, Math.min(clock.until, Date.now() + LOAD_MS), (seen) => !seen || !waiting(seen), {
    confirmGone: true,
  });
  if (!ready.seen) return success({ ...report(appeared.seen), state: 'solved', solved: true, note: gone(appeared.seen) });
  const seen = ready.seen;
  if (seen.state === 'challenge') return presentChallenge(graph, seen, clock);
  if (seen.state === 'idle' && seen.point) return tick(graph, seen, clock, waitMs);
  if (seen.state !== 'loading') return success(report(seen));

  const guessed = await checkboxByOffset(graph, seen);
  if (guessed) return tick(graph, { ...seen, state: 'idle', point: guessed }, clock, waitMs);
  return success({
    ...report(seen),
    state: 'pending',
    note: `${seen.widget.vendor.label} never put up a checkbox within the wait — call page.solveCaptcha again in a few seconds.`,
  });
}

async function tick(graph: FrameGraph, seen: Sighting, clock: Clock, waitMs: number): Promise<ActionResult> {
  const aimed = await inView(graph, seen);
  if (!aimed.point) return success(report(aimed));
  await clickRects(graph.root, [{ ...aimed.point, width: 0, height: 0 }]).catch(() => undefined);
  return verdictAfterTick(graph, aimed, clock, waitMs);
}

async function checkboxByOffset(graph: FrameGraph, seen: Sighting): Promise<Point | null> {
  const { frame, vendor } = seen.widget;
  if (!frame || !vendor.checkboxAt) return null;
  const view = await graph.view();
  const box = await view.box(frame);
  if (!box?.shown || !onScreen(box, await view.layout())) return null;
  return { x: Math.round(box.x + vendor.checkboxAt.x), y: Math.round(box.y + vendor.checkboxAt.y) };
}

async function verdictAfterTick(graph: FrameGraph, before: Sighting, clock: Clock, waitMs: number): Promise<ActionResult> {
  const until = Math.min(clock.until, Date.now() + waitMs);
  const settled = await watch(graph, until, (seen) => !seen || ['solved', 'challenge', 'needsHuman'].includes(seen.state), {
    confirmGone: true,
  });
  if (!settled.seen) return success({ ...report(before), state: 'solved', solved: true, clicked: true, note: gone(before) });
  if (settled.seen.state === 'challenge') return presentChallenge(graph, settled.seen, clock, { clicked: true });
  if (settled.timedOut) {
    return success({
      ...report(settled.seen),
      state: 'pending',
      clicked: true,
      note: `${before.widget.vendor.label} took the click but had not settled within the wait — call page.findCaptcha to re-check rather than clicking twice.`,
    });
  }
  return success({ ...report(settled.seen), clicked: true });
}

async function answer(graph: FrameGraph, given: Answer, clock: Clock, waitMs: number): Promise<ActionResult> {
  const view = await graph.view();
  const seen = await scan(view);
  if (!seen) return failure('CAPTCHA_NOT_FOUND', 'The captcha is gone from the page, so there is nothing left to answer.');
  if (seen.state !== 'challenge') {
    return success({
      ...report(seen),
      note:
        seen.state === 'solved'
          ? `${seen.widget.vendor.label} is already satisfied.`
          : 'No challenge is open, so there was nothing to answer — call page.solveCaptcha with no answer to start over.',
    });
  }
  const reading = await challengeOf(view, seen);
  if (!reading) return success({ ...report(seen), state: 'needsHuman', note: unreadable(seen) });
  const before = signatureOf(reading);

  if (given.reload) {
    if (!reading.reload) return failure('INVALID_INPUT', `${seen.widget.vendor.label} offers no way to swap this challenge — answer it instead.`);
    await clickRects(graph.root, [reading.reload]);
    return presentChallenge(graph, seen, clock, { changedFrom: before });
  }

  const planned = reading.kind === 'tiles' ? planTiles(reading, given.tiles) : await planPoints(view, reading, given.points);
  if ('error' in planned) return failure('INVALID_INPUT', planned.error);
  const last = await clickRects(graph.root, planned.clicks);

  if (reading.kind === 'tiles' && reading.dynamic && planned.clicks.length) {
    const fresh = await refill(graph, reading, planned.clicks, clock);
    return presentChallenge(graph, seen, clock, { fresh });
  }
  if (!reading.submit) {
    return success({ ...report(seen), state: 'needsHuman', note: `${seen.widget.vendor.label} shows no button to submit the answer.` });
  }
  await clickRects(graph.root, [reading.submit], last);
  return verdictAfterSubmit(graph, seen, before, clock, waitMs);
}

function planTiles(grid: GridReading, tiles: number[] | undefined): { clicks: Rect[] } | { error: string } {
  if (!tiles) return { error: 'This challenge is a tile grid — answer it with "tiles", the numbers painted on its image.' };
  const count = grid.tiles.length;
  const wanted = [...new Set(tiles)];
  const outside = wanted.filter((tile) => tile < 1 || tile > count);
  if (outside.length) {
    return { error: `This challenge has tiles 1–${count}; ${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not among them.` };
  }
  const toggles = grid.dynamic
    ? wanted
    : grid.tiles.map((_, index) => index + 1).filter((tile) => wanted.includes(tile) !== grid.tiles[tile - 1].selected);
  return { clicks: toggles.map((tile) => grid.tiles[tile - 1]) };
}

async function planPoints(view: FrameView, canvas: CanvasReading, points: Point[] | undefined): Promise<{ clicks: Rect[] } | { error: string }> {
  if (!points?.length) {
    return { error: 'This challenge is a picture to tap on — answer it with "points", measured in pixels on its image from the top-left corner.' };
  }
  const clicks = await pointsOnPage(view, canvas, points);
  return insideArea(canvas, clicks)
    ? { clicks }
    : { error: 'A point falls outside the challenge picture — measure points in pixels on the image, from its top-left corner.' };
}

async function verdictAfterSubmit(
  graph: FrameGraph,
  asked: Sighting,
  before: string,
  clock: Clock,
  waitMs: number,
): Promise<ActionResult> {
  const until = Math.min(clock.until, Date.now() + waitMs);
  let latest: ChallengeReading | null = null;
  const settled = await watch(
    graph,
    until,
    async (seen, view) => {
      if (!seen || seen.state !== 'challenge') return true;
      latest = await challengeOf(view, seen);
      return !!latest && (signatureOf(latest) !== before || latest.errors.length > 0);
    },
    { confirmGone: true },
  );
  if (!settled.seen) return success({ ...report(asked), state: 'solved', solved: true, note: gone(asked) });
  if (settled.seen.state === 'challenge') {
    const reading = latest as ChallengeReading | null;
    const refused = reading?.errors.join(' ');
    return presentChallenge(graph, settled.seen, clock, {
      changedFrom: refused ? undefined : before,
      rejected: refused || 'The vendor followed the answer with another round.',
    });
  }
  return success(report(settled.seen));
}

interface Presented {
  clicked?: boolean;
  fresh?: number[];
  changedFrom?: string;
  rejected?: string;
}

async function presentChallenge(graph: FrameGraph, seen: Sighting, clock: Clock, extra: Presented = {}): Promise<ActionResult> {
  const until = Math.min(clock.until, Date.now() + IMAGES_MS);
  let reading: ChallengeReading | null = null;
  let view = await graph.view();
  while (true) {
    reading = await challengeOf(view, seen);
    const changed = !extra.changedFrom || (reading && signatureOf(reading) !== extra.changedFrom);
    if ((reading && isSettled(reading) && changed && (await opaque(view, seen))) || Date.now() >= until) break;
    await settle(POLL_MS);
    view = await graph.view();
  }
  await settle(SETTLE_MS);
  view = await graph.view();
  reading = (await challengeOf(view, seen)) ?? reading;
  if (!reading) return success({ ...report(seen), state: 'needsHuman', ...flags(extra), note: unreadable(seen) });

  if (!onScreen(areaOf(reading), await view.layout()) && seen.widget.challenge) {
    const owner = await view.ownerNode(seen.widget.challenge);
    if (owner) await view.scrollIntoView(owner.host, owner.backendNodeId);
    await settle(POLL_MS);
    view = await graph.view();
    reading = (await challengeOf(view, seen)) ?? reading;
  }

  const photo = await photograph(view, reading);
  return success({
    ...report(seen),
    state: 'challenge',
    ...flags(extra),
    challenge: { ...describe(reading, photo), ...(extra.fresh ? { fresh: extra.fresh } : {}) },
    note: extra.rejected,
  });
}

async function opaque(view: FrameView, seen: Sighting): Promise<boolean> {
  const frame = seen.widget.challenge && (view.get(seen.widget.challenge.id) ?? seen.widget.challenge);
  const box = frame ? await view.box(frame) : null;
  return !!box && box.opacity > 0.98;
}

const flags = ({ clicked }: Presented) => (clicked ? { clicked } : {});

/** Waits for every clicked tile to show a new picture, fully faded in — not just for the old one to stop loading. */
async function refill(graph: FrameGraph, before: GridReading, clicked: Rect[], clock: Clock): Promise<number[]> {
  const until = Math.min(clock.until, Date.now() + REFILL_MS);
  const swapped = before.tiles.flatMap((tile, index) => (clicked.includes(tile) ? [index] : []));
  let latest: ChallengeReading | null = null;
  await watch(graph, until, async (now, view) => {
    if (!now || now.state !== 'challenge') return true;
    latest = await challengeOf(view, now);
    if (latest?.kind !== 'tiles' || !isSettled(latest)) return false;
    const tiles = latest.tiles;
    return swapped.every((index) => tiles[index] && tiles[index].image !== before.tiles[index].image);
  });
  const after = latest as ChallengeReading | null;
  if (after?.kind !== 'tiles') return [];
  return after.tiles.flatMap((tile, index) => (tile.image !== before.tiles[index]?.image ? [index + 1] : []));
}

function describe(reading: ChallengeReading, photo: Photo | null) {
  const shared = {
    kind: reading.kind,
    prompt: reading.prompt,
    submit: reading.submit?.label || undefined,
    ...(reading.errors.length ? { errors: reading.errors } : {}),
  };
  const picture = photo ? { image: photo.image, imageWidth: photo.width, imageHeight: photo.height } : {};
  if (reading.kind === 'points') return { ...shared, ...picture };
  return {
    ...shared,
    ...(reading.target ? { target: reading.target } : {}),
    rows: reading.rows,
    columns: reading.columns,
    tiles: reading.tiles.length,
    selected: selectedTiles(reading),
    dynamic: reading.dynamic,
    ...picture,
  };
}

async function challengeOf(view: FrameView, seen: Sighting): Promise<ChallengeReading | null> {
  const { challenge, vendor } = seen.widget;
  if (!challenge || (!vendor.grid && !vendor.canvas)) return null;
  return readChallenge(view, view.get(challenge.id) ?? challenge, vendor);
}

async function inView(graph: FrameGraph, seen: Sighting): Promise<Sighting> {
  let view = await graph.view();
  if (seen.point && inside(seen.point, await view.layout())) return seen;
  const frame = seen.widget.frame;
  const owner = frame ? await view.ownerNode(frame) : null;
  if (owner) await view.scrollIntoView(owner.host, owner.backendNodeId);
  await settle(POLL_MS);
  view = await graph.view();
  const again = await scan(view);
  if (again?.point && inside(again.point, await view.layout())) return again;
  return { ...(again ?? seen), point: undefined, note: `${seen.widget.vendor.label}’s checkbox could not be brought into view.` };
}

async function watch(
  graph: FrameGraph,
  until: number,
  done: (seen: Sighting | null, view: FrameView) => boolean | Promise<boolean>,
  { confirmGone = false } = {},
): Promise<{ seen: Sighting | null; timedOut: boolean }> {
  let absent = 0;
  let last: Sighting | null = null;
  while (true) {
    const view = await graph.view();
    const seen = await scan(view);
    absent = seen ? 0 : absent + 1;
    if (seen) last = seen;
    const confirmed = !confirmGone || seen || absent >= GONE_CONFIRMATIONS;
    if (confirmed && (await done(seen, view))) return { seen, timedOut: false };
    if (Date.now() >= until) return { seen: seen ?? last, timedOut: true };
    await settle(POLL_MS);
  }
}

const waiting = (seen: Sighting) => seen.state === 'loading' || seen.state === 'hidden';

async function scan(view: FrameView): Promise<Sighting | null> {
  const sightings: Sighting[] = [];
  for (const widget of await widgetsIn(view)) sightings.push(await inspect(view, widget));
  return sightings.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state])[0] ?? null;
}

async function widgetsIn(view: FrameView): Promise<Widget[]> {
  const frames = view.list();
  const tagged = frames.map((frame) => ({ frame, match: vendorForFrame(frame.url) }));
  const widgets: Widget[] = [];

  for (const { frame, match } of tagged) {
    if (match?.role !== 'widget') continue;
    const host = view.parentOf(frame);
    if (!host) continue;
    const challenge = await challengeFor(view, tagged, match.vendor);
    widgets.push({ vendor: match.vendor, host, frame, challenge, invisible: isInvisibleWidget(match.vendor, frame.url) });
  }
  for (const { frame, match } of tagged) {
    if (match?.role !== 'challenge' || widgets.some((widget) => widget.vendor === match.vendor)) continue;
    const host = view.parentOf(frame);
    if (host) widgets.push({ vendor: match.vendor, host, challenge: frame, invisible: true });
  }

  const hosts = tagged.filter(({ match }) => !match).slice(0, MAX_MARKER_FRAMES);
  for (const { frame } of hosts) {
    const ids = (await view.run(frame, markedVendors, MARKERS)) ?? [];
    for (const id of ids) {
      const vendor = vendorById(id);
      if (!vendor || !markersTell(vendor) || widgets.some((widget) => widget.vendor === vendor)) continue;
      widgets.push({ vendor, host: frame, invisible: vendor.kind === 'invisible' });
    }
  }
  return widgets;
}

async function challengeFor(
  view: FrameView,
  tagged: { frame: FrameNode; match: ReturnType<typeof vendorForFrame> }[],
  vendor: CaptchaVendor,
): Promise<FrameNode | undefined> {
  const candidates = tagged.filter(({ match }) => match?.vendor === vendor && match.role === 'challenge').map(({ frame }) => frame);
  for (const frame of candidates) {
    if ((await view.box(frame))?.shown) return frame;
  }
  return candidates[0];
}

async function inspect(view: FrameView, widget: Widget): Promise<Sighting> {
  const { vendor, host, frame, challenge } = widget;
  const base = { widget, depth: depthOf(view, frame ?? host) };
  const [hasToken, checked] = await Promise.all([
    view.run(host, solvedInHost, vendor.tokenField ?? '', vendor.solvedMarker ?? '').then((value) => value === true),
    frame && vendor.checkedInFrame
      ? view.run(frame, matches, vendor.checkedInFrame).then((value) => value === true)
      : Promise.resolve(false),
  ]);
  if (hasToken || checked) return { ...base, state: 'solved', hasToken };

  const challengeBox = challenge ? await view.box(challenge) : null;
  if (challengeBox && challengeBox.shown && challengeBox.y + challengeBox.height > 0) {
    return vendor.grid || vendor.canvas
      ? { ...base, state: 'challenge', hasToken, bounds: rectOf(challengeBox) }
      : { ...base, state: 'needsHuman', hasToken, bounds: rectOf(challengeBox), note: `${vendor.label} has escalated to a challenge Browsentic cannot read.` };
  }
  if (vendor.kind === 'invisible' || widget.invisible) {
    return { ...base, state: 'invisible', hasToken, note: `${vendor.label} scores in the background — there is nothing to click.` };
  }

  const frameBox = frame ? await view.box(frame) : null;
  if (vendor.kind === 'interactive') {
    return {
      ...base,
      state: 'needsHuman',
      hasToken,
      bounds: frameBox ? rectOf(frameBox) : undefined,
      note: `${vendor.label} asks for a puzzle Browsentic does not answer.`,
    };
  }
  if (frame && !frameBox?.shown) {
    return { ...base, state: 'hidden', hasToken, note: `${vendor.label}’s widget is on the page but not shown.` };
  }

  const checkbox = await locateCheckbox(view, widget, frameBox);
  return {
    ...base,
    state: checkbox.point ? 'idle' : 'loading',
    hasToken,
    bounds: frameBox ? rectOf(frameBox) : checkbox.bounds,
    point: checkbox.point,
    note: checkbox.note,
  };
}

async function locateCheckbox(
  view: FrameView,
  { vendor, frame, host }: Widget,
  frameBox: FrameBox | null,
): Promise<{ bounds?: Rect; point?: Point; note?: string }> {
  if (!vendor.checkbox) return { note: `${vendor.label} exposes no checkbox to click.` };
  const scope = frame ?? host;
  const [origin, local] = await Promise.all([view.origin(scope), view.run(scope, visibleRect, vendor.checkbox)]);
  let bounds = origin && local ? { ...local, x: local.x + origin.x, y: local.y + origin.y } : null;

  if (!bounds) {
    for (const node of await view.deepQuery(scope, vendor.checkbox)) {
      const rect = await view.rectOf(scope, node);
      if (rect && rect.width > 0 && rect.height > 0) {
        bounds = rect;
        break;
      }
    }
  }
  if (!bounds) return { note: `${vendor.label} is still loading — its checkbox is not up yet.` };

  const point = centreOf(bounds);
  if (frameBox && !inside(point, frameBox)) {
    return { bounds, note: `${vendor.label}’s checkbox resolved outside its own frame — refusing to click a guessed point.` };
  }
  return { bounds, point };
}

function report(seen: Sighting) {
  return {
    found: true,
    vendor: seen.widget.vendor.id,
    label: seen.widget.vendor.label,
    kind: seen.widget.vendor.kind,
    state: seen.state,
    solved: seen.state === 'solved',
    hasToken: seen.hasToken,
    ...(seen.depth ? { frameDepth: seen.depth } : {}),
    bounds: seen.bounds && rounded(seen.bounds),
    point: seen.point,
    note: seen.note,
  };
}

const gone = (seen: Sighting) =>
  `${seen.widget.vendor.label} went away — the page has moved on. Take a fresh page.getPageInfo.`;

const unreadable = (seen: Sighting) =>
  `${seen.widget.vendor.label} is showing a challenge Browsentic cannot read — screenshot it and hand it to the user.`;

function depthOf(view: FrameView, frame: FrameNode): number {
  let depth = 0;
  for (let at = view.parentOf(frame); at; at = view.parentOf(at)) depth += 1;
  return depth;
}

const clockOf = (timeoutMs: number): Clock => ({ until: Date.now() + timeoutMs });

const rectOf = ({ x, y, width, height }: Rect): Rect => ({ x, y, width, height });

const rounded = ({ x, y, width, height }: Rect): Rect => ({
  x: Math.round(x),
  y: Math.round(y),
  width: Math.round(width),
  height: Math.round(height),
});

const inside = (point: Point, box: { x?: number; y?: number; width: number; height: number }) =>
  point.x >= (box.x ?? 0) &&
  point.x <= (box.x ?? 0) + box.width &&
  point.y >= (box.y ?? 0) &&
  point.y <= (box.y ?? 0) + box.height;

const onScreen = (box: Rect, layout: { width: number; height: number }) =>
  box.x >= 0 && box.y >= 0 && box.x + box.width <= layout.width && box.y + box.height <= layout.height;

function markedVendors(markers: { id: string; selectors: string[] }[]): string[] {
  return markers.filter(({ selectors }) => selectors.some((selector) => document.querySelector(selector))).map(({ id }) => id);
}

function solvedInHost(field: string, marker: string): boolean {
  const filled = !!field && [...document.querySelectorAll(field)].some((el) => !!(el as HTMLInputElement).value);
  return filled || (!!marker && !!document.querySelector(marker));
}

function matches(selector: string): boolean {
  return !!document.querySelector(selector);
}

function visibleRect(selector: string): Rect | null {
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }
  return null;
}
