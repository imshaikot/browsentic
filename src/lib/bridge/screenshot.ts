import { browser } from 'wxt/browser';
import { invokeInFrame } from '@/lib/actions/client';
import { ActionError } from '@/lib/actions/core';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { send, withDebugger, type DebuggerSession } from './cdp';
import { TOP_FRAME } from './frame-focus';
import { publishScreenshot } from './screenshot-preview';

interface CapturePlan {
  mode: 'fullPage' | 'viewport' | 'element';
  dpr: number;
  viewport: { w: number; h: number };
  page: { w: number; h: number };
  region: { x: number; y: number; w: number; h: number };
  scroll: { x: number; y: number };
  format: 'png' | 'jpeg';
  quality?: number;
  maxLongSide: number;
}

const CAPTURE_INTERVAL_MS = 500;
const MAX_TILES = 48;
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = MAX_CANVAS_SIDE * MAX_CANVAS_SIDE;

interface Frame {
  dataUrl: string;
  bitmap: ImageBitmap;
}

type Snap = (format: 'png' | 'jpeg', quality: number | undefined) => Promise<Frame>;

type TabCapture = { captureTab: (tabId: number, options: { format: string; quality?: number }) => Promise<string> };

const LEFT_THE_FRONT = 'TAB_LEFT_THE_FRONT';
const DEBUGGER_CAPTURE_TIMEOUT_MS = 10_000;

const FIREFOX_HINT = 'Capturing a background tab through the debugger is Chrome-only — Firefox captures it directly.';

export async function screenshotTab(
  tab: { id: number; windowId?: number },
  input?: unknown,
  runId?: string,
): Promise<ActionResult> {
  if (import.meta.env.FIREFOX) return shoot(tab.id, input, runId, snapFirefoxTab(tab.id));

  if (await inFront(tab.id)) {
    const shot = await shoot(tab.id, input, runId, snapWhileInFront(tab));
    if (shot.ok || shot.error.code !== LEFT_THE_FRONT) return shot;
  }
  return withDebugger(tab.id, FIREFOX_HINT, (session) => shoot(tab.id, input, runId, snapThroughDebugger(session)));
}

async function inFront(tabId: number): Promise<boolean> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  return tab?.active === true;
}

function snapWhileInFront(tab: { id: number; windowId?: number }): Snap {
  return async (format, quality) => {
    const frame = await captureViewport(tab.windowId, format, quality);
    if (await inFront(tab.id)) return frame;
    frame.bitmap.close();
    throw new ActionError('The tab went behind another one mid-capture', LEFT_THE_FRONT);
  };
}

function snapThroughDebugger(session: DebuggerSession): Snap {
  return async (format, quality) => {
    const captured = send<{ data: string }>(session, 'Page.captureScreenshot', {
      format,
      ...(format === 'jpeg' ? { quality: quality ?? DEFAULT_JPEG_QUALITY } : {}),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new ActionError(
              'Chrome did not render the background tab in time — bring the tab to the front and retry',
              'CAPTURE_FAILED',
            ),
          ),
        DEBUGGER_CAPTURE_TIMEOUT_MS,
      );
    });
    const { data } = await Promise.race([captured, stalled]).finally(() => clearTimeout(timer));
    return framed(`data:image/${format};base64,${data}`);
  };
}

function snapFirefoxTab(tabId: number): Snap {
  return async (format, quality) => {
    const grade = format === 'jpeg' ? (quality ?? DEFAULT_JPEG_QUALITY) : undefined;
    try {
      return await framed(await (browser.tabs as unknown as TabCapture).captureTab(tabId, { format, quality: grade }));
    } catch (error) {
      throw new ActionError(cannotCapture(error), 'CAPTURE_UNSUPPORTED');
    }
  };
}

async function framed(dataUrl: string): Promise<Frame> {
  return { dataUrl, bitmap: await createImageBitmap(await (await fetch(dataUrl)).blob()) };
}

const cannotCapture = (error: unknown) =>
  `Cannot capture this tab (${error instanceof Error ? error.message : String(error)}) — it may be a chrome:// page, the Web Store, or a PDF, which browsers refuse to screenshot`;

async function shoot(tabId: number, input: unknown, runId: string | undefined, snap: Snap): Promise<ActionResult> {
  const planned = await invokeInFrame(tabId, TOP_FRAME, 'page.screenshot', input);
  if (!planned.ok) return planned;
  const plan = planned.data as CapturePlan;

  try {
    const shot = await capture(tabId, plan, snap);
    void publishCapture(shot, runId);
    return success(shot);
  } catch (error) {
    if (error instanceof ActionError) return failure(error.code, error.message);
    return failure('CAPTURE_FAILED', error instanceof Error ? error.message : String(error));
  } finally {
    void invokeInFrame(tabId, TOP_FRAME, 'page.scrollTo', {
      position: { x: plan.scroll.x, y: plan.scroll.y },
      behavior: 'instant',
    });
  }
}

interface Shot {
  format: string;
  width: number;
  height: number;
  dataUrl: string;
  truncated?: boolean;
}

async function publishCapture(shot: Shot, runId?: string): Promise<void> {
  try {
    await publishScreenshot({ ...shot, thumbnail: await thumbnailOf(shot.dataUrl) }, runId);
  } catch {}
}

