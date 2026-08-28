import { z } from 'zod';
import { defineAction } from '../core';
import { describeElement, resolveTarget, submitsOnClick, targetSchema } from './dom';

export const clickElement = defineAction({
  name: 'page.clickElement',
  description: 'Click an element like a user would, firing the full pointer and mouse event sequence.',
  input: z.object({
    target: targetSchema.describe('Element to click'),
    scrollIntoView: z.boolean().default(true).describe('Bring the element into view before clicking'),
  }),
  execute({ target, scrollIntoView }) {
    const el = resolveTarget(target);
    if (scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    try {
      el.focus({ preventScroll: true });
    } catch {
    }
    const submits = submitsOnClick(el);
    const init = { bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new PointerEvent('pointerup', init));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.click();
    return { ...describeElement(el), submits };
  },
});
