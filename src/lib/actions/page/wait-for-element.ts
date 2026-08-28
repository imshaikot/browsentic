import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { describeElement, isVisible, resolveTarget, targetSchema } from './dom';

export const waitForElement = defineAction({
  name: 'page.waitForElement',
  description: 'Wait until an element reaches a state: attached, visible, hidden, or detached.',
  input: z.object({
    target: targetSchema.describe('Element to wait for'),
    state: z
      .enum(['attached', 'visible', 'hidden', 'detached'])
      .default('visible')
      .describe('State to wait for: present in the DOM, present and visible, invisible or absent, or absent'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(30000)
      .default(5000)
      .describe('Give up after this many milliseconds'),
  }),
  async execute({ target, state, timeoutMs }) {
    const find = (): HTMLElement | null => {
      try {
        return resolveTarget(target, { includeHidden: true });
      } catch (error) {
        if (error instanceof ActionError && error.code === 'INVALID_TARGET') throw error;
        return null;
      }
    };
    const satisfied = (el: HTMLElement | null): boolean =>
      ({
        attached: !!el,
        visible: !!el && isVisible(el),
        hidden: !el || !isVisible(el),
        detached: !el,
      })[state];
    const start = performance.now();
    let element = find();
    if (satisfied(element)) {
      return { state, elapsedMs: 0, element: element ? describeElement(element) : undefined };
    }
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        element = find();
        if (satisfied(element)) {
          cleanup();
          resolve();
        }
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
      const interval = setInterval(check, 250);
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new ActionError(
            `Timed out after ${timeoutMs}ms waiting for element to be ${state}`,
            'TIMEOUT',
          ),
        );
      }, timeoutMs);
      const cleanup = () => {
        observer.disconnect();
        clearInterval(interval);
        clearTimeout(timer);
      };
    });
    return {
      state,
      elapsedMs: Math.round(performance.now() - start),
      element: element ? describeElement(element) : undefined,
    };
  },
});
