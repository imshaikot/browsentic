import { z } from 'zod';
import { defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';
import { hoverSequence } from './pointer';

export const hoverElement = defineAction({
  name: 'page.hoverElement',
  description: 'Hover an element to trigger menus, tooltips, and other hover states.',
  input: z.object({
    target: targetSchema.describe('Element to hover'),
    scrollIntoView: z.boolean().default(true).describe('Bring the element into view first'),
  }),
  execute({ target, scrollIntoView }) {
    const el = resolveTarget(target);
    if (scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    hoverSequence(el, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    return describeElement(el);
  },
});
