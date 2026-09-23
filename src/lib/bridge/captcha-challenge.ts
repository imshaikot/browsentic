import type { CanvasSpec, GridSpec } from '@/lib/actions/page/captcha-vendors';
import type { Point } from '@/lib/actions/page/pointer';
import { send, settle, type DebuggerSession } from './cdp';
import type { FrameNode, FrameView, Rect } from './frame-graph';
import { blobToDataUrl } from './screenshot';
import { dispatchClick } from './trusted-input';

export interface Tile extends Rect {
  selected: boolean;
  loading: boolean;
  ready: boolean;
  image: string;
}

interface Controls {
  prompt: string;
  step: string;
  submit?: Rect & { label: string };
  reload?: Rect;
  errors: string[];
}

export interface GridReading extends Controls {
  kind: 'tiles';
  target?: string;
  tiles: Tile[];
  rows: number;
  columns: number;
  dynamic: boolean;
}

export interface CanvasReading extends Controls {
  kind: 'points';
  area: Rect;
  marks: string;
}

export type ChallengeReading = GridReading | CanvasReading;

export interface Photo {
  image: string;
  width: number;
  height: number;
}

interface RawGrid extends Controls {
  target?: string;
  tiles: Tile[];
}

interface RawCanvas extends Controls {
  area: Rect;
  marks: string;
}

const PHOTO_PAD = 2;
const PHOTO_QUALITY = 92;
const PHOTO_WIDTH = 800;
const PHOTO_TIMEOUT_MS = 10_000;
const ROW_TOLERANCE = 6;

export async function readChallenge(
  view: FrameView,
  frame: FrameNode,
  specs: { grid?: GridSpec; canvas?: CanvasSpec },
): Promise<ChallengeReading | null> {
  const origin = await view.origin(frame);
  if (!origin) return null;
  const shift = <T extends Rect>(rect: T): T => ({ ...rect, x: rect.x + origin.x, y: rect.y + origin.y });
  const moveControls = (raw: Controls) => ({
    prompt: raw.prompt,
    step: raw.step,
    submit: raw.submit && shift(raw.submit),
    reload: raw.reload && shift(raw.reload),
    errors: raw.errors,
  });

  const grid = specs.grid ? await view.runWith(frame, PAGE_HELPERS, gridInPage, specs.grid) : null;
  if (grid?.tiles.length && specs.grid) {
    const tiles = rowMajor(grid.tiles.map(shift));
    return {
      kind: 'tiles',
      ...moveControls(grid),
      target: grid.target,
      tiles,
      rows: bands(tiles.map((tile) => tile.y)),
      columns: bands(tiles.map((tile) => tile.x)),
      dynamic: !!specs.grid.dynamic && grid.prompt.toLowerCase().includes(specs.grid.dynamic),
    };
  }
  const canvas = specs.canvas ? await view.runWith(frame, PAGE_HELPERS, canvasInPage, specs.canvas) : null;
  return canvas ? { kind: 'points', ...moveControls(canvas), area: shift(canvas.area), marks: canvas.marks } : null;
}

export const signatureOf = (reading: ChallengeReading) =>
  reading.kind === 'tiles'
    ? [reading.prompt, ...reading.tiles.map((tile) => tile.image)].join('|')
    : [reading.prompt, reading.step, reading.marks].join('|');

export const isSettled = (reading: ChallengeReading) =>
  reading.kind === 'points' || reading.tiles.every((tile) => tile.ready && !tile.loading);

export const selectedTiles = (grid: GridReading) => grid.tiles.flatMap((tile, index) => (tile.selected ? [index + 1] : []));

export const areaOf = (reading: ChallengeReading): Rect => (reading.kind === 'points' ? reading.area : spanOf(reading.tiles));

