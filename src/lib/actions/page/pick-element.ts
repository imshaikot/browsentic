import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { accessibleText, describeElement } from './dom';
import { pickWithLens } from './lens';

const MAX_CONTENT = 20_000;

export const PICK_DEFAULT_TIMEOUT_MS = 60_000;

export const pickElement = defineAction({
  name: 'page.pickElement',
  description:
    'Ask the user to point at an element — A-Eye. Their cursor becomes a lens, whatever they hover is ' +
    'outlined, and the element they click comes back with its selector, its role, its rendered text and a ' +
    'screenshot of it exactly as they saw it. Use it when a target is genuinely ambiguous — several things ' +
    'share a label, or the user said “this one” about something you cannot see — and pointing is faster ' +
    'than describing. It takes over the page and waits for a person, so never call it to explore; a new ' +
    'call dismisses a pick already waiting.',
  input: z.object({
    hint: z
      .string()
      .max(120)
      .optional()
      .describe('One line shown over the page saying what to point at, e.g. “Point at the price you mean”'),
    maxContentLength: z
      .number()
      .int()
      .positive()
      .max(MAX_CONTENT)
      .default(2000)
      .describe('Characters of the element’s rendered text to return; past that it is cut and "truncated" comes back true'),
    timeoutMs: z
      .number()
      .int()
      .min(5_000)
      .max(300_000)
      .default(PICK_DEFAULT_TIMEOUT_MS)
      .describe('How long to wait for the user to click before giving up'),
  }),
  async execute({ hint, maxContentLength, timeoutMs }) {
    const outcome = await pickWithLens({ hint, timeoutMs });
    if ('timedOut' in outcome) {
      throw new ActionError(
        `The user did not point at anything within ${Math.round(timeoutMs / 1000)}s — ask them in words instead`,
        'TIMEOUT',
      );
    }
    if ('cancelled' in outcome) {
      throw new ActionError('The user dismissed A-Eye without picking anything — ask them in words instead', 'PICK_CANCELLED');
    }

    const element = outcome.picked;
    const rendered = element instanceof HTMLElement ? element.innerText : (element.textContent ?? '');
    const content = rendered.replace(/\n{3,}/g, '\n\n').trim() || accessibleText(element);
    const rect = element.getBoundingClientRect();
    return {
      element: describeElement(element),
      content: content.slice(0, maxContentLength),
      truncated: content.length > maxContentLength,
      url: location.href,
      title: document.title,
      capture: {
        region: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        dpr: window.devicePixelRatio || 1,
      },
    };
  },
});
