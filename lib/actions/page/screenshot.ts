import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { documentBounds, resolveTarget, targetSchema } from './dom';

export const screenshot = defineAction({
  name: 'page.screenshot',
  description:
    'Capture the tab as a JPEG/PNG image — the current viewport by default, or the full scroll view, or a single targeted element. The viewport capture is the fast one: it is a single grab that returns in well under a second. fullPage: true has to scroll the page in viewport-sized steps and wait out the browser’s capture rate limit between each, so it costs a second or more per screenful — ask for it only when you need what is below the fold. Nothing is written to disk unless you pass save: true — the image comes back in the result either way, so a capture you take to look at the page for yourself leaves no file behind.',
  input: z.object({
    target: targetSchema
      .optional()
      .describe('Capture only this element’s box (a specific block). When set, fullPage is ignored.'),
    fullPage: z
      .boolean()
      .default(false)
      .describe(
        'With no target: false (the default) captures only the current viewport and is much faster; true captures the entire scroll view by tiling, which costs roughly a second per screenful.',
      ),
    format: z
      .enum(['png', 'jpeg'])
      .default('jpeg')
      .describe(
        'Image format. JPEG (the default) is far smaller and quicker to encode; PNG is lossless and keeps transparency, at several times the size and time.',
      ),
    quality: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('JPEG quality, 1–100, defaulting to 80. Only valid when format is "jpeg".'),
    maxLongSide: z
      .number()
      .int()
      .positive()
      .default(1600)
      .describe(
        'Downscale the result so its longest side is at most this many pixels. The default is sized for reading a page, not for pixel-level inspection — raise it when fine detail matters.',
      ),
    save: z
      .boolean()
      .default(false)
      .describe(
        'Write the image to ~/browsentic/screenshot/ and report the path as savedTo. Off by default: a capture you take to see the page for yourself is handed to you in the result and should leave nothing behind. Set true only when the user asked for a picture they can keep.',
      ),
    filename: z
      .string()
      .optional()
      .describe('Base filename when saving; defaults to screenshot-<timestamp>.<ext>. Sanitized before use.'),
  }),
  execute({ target, fullPage, format, quality, maxLongSide }) {
    if (quality !== undefined && format !== 'jpeg') {
      throw new ActionError('"quality" only applies when format is "jpeg"', 'INVALID_INPUT');
    }

    const dpr = window.devicePixelRatio || 1;
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    const root = document.documentElement;
    const page = { w: root.scrollWidth, h: root.scrollHeight };

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

    const scroll = { x: Math.round(window.scrollX), y: Math.round(window.scrollY) };

    return { mode, dpr, viewport, page, region, scroll, format, quality, maxLongSide };
  },
});