async function capture(tabId: number, plan: CapturePlan, snap: Snap): Promise<Shot> {
  const { viewport, format, quality, maxLongSide } = plan;
  const region = { ...plan.region };

  const cols = Math.max(1, Math.ceil(region.w / viewport.w));
  const maxRows = Math.max(1, Math.floor(MAX_TILES / Math.min(cols, MAX_TILES)));
  let truncated = false;
  if (cols > MAX_TILES) {
    region.w = MAX_TILES * viewport.w;
    truncated = true;
  }
  if (Math.ceil(region.h / viewport.h) > maxRows) {
    region.h = maxRows * viewport.h;
    truncated = true;
  }

  const xs = tileStarts(region.x, region.w, viewport.w);
  const ys = tileStarts(region.y, region.h, viewport.h);

  const singleTile = xs.length === 1 && ys.length === 1 && plan.mode === 'viewport';

  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let out: OffscreenCanvas | null = null;
  let scale = 1;
  let outScale = 1;
  let lastCaptureAt = 0;

  for (const y of ys) {
    for (const x of xs) {
      const scrolled = await invokeInFrame(tabId, TOP_FRAME, 'page.scrollTo', {
        position: { x, y },
        behavior: 'instant',
      });
      if (!scrolled.ok) throw new ActionError(scrolled.error.message, scrolled.error.code);
      const at = scrolled.data as { scrollX: number; scrollY: number };

      const sinceLast = Date.now() - lastCaptureAt;
      if (lastCaptureAt && sinceLast < CAPTURE_INTERVAL_MS) await delay(CAPTURE_INTERVAL_MS - sinceLast);

      const shot = await snap(format, quality);
      lastCaptureAt = Date.now();
      const bitmap = shot.bitmap;

      if (!out) {
        const capScale = bitmap.width / viewport.w || plan.dpr || 1;
        outScale = fitScale(region.w * capScale, region.h * capScale, maxLongSide);
        scale = capScale * outScale;

        if (singleTile && outScale === 1) {
          const { width, height } = bitmap;
          bitmap.close();
          return { format, width, height, dataUrl: shot.dataUrl, ...(truncated ? { truncated } : {}) };
        }

        out = new OffscreenCanvas(
          Math.max(1, Math.round(region.w * scale)),
          Math.max(1, Math.round(region.h * scale)),
        );
        ctx = out.getContext('2d');
        if (!ctx) {
          bitmap.close();
          throw new ActionError('OffscreenCanvas 2D context unavailable', 'CAPTURE_FAILED');
        }
      }

      ctx!.drawImage(
        bitmap,
        (at.scrollX - region.x) * scale,
        (at.scrollY - region.y) * scale,
        bitmap.width * outScale,
        bitmap.height * outScale,
      );
      bitmap.close();
    }
  }

  if (!out) throw new ActionError('Nothing was captured', 'CAPTURE_FAILED');
  return encode(out, format, quality, truncated);
}

const THUMB_MAX_SIDE = 640;
const THUMB_QUALITY = 0.6;

async function thumbnailOf(dataUrl: string): Promise<string> {
  const source = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(source.width, source.height, 1));
  const small = new OffscreenCanvas(
    Math.max(1, Math.round(source.width * scale)),
    Math.max(1, Math.round(source.height * scale)),
  );
  const ctx = small.getContext('2d');
  if (!ctx) {
    source.close();
    return '';
  }
  ctx.drawImage(source, 0, 0, small.width, small.height);
  source.close();
  return blobToDataUrl(await small.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY }), 'image/jpeg');
}

const DEFAULT_JPEG_QUALITY = 80;

async function encode(
  canvas: OffscreenCanvas,
  format: 'png' | 'jpeg',
  quality: number | undefined,
  truncated: boolean,
): Promise<Shot> {
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await canvas.convertToBlob(
    format === 'jpeg' ? { type: mime, quality: (quality ?? DEFAULT_JPEG_QUALITY) / 100 } : { type: mime },
  );
  const dataUrl = await blobToDataUrl(blob, mime);
  return { format, width: canvas.width, height: canvas.height, dataUrl, ...(truncated ? { truncated } : {}) };
}

function fitScale(deviceW: number, deviceH: number, maxLongSide: number): number {
  const longest = Math.max(deviceW, deviceH, 1);
  const byLong = Math.min(maxLongSide, MAX_CANVAS_SIDE) / longest;
  const byArea = Math.sqrt(MAX_CANVAS_AREA / Math.max(deviceW * deviceH, 1));
  return Math.min(1, byLong, byArea);
}

export async function captureViewport(
  windowId: number | undefined,
  format: 'png' | 'jpeg',
  quality: number | undefined,
): Promise<Frame> {
  const grade = format === 'jpeg' ? (quality ?? DEFAULT_JPEG_QUALITY) : undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      const dataUrl =
        windowId == null
          ? await browser.tabs.captureVisibleTab({ format, quality: grade })
          : await browser.tabs.captureVisibleTab(windowId, { format, quality: grade });
      return await framed(dataUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < 2 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message)) {
        await delay(CAPTURE_INTERVAL_MS);
        continue;
      }
      throw new ActionError(cannotCapture(error), 'CAPTURE_UNSUPPORTED');
    }
  }
}

function tileStarts(start: number, size: number, step: number): number[] {
  const starts: number[] = [];
  for (let p = start; p < start + size; p += step) starts.push(p);
  return starts.length ? starts : [start];
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  });
}
