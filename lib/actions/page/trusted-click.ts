import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { cssPath, describeElement, resolveTarget, submitsOnClick, targetSchema } from './dom';

const APPROACH_OFFSET = 120;

function viewport(): { w: number; h: number } {
  return { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
}

function clickPoint(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const { w, h } = viewport();
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, w);
  const bottom = Math.min(rect.bottom, h);
  if (right <= left || bottom <= top) {
    throw new ActionError(
      'The element has no visible area inside the viewport — scroll it into view, then retry',
      'INVALID_TARGET',
    );
  }
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

function viewportPoint(point: { x: number; y: number }): { x: number; y: number } {
  const { w, h } = viewport();
  if (point.x < 0 || point.y < 0 || point.x >= w || point.y >= h) {
    throw new ActionError(
      `The point (${point.x}, ${point.y}) is outside the ${w}×${h} viewport — scroll it into view, then retry`,
      'INVALID_TARGET',
    );
  }
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

function approachPoint(to: { x: number; y: number }): { x: number; y: number } {
  const { w, h } = viewport();
  return {
    x: Math.min(Math.max(to.x - APPROACH_OFFSET, 0), w - 1),
    y: Math.min(Math.max(to.y - APPROACH_OFFSET, 0), h - 1),
  };
}

export const trustedClick = defineAction({
  name: 'page.trustedClick',
  description:
    'Click with a real browser-level mouse event — isTrusted is true, exactly as if the user had clicked. The pointer travels to the target over a short path and dwells before pressing, so widgets that only react after genuine pointer movement (drag handles, hover menus, canvas tools, captcha checkboxes) see the sequence they wait for. Use it when page.clickElement was ignored: pages that check event.isTrusted, and the browser features only a genuine gesture unlocks — native file pickers, fullscreen, clipboard reads, popups, WebAuthn prompts. Give it either a "target" or a raw viewport "point". It attaches Chrome’s debugger for the duration, so the browser shows a “Browsentic is debugging this browser” bar while it runs, it cannot run on a tab that has DevTools open, and it is unavailable on Firefox. page.clickElement stays the default for ordinary clicks.',
  input: z.object({
    target: targetSchema.optional().describe('Element to click. Give this or "point", never both.'),
    point: z
      .object({
        x: z.number().describe('Pixels from the left edge of the viewport'),
        y: z.number().describe('Pixels from the top edge of the viewport'),
      })
      .optional()
      .describe(
        'Exact viewport coordinates to click, in CSS pixels. Use this when the thing to click has no reachable element — inside a cross-origin iframe or a closed shadow root, as page.findCaptcha reports.',
      ),
    button: z.enum(['left', 'right', 'middle']).default('left').describe('Mouse button to press'),
    clickCount: z
      .number()
      .int()
      .min(1)
      .max(3)
      .default(1)
      .describe('1 for a single click, 2 for a double click, 3 for a triple click'),
    modifiers: z
      .array(z.enum(['ctrl', 'shift', 'alt', 'meta']))
      .default([])
      .describe('Modifier keys held during the click, e.g. ["meta"] to open a link in a new tab'),
    scrollIntoView: z.boolean().default(true).describe('Bring the element into view before clicking. Ignored with "point".'),
    moveSteps: z
      .number()
      .int()
      .min(1)
      .max(60)
      .default(8)
      .describe('Pointer move events dispatched along the way in. Raise it for widgets that sample the path.'),
    hoverMs: z
      .number()
      .int()
      .min(0)
      .max(2000)
      .default(60)
      .describe('Pause on the target after arriving, before pressing.'),
    holdMs: z
      .number()
      .int()
      .min(0)
      .max(2000)
      .default(50)
      .describe('How long the button stays down between press and release.'),
  }),
  execute({ target, point, button, clickCount, modifiers, scrollIntoView, moveSteps, hoverMs, holdMs }) {
    if (!target === !point) {
      throw new ActionError('Give either a "target" to click or a "point" to click at — not both, not neither', 'INVALID_INPUT');
    }

    const el = target ? resolveTarget(target) : null;
    if (el && scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'instant' });

    const at = el ? clickPoint(el) : viewportPoint(point!);
    const hit = document.elementFromPoint(at.x, at.y);
    if (el && !(hit === el || el.contains(hit))) {
      throw new ActionError(
        hit
          ? `${cssPath(hit)} covers the click point — dismiss whatever is over the element, then retry`
          : 'Nothing is painted at the click point — scroll the element into view, then retry',
        'INVALID_TARGET',
      );
    }

    return {
      ...(el ? describeElement(el) : { over: hit ? cssPath(hit) : undefined }),
      point: at,
      from: approachPoint(at),
      button,
      clickCount,
      modifiers,
      moveSteps,
      hoverMs,
      holdMs,
      submits: el ? submitsOnClick(el) : false,
    };
  },
});
