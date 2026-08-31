import { invokeInTab } from '@/lib/actions/client';
import { pickElement } from '@/lib/actions/page/pick-element';
import { success, type ActionResult } from '@/lib/actions/protocol';
import { blobToDataUrl, captureViewport } from './screenshot';

export interface PickShot {
  dataUrl: string;
  width: number;
  height: number;
}

interface PickCapture {
  region: { x: number; y: number; w: number; h: number };
  viewport: { w: number; h: number };
  dpr: number;
}

const REGION_PADDING_CSS_PX = 16;
const MAX_SHOT_LONG_SIDE = 1200;
const SHOT_JPEG_QUALITY = 0.85;
const PAINT_SETTLE_MS = 120;

/**
 * Runs the A-Eye pick in the tab, then photographs the picked element before anything
 * can move it — the pre-screenshot that travels with the pick instead of a later re-read.
 * The capture is best-effort: a pick that cannot be photographed is still a pick.
 */
export async function pickInTab(
  tab: { id: number; windowId?: number },
  input?: unknown,
): Promise<ActionResult> {
  const picked = await invokeInTab(tab.id, pickElement.name, input);
  if (!picked.ok) return picked;

  const { capture, ...data } = picked.data as { capture?: PickCapture } & Record<string, unknown>;
  const shot = capture ? await shootRegion(tab.windowId, capture).catch(() => null) : null;
  return success(shot ? { ...data, shot } : data);
}

async function shootRegion(windowId: number | undefined, capture: PickCapture): Promise<PickShot | null> {
  const { viewport, dpr } = capture;
  const x = Math.max(0, capture.region.x - REGION_PADDING_CSS_PX);
  const y = Math.max(0, capture.region.y - REGION_PADDING_CSS_PX);
  const w = Math.min(viewport.w, capture.region.x + capture.region.w + REGION_PADDING_CSS_PX) - x;
  const h = Math.min(viewport.h, capture.region.y + capture.region.h + REGION_PADDING_CSS_PX) - y;
  if (w < 1 || h < 1) return null;

  await new Promise((resolve) => setTimeout(resolve, PAINT_SETTLE_MS));
  const { bitmap } = await captureViewport(windowId, 'jpeg', Math.round(SHOT_JPEG_QUALITY * 100));

  const scale = bitmap.width / viewport.w || dpr;
  const outScale = Math.min(1, MAX_SHOT_LONG_SIDE / Math.max(w * scale, h * scale, 1));
  const out = new OffscreenCanvas(
    Math.max(1, Math.round(w * scale * outScale)),
    Math.max(1, Math.round(h * scale * outScale)),
  );
  const ctx = out.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, x * scale, y * scale, w * scale, h * scale, 0, 0, out.width, out.height);
  bitmap.close();

  const blob = await out.convertToBlob({ type: 'image/jpeg', quality: SHOT_JPEG_QUALITY });
  return { dataUrl: await blobToDataUrl(blob, 'image/jpeg'), width: out.width, height: out.height };
}
