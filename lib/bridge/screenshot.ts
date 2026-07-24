import { browser } from 'wxt/browser';
import { invokeInTab } from '@/lib/actions/client';
import { ActionError } from '@/lib/actions/core';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';

/**
 * Background half of `page.screenshot`. The action runs in the page only to *measure* and hand
 * back a capture plan (see `lib/actions/page/screenshot.ts`); the pixels are produced here,
 * because only the background worker can call `chrome.tabs.captureVisibleTab`. We scroll the tab
 * one viewport at a time, capture each, and paint every viewport onto one `OffscreenCanvas` at
 * its region-relative offset — which stitches a full page *and* crops an element for free, since
 * the canvas is sized to the requested region and clips whatever overflows it.
 *
 * Routed from `invokeForHarness` exactly like navigation, the other cross-context action.
 *
 * Geometry is driven by the *actual* captured bitmap, not `window.devicePixelRatio`: the real
 * device scale (`bitmap.width / viewport.w`) is exact under browser zoom and fractional DPI,
 * where trusting `dpr` leaves seam lines between tiles. The output canvas is sized to the final
 * (downscaled) dimensions and each tile is drawn scaled to fit — so a very tall or HiDPI page is
 * never allocated as an over-limit backing store.
 */

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

/** Chrome throttles captureVisibleTab to ~2/sec; stay under it and let content settle per tile. */
const CAPTURE_INTERVAL_MS = 500;
/** Total viewports we will ever tile — bounds wall-clock and memory on runaway/huge pages. */
const MAX_TILES = 48;
/** Chrome refuses to allocate a canvas past these; keep the backing store safely within them. */
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = MAX_CANVAS_SIDE * MAX_CANVAS_SIDE;

export async function screenshotTab(
  tab: { id: number; windowId?: number },
  input?: unknown,
): Promise<ActionResult> {
  // Run the action in-page purely to measure — this yields the capture plan, no side effects.
  const planned = await invokeInTab(tab.id, 'page.screenshot', input);
  if (!planned.ok) return planned;
  const plan = planned.data as CapturePlan;

  try {
    return success(await capture(tab, plan));
  } catch (error) {
    if (error instanceof ActionError) return failure(error.code, error.message);
    return failure('CAPTURE_FAILED', error instanceof Error ? error.message : String(error));
  } finally {
    // Put the page back where the user had it, whether we succeeded or threw.
    void invokeInTab(tab.id, 'page.scrollTo', {
      position: { x: plan.scroll.x, y: plan.scroll.y },
      behavior: 'instant',
    });
  }
}

async function capture(
  tab: { id: number; windowId?: number },
  plan: CapturePlan,
): Promise<{ format: string; width: number; height: number; dataUrl: string; truncated?: boolean }> {
  const { viewport, format, quality, maxLongSide } = plan;
  const region = { ...plan.region };

  // Clamp the region so we never tile more than MAX_TILES viewports — this bounds BOTH axes, so a
  // wide page can't multiply the row cap into hundreds of captures. If clipped, the canvas matches
  // what we actually capture (no blank band) and we flag the shot as partial.
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

  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let out: OffscreenCanvas | null = null;
  let scale = 1; // CSS px → output px (device scale × downscale); set from the first real capture
  let outScale = 1; // downscale applied to each captured bitmap when painting it

  let first = true;
  for (const y of ys) {
    for (const x of xs) {
      // Scroll may clamp near the edges; use where the page *actually* landed to place the tile.
      const scrolled = await invokeInTab(tab.id, 'page.scrollTo', {
        position: { x, y },
        behavior: 'instant',
      });
      if (!scrolled.ok) throw new ActionError(scrolled.error.message, scrolled.error.code);
      const at = scrolled.data as { scrollX: number; scrollY: number };

      // Settle the freshly-scrolled tile AND respect the capture quota — after the scroll, before
      // the capture, so lazy images and reveal animations have a beat to paint. The first tile,
      // already on screen, needs no wait.
      if (!first) await delay(CAPTURE_INTERVAL_MS);
      first = false;

      const bitmap = await captureViewport(tab.windowId, format, quality);

      // Size the output canvas from the first *actual* bitmap: derive the true device scale, apply
      // the maxLongSide cap and Chrome's hard limits, and allocate at the final size directly.
      if (!out) {
        const capScale = bitmap.width / viewport.w || plan.dpr || 1;
        outScale = fitScale(region.w * capScale, region.h * capScale, maxLongSide);
        scale = capScale * outScale;
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

      // Draw the whole viewport at its scaled offset within the region; the canvas clips overflow,
      // and consecutive tiles abut exactly because pitch and draw-size share the same scale.
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

async function encode(
  canvas: OffscreenCanvas,
  format: 'png' | 'jpeg',
  quality: number | undefined,
  truncated: boolean,
): Promise<{ format: string; width: number; height: number; dataUrl: string; truncated?: boolean }> {
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await canvas.convertToBlob(
    format === 'jpeg' ? { type: mime, quality: (quality ?? 90) / 100 } : { type: mime },
  );
  const dataUrl = await blobToDataUrl(blob, mime);
  return { format, width: canvas.width, height: canvas.height, dataUrl, ...(truncated ? { truncated } : {}) };
}

/** Largest scale ≤ 1 that keeps the long side under maxLongSide and the buffer within Chrome's limits. */
function fitScale(deviceW: number, deviceH: number, maxLongSide: number): number {
  const longest = Math.max(deviceW, deviceH, 1);
  const byLong = Math.min(maxLongSide, MAX_CANVAS_SIDE) / longest;
  const byArea = Math.sqrt(MAX_CANVAS_AREA / Math.max(deviceW * deviceH, 1));
  return Math.min(1, byLong, byArea);
}

/** captureVisibleTab throws on pages that forbid capture (chrome://, the Web Store, the PDF viewer). */
async function captureViewport(
  windowId: number | undefined,
  format: 'png' | 'jpeg',
  quality: number | undefined,
): Promise<ImageBitmap> {
  for (let attempt = 0; ; attempt++) {
    try {
      const dataUrl =
        windowId == null
          ? await browser.tabs.captureVisibleTab({ format, quality })
          : await browser.tabs.captureVisibleTab(windowId, { format, quality });
      return createImageBitmap(await (await fetch(dataUrl)).blob());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Chrome's per-second capture quota is transient — back off once and try again.
      if (attempt < 2 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message)) {
        await delay(CAPTURE_INTERVAL_MS);
        continue;
      }
      throw new ActionError(
        `Cannot capture this tab (${message}) — it may be a chrome:// page, the Web Store, or a PDF, which browsers refuse to screenshot`,
        'CAPTURE_UNSUPPORTED',
      );
    }
  }
}

/** Start positions of viewport-sized windows covering [start, start+size); never empty. */
function tileStarts(start: number, size: number, step: number): number[] {
  const starts: number[] = [];
  for (let p = start; p < start + size; p += step) starts.push(p);
  return starts.length ? starts : [start];
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** btoa needs a binary string; chunk the bytes so a large image never overflows the call stack. */
function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
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
