import { z } from 'zod';
import { defineAction } from '../core';
import { resolveTarget, targetSchema } from './dom';

export const scrollTo = defineAction({
  name: 'page.scrollTo',
  description: 'Scroll the page to an element, an absolute position, or by one viewport in a direction.',
  input: z.object({
    target: targetSchema.optional().describe('Element to bring into view'),
    position: z
      .object({
        x: z.number().default(0).describe('Document x coordinate'),
        y: z.number().describe('Document y coordinate'),
      })
      .optional()
      .describe('Absolute document coordinates to scroll to'),
    direction: z
      .enum(['up', 'down', 'top', 'bottom'])
      .optional()
      .describe('Scroll one viewport up or down, or jump to an edge'),
    behavior: z.enum(['smooth', 'instant']).default('smooth').describe('Animation of the scroll'),
  }),
  async execute({ target, position, direction, behavior }) {
    if (target) {
      resolveTarget(target).scrollIntoView({ behavior, block: 'center' });
    } else if (position) {
      window.scrollTo({ left: position.x, top: position.y, behavior });
    } else {
      const destination = {
        up: window.scrollY - window.innerHeight,
        down: window.scrollY + window.innerHeight,
        top: 0,
        bottom: document.documentElement.scrollHeight,
      }[direction ?? 'down'];
      window.scrollTo({ top: destination, behavior });
    }
    // Smooth scrolling is async; wait for it to settle so the returned position is the final one.
    if (behavior === 'smooth') await scrollSettled();
    return { scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) };
  },
});

function scrollSettled(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('scrollend', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 1000);
    window.addEventListener('scrollend', done);
  });
}
