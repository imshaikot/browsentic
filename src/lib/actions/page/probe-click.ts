import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { describeElement, resolveTarget, submitsOnClick, targetSchema } from './dom';
import { elementAt, pointSchema, viewportPoint } from './pointer';

/**
 * Where clicking the element would take the page by itself: a link's address, or the address a
 * submit control posts to. Resolved against the page, so the daemon never has to guess a base.
 * A script-driven navigation names no address here and is caught by the page address afterwards.
 */
function destinationOf(el: Element): string | undefined {
  const link = el.closest('a[href]');
  const form = submitsOnClick(el) ? el.closest('form') : null;
  let raw: string | null = null;
  if (link) raw = link.getAttribute('href');
  else if (form) raw = el.getAttribute('formaction') ?? form.getAttribute('action') ?? '';
  if (raw === null) return undefined;
  try {
    return new URL(raw, document.baseURI).href;
  } catch {
    return undefined;
  }
}

export const probeClick = defineAction({
  name: 'page.probeClick',
  description:
    'Look at what a click would land on without clicking: the element\'s tag, role, text, whether clicking it submits a form, and the address it leads to ("href") beside the page\'s own ("pageUrl"). Give either a "target" or a viewport "point". Changes nothing on the page. Use it to check a button before pressing it.',
  input: z.object({
    target: targetSchema.optional().describe('Element to inspect. Give this or "point", never both.'),
    point: pointSchema.optional().describe('Viewport coordinates to inspect, in CSS pixels.'),
  }),
  execute({ target, point }) {
    if (!target === !point) {
      throw new ActionError('Give either a "target" or a "point" — not both, not neither', 'INVALID_INPUT');
    }
    const el = target ? resolveTarget(target) : elementAt(viewportPoint(point!));
    if (!el) throw new ActionError('Nothing is at that point', 'TARGET_NOT_FOUND');
    return { ...describeElement(el), submits: submitsOnClick(el), href: destinationOf(el), pageUrl: location.href };
  },
});
