import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { describeElement, resolveTarget, submitsOnClick, targetSchema } from './dom';
import { elementAt, pointSchema, viewportPoint } from './pointer';

export const probeClick = defineAction({
  name: 'page.probeClick',
  description:
    'Look at what a click would land on without clicking: the element\'s tag, role, text and whether clicking it submits a form. Give either a "target" or a viewport "point". Changes nothing on the page. Use it to check a button before pressing it.',
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
    return { ...describeElement(el), submits: submitsOnClick(el) };
  },
});
