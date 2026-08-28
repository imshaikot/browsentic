import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { cssPath, describeElement, resolveTarget, submitsOnClick, targetSchema } from './dom';
import { approachPoint, assertUncovered, elementAt, elementPoint, pointSchema, viewportPoint } from './pointer';

export const trustedClick = defineAction({
  name: 'page.trustedClick',
  description:
    'Click with a real browser-level mouse event — isTrusted is true, exactly as if the user had clicked. The pointer travels to the target over a short path and dwells before pressing, so widgets that only react after genuine pointer movement (drag handles, hover menus, canvas tools, captcha checkboxes) see the sequence they wait for. Use it when page.clickElement was ignored: pages that check event.isTrusted, and the browser features only a genuine gesture unlocks — native file pickers, fullscreen, clipboard reads, popups, WebAuthn prompts. Give it either a "target" or a raw viewport "point". It attaches Chrome’s debugger for the duration, so the browser shows a “Browsentic is debugging this browser” bar while it runs, it cannot run on a tab that has DevTools open, and it is unavailable on Firefox. page.clickElement stays the default for ordinary clicks.',
  input: z.object({
    target: targetSchema.optional().describe('Element to click. Give this or "point", never both.'),
    point: pointSchema
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

    const at = el ? elementPoint(el) : viewportPoint(point!);
    if (el) assertUncovered(el, at);
    const under = elementAt(at);

    return {
      ...(el ? describeElement(el) : { over: under ? cssPath(under) : undefined }),
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