export function spanOf(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The challenge alone, photographed from the tab — a tile grid with each tile's number painted
 * in its corner, a canvas as it stands. Sized so the picture is about PHOTO_WIDTH pixels wide
 * however dense the screen, which is also what a point on it is measured in.
 */
export async function photograph(view: FrameView, reading: ChallengeReading): Promise<Photo | null> {
  const area = padded(areaOf(reading), PHOTO_PAD);
  const { pageX, pageY, pixelRatio } = await view.layout();
  const scale = photoScale(area, pixelRatio);
  const shot = await Promise.race([
    send<{ data?: string }>(view.root, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: PHOTO_QUALITY,
      clip: { x: area.x + pageX, y: area.y + pageY, width: area.width, height: area.height, scale },
    }).catch(() => null),
    settle(PHOTO_TIMEOUT_MS).then(() => null),
  ]);
  if (!shot?.data) return null;
  const plain = `data:image/jpeg;base64,${shot.data}`;
  const width = Math.round(area.width * pixelRatio * scale);
  const height = Math.round(area.height * pixelRatio * scale);
  if (reading.kind === 'points') return { image: plain, width, height };
  const local = reading.tiles.map((tile) => ({ ...tile, x: tile.x - area.x, y: tile.y - area.y }));
  return { image: await numbered(plain, local, area.width).catch(() => plain), width, height };
}

/** Where a point on the photograph lands in the tab's viewport. */
export async function pointsOnPage(view: FrameView, reading: CanvasReading, points: Point[]): Promise<Rect[]> {
  const area = padded(reading.area, PHOTO_PAD);
  const { pixelRatio } = await view.layout();
  const perPixel = 1 / (pixelRatio * photoScale(area, pixelRatio));
  return points.map(({ x, y }) => ({ x: area.x + x * perPixel, y: area.y + y * perPixel, width: 0, height: 0 }));
}

export const insideArea = (reading: CanvasReading, rects: Rect[]) =>
  rects.every(
    ({ x, y }) =>
      x >= reading.area.x && y >= reading.area.y && x <= reading.area.x + reading.area.width && y <= reading.area.y + reading.area.height,
  );

export async function clickRects(session: DebuggerSession, rects: Rect[], from?: Point): Promise<Point | undefined> {
  let last = from;
  for (const rect of rects) {
    const point = jittered(rect);
    await dispatchClick(session, {
      point,
      from: last ?? { x: Math.max(point.x - 120, 0), y: Math.max(point.y - 80, 0) },
      button: 'left',
      clickCount: 1,
      modifiers: [],
      moveSteps: 8 + randomInt(6),
      hoverMs: 60 + randomInt(90),
      holdMs: 45 + randomInt(45),
    });
    last = point;
    await settle(140 + randomInt(220));
  }
  return last;
}

export const centreOf = (rect: Rect): Point => ({
  x: Math.round(rect.x + rect.width / 2),
  y: Math.round(rect.y + rect.height / 2),
});

const photoScale = (area: Rect, pixelRatio: number) => Math.min(Math.max(PHOTO_WIDTH / (area.width * pixelRatio), 1), 2);

function jittered(rect: Rect): Point {
  const spread = (size: number) => (Math.random() - 0.5) * size * 0.3;
  return {
    x: Math.round(rect.x + rect.width / 2 + spread(rect.width)),
    y: Math.round(rect.y + rect.height / 2 + spread(rect.height)),
  };
}

const randomInt = (below: number) => Math.floor(Math.random() * below);

const padded = (rect: Rect, by: number): Rect => ({
  x: Math.max(rect.x - by, 0),
  y: Math.max(rect.y - by, 0),
  width: rect.width + by * 2,
  height: rect.height + by * 2,
});

function rowMajor<T extends Rect>(tiles: T[]): T[] {
  return [...tiles].sort((a, b) => (Math.abs(a.y - b.y) > ROW_TOLERANCE ? a.y - b.y : a.x - b.x));
}

function bands(starts: number[]): number {
  const sorted = [...starts].sort((a, b) => a - b);
  return sorted.filter((start, index) => index === 0 || start - sorted[index - 1] > ROW_TOLERANCE).length;
}

