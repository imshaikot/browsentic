import { z } from 'zod';
import { defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';

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
    const clientX = rect.x + rect.width / 2;
    const clientY = rect.y + rect.height / 2;
    // enter events do not bubble, unlike the rest of the hover sequence
    const sequence: Array<['pointer' | 'mouse', string, boolean]> = [
      ['pointer', 'pointerover', true],
      ['pointer', 'pointerenter', false],
      ['pointer', 'pointermove', true],
      ['mouse', 'mouseover', true],
      ['mouse', 'mouseenter', false],
      ['mouse', 'mousemove', true],
    ];
    for (const [kind, type, bubbles] of sequence) {
      const Ctor = kind === 'pointer' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, { clientX, clientY, bubbles, composed: true }));
    }
    return describeElement(el);
  },
});
