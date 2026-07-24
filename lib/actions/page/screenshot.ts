import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { documentBounds, resolveTarget, targetSchema } from './dom';

/**
 * Screenshotting is a cross-context capability, like `page.navigate`: a content script cannot
 * call `chrome.tabs.captureVisibleTab` (background-only) nor write files (daemon-only). So this
 * action's `execute()` does the one part the page *can* do — measure — and returns a capture
 * *plan*. The background worker reads the plan, scrolls + captures + stitches the pixels
 * (`lib/bridge/screenshot.ts`, routed from `lib/bridge/invoke.ts`), and the daemon saves the
 * file. Running this action in-page has no side effect; it never touches the pixels itself.
 */
export const screenshot = defineAction({
  name: 'page.screenshot',
  description:
    'Capture the tab as a PNG/JPEG image — the full scroll view, the current viewport, or a single targeted element. Optionally save it under ~/voicelink/screenshot/.',
  input: z.object({
    target: targetSchema
      .optional()
      .describe('Capture only this element’s box (a specific block). When set, fullPage is ignored.'),
    fullPage: z
      .boolean()
      .default(true)
      .describe('With no target: true captures the entire scroll view, false only the current viewport.'),
    format: z
      .enum(['png', 'jpeg'])
      .default('png')
      .describe('Image format. PNG is lossless; JPEG is smaller with slight artifacts and no transparency.'),
    quality: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('JPEG quality, 1–100. Only valid when format is "jpeg".'),
    maxLongSide: z
      .number()
      .int()
      .positive()
      .default(4000)
      .describe('Downscale the result so its longest side is at most this many pixels.'),
    save: z
      .boolean()
      .default(false)
      .describe('Save the image to ~/voicelink/screenshot/ (written by the local VoiceLink daemon).'),
    filename: z
      .string()
      .optional()
      .describe('Base filename when saving; defaults to screenshot-<timestamp>.<ext>. Sanitized before use.'),
  }),
  execute({ target, fullPage, format, quality, maxLongSide }) {
    // Validate what the schema can't express (no .refine — it wouldn't survive z.toJSONSchema).
    if (quality !== undefined && format !== 'jpeg') {
      throw new ActionError('"quality" only applies when format is "jpeg"', 'INVALID_INPUT');
    }

    const dpr = window.devicePixelRatio || 1;
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const root = document.documentElement;
    const page = { w: root.scrollWidth, h: root.scrollHeight };

    // The region to capture, in *document* coordinates. The background tiles the viewport across
    // it, so a region larger than the viewport (a tall page or a big element) is expected.
    let mode: 'fullPage' | 'viewport' | 'element';
    let region: { x: number; y: number; w: number; h: number };
    if (target) {
      const bounds = documentBounds(resolveTarget(target));
      if (bounds.width === 0 || bounds.height === 0) {
        throw new ActionError('Target element has no visible box to capture', 'INVALID_TARGET');
      }
      mode = 'element';
      region = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
    } else if (fullPage) {
      mode = 'fullPage';
      region = { x: 0, y: 0, w: page.w, h: page.h };
    } else {
      mode = 'viewport';
      region = { x: Math.round(window.scrollX), y: Math.round(window.scrollY), w: viewport.w, h: viewport.h };
    }

    // The current scroll, so the background can put the page back where it found it.
    const scroll = { x: Math.round(window.scrollX), y: Math.round(window.scrollY) };

    // The plan crosses sendMessage, so it stays small and JSON-serializable (no pixels here).
    return { mode, dpr, viewport, page, region, scroll, format, quality, maxLongSide };
  },
});