async function numbered(dataUrl: string, tiles: Rect[], cssWidth: number): Promise<string> {
  if (typeof OffscreenCanvas === 'undefined') return dataUrl;
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;
  const scale = bitmap.width / cssWidth;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  tiles.forEach((tile, index) => {
    const size = Math.round(Math.max(16, Math.min(tile.width, tile.height) * 0.2) * scale);
    const x = Math.round((tile.x + 3) * scale);
    const y = Math.round((tile.y + 3) * scale);
    context.fillStyle = 'rgba(0, 0, 0, 0.78)';
    context.fillRect(x, y, Math.round(size * 1.3), size);
    context.fillStyle = '#ffffff';
    context.font = `bold ${Math.round(size * 0.72)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index + 1), x + size * 0.65, y + size / 2 + 1);
  });
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: PHOTO_QUALITY / 100 }), 'image/jpeg');
}

function isLaidOutInPage(el: Element | null | undefined): el is HTMLElement {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function isShownInPage(el: Element | null | undefined): el is HTMLElement {
  return isLaidOutInPage(el) && Number(getComputedStyle(el).opacity) > 0.05;
}

function boxInPage(el: Element): Rect {
  const rect = el.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function textInPage(el: Element): string {
  return ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function controlsInPage(spec: { prompt: string; submit: string; reload?: string; errors: string }): Controls {
  const all = (selector?: string) => (selector ? [...document.querySelectorAll(selector)] : []);
  const submit = all(spec.submit).find(isShownInPage);
  const reload = all(spec.reload).find(isShownInPage);
  return {
    prompt: all(spec.prompt).filter(isShownInPage).map(textInPage).join(' ').trim(),
    step: submit?.getAttribute('aria-label') ?? '',
    submit: submit
      ? { ...boxInPage(submit), label: textInPage(submit) || submit.getAttribute('aria-label') || (submit as HTMLInputElement).value || '' }
      : undefined,
    reload: reload ? boxInPage(reload) : undefined,
    errors: all(spec.errors).filter(isShownInPage).map(textInPage).filter(Boolean),
  };
}

function gridInPage(spec: GridSpec): RawGrid | null {
  const pictureOf = (tile: Element) => {
    const img = tile.querySelector('img');
    if (img) return img.src;
    const painted = [tile, ...tile.querySelectorAll('*')].map((el) => getComputedStyle(el).backgroundImage).find((bg) => bg && bg !== 'none');
    return painted ?? '';
  };
  const opacityWithin = (el: Element, stop: Element) => {
    let opacity = 1;
    for (let at: Element | null = el; at && at !== stop.parentElement; at = at.parentElement) {
      opacity *= Number(getComputedStyle(at).opacity);
    }
    return opacity;
  };

  const fingerprint = (text: string) => {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
    return `${text.length}:${hash.toString(36)}`;
  };
  const uncovered = (tile: Element) =>
    !spec.cover ||
    [...tile.querySelectorAll(spec.cover)].every((cover) => {
      const style = getComputedStyle(cover);
      return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05;
    });
  const painted = (tile: Element) => {
    const images = [...tile.querySelectorAll('img')];
    return images.length
      ? images.every((img) => img.complete && img.naturalWidth > 0 && opacityWithin(img, tile) > 0.98)
      : !!pictureOf(tile);
  };

  if (!isShownInPage(document.querySelector(spec.root))) return null;
  const tiles = [...document.querySelectorAll(spec.tiles)].filter(isLaidOutInPage).map((tile) => ({
    ...boxInPage(tile),
    selected: tile.matches(spec.selected) || !!tile.querySelector(spec.selected),
    loading: !!spec.loading && tile.matches(spec.loading),
    ready: painted(tile) && uncovered(tile),
    image: fingerprint(pictureOf(tile)),
  }));
  const target = spec.target ? document.querySelector(spec.target) : null;
  return { ...controlsInPage(spec), target: target ? textInPage(target) : undefined, tiles };
}

function canvasInPage(spec: CanvasSpec): RawCanvas | null {
  const area = [...document.querySelectorAll(spec.root)].find((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 100 && rect.height > 100;
  });
  if (!area) return null;
  const marks = spec.marks
    ? [...document.querySelectorAll(spec.marks)].map((el) => getComputedStyle(el).backgroundImage).join('|').slice(-200)
    : '';
  return { ...controlsInPage(spec), area: boxInPage(area), marks };
}

const PAGE_HELPERS = [isLaidOutInPage, isShownInPage, boxInPage, textInPage, controlsInPage];
