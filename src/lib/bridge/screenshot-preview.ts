import { browser } from 'wxt/browser';

export interface ScreenshotPreview {
  previewId: string;
  thumbnail: string;
  width: number;
  height: number;
  full: boolean;
}

const INDEX_KEY = 'browsentic:shots';
const bodyKey = (id: string) => `browsentic:shot:${id}`;

const MAX_KEPT = 2;
const MAX_FULL_CHARS = 4_000_000;

type Listener = (preview: ScreenshotPreview, runId?: string) => void;

const listeners = new Set<Listener>();

export function onScreenshotPreview(listener: Listener): void {
  listeners.add(listener);
}

export async function publishScreenshot(
  image: { dataUrl: string; thumbnail: string; width: number; height: number },
  runId?: string,
): Promise<void> {
  if (!image.thumbnail) return;
  const previewId = crypto.randomUUID();
  const full = await keepFullImage(previewId, image.dataUrl);
  const preview: ScreenshotPreview = {
    previewId,
    thumbnail: image.thumbnail,
    width: image.width,
    height: image.height,
    full,
  };
  for (const listener of listeners) listener(preview, runId);
}

export async function readFullImage(previewId: string): Promise<string | null> {
  const key = bodyKey(previewId);
  const stored = await browser.storage.session.get(key).catch(() => ({}) as Record<string, unknown>);
  const dataUrl = stored[key];
  return typeof dataUrl === 'string' ? dataUrl : null;
}

export async function openScreenshot(preview: ScreenshotPreview): Promise<void> {
  const stored = preview.full ? await readFullImage(preview.previewId) : null;
  const blob = await (await fetch(stored ?? preview.thumbnail)).blob();
  await browser.tabs.create({ url: URL.createObjectURL(blob) });
}

async function keepFullImage(previewId: string, dataUrl: string): Promise<boolean> {
  if (dataUrl.length > MAX_FULL_CHARS) return false;
  try {
    const stored = await browser.storage.session.get(INDEX_KEY);
    const kept = Array.isArray(stored[INDEX_KEY]) ? (stored[INDEX_KEY] as string[]) : [];
    const next = [previewId, ...kept.filter((id) => id !== previewId)];
    const dropped = next.slice(MAX_KEPT);
    await browser.storage.session.set({ [bodyKey(previewId)]: dataUrl, [INDEX_KEY]: next.slice(0, MAX_KEPT) });
    if (dropped.length) await browser.storage.session.remove(dropped.map(bodyKey));
    return true;
  } catch {
    return false;
  }
}
