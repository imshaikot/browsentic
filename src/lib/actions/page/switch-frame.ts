import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { cssPath, describeElement, resolveTarget, targetSchema } from './dom';

export type FrameElement = HTMLIFrameElement | HTMLFrameElement;

interface FrameRuntime {
  runtime?: { getFrameId?: (target: unknown) => number };
}

export const switchFrame = defineAction({
  name: 'page.switchFrame',
  description:
    'Step into an <iframe> so that every later page action — reading, clicking, typing, waiting, site tools, injected code — runs inside it as if it were the page, or step back out. page.getPageInfo lists the frames the current document embeds under "frames"; pass one as "frame" to enter it, and call again from inside to go deeper. Call it with no arguments to return to the top document, or with to: "parent" to step out one level. The focus is per tab, clears when the tab navigates, and page.getPageInfo reports it under "frame" whenever it is not the top. A frame that forbids scripts (a sandbox without allow-scripts) or a browser-internal frame cannot be entered; page.screenshot and page.trustedClick by coordinates still reach those. page.screenshot and page.navigate always act on the whole tab.',
  input: z.object({
    frame: targetSchema
      .optional()
      .describe(
        'The <iframe> or <frame> element to enter, matched inside the frame currently in focus — use a selector from the "frames" list of page.getPageInfo. Omit it to leave instead.',
      ),
    to: z
      .enum(['top', 'parent'])
      .default('top')
      .describe('Where to go when no "frame" is given: "top" returns to the main document, "parent" steps out one level.'),
  }),
  execute({ frame }) {
    if (!frame) {
      throw new ActionError('Leaving a frame is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
    }
    const el = resolveTarget(frame);
    if (!isFrameElement(el)) {
      throw new ActionError(
        `${cssPath(el)} is a <${el.tagName.toLowerCase()}>, not an <iframe> — pick one of the frames page.getPageInfo lists`,
        'INVALID_TARGET',
      );
    }
    return {
      frameId: frameIdOf(el),
      src: el.src || undefined,
      name: el.name || undefined,
      sandbox: sandboxOf(el),
      ...describeElement(el),
    };
  },
});

export function isFrameElement(el: Element): el is FrameElement {
  return el instanceof HTMLIFrameElement || el instanceof HTMLFrameElement;
}

export function sandboxOf(el: FrameElement): string | undefined {
  return el instanceof HTMLIFrameElement && el.hasAttribute('sandbox') ? el.sandbox.value || 'all restrictions' : undefined;
}

export function frameIdOf(target: unknown): number {
  const scope = globalThis as { browser?: FrameRuntime; chrome?: FrameRuntime };
  const id = (scope.browser?.runtime?.getFrameId ?? scope.chrome?.runtime?.getFrameId)?.(target);
  if (typeof id !== 'number' || id < 0) {
    throw new ActionError(
      'This browser cannot identify frames from the page — entering a frame needs Chrome 116 or Firefox 96 or newer',
      'UNSUPPORTED',
    );
  }
  return id;
}
