import { z } from 'zod';
import { defineAction } from '../core';
import { cssPath, resolveTarget, targetSchema } from './dom';

export const extractText = defineAction({
  name: 'page.extractText',
  description: 'Read the rendered text or raw HTML of an element or the whole page.',
  input: z.object({
    target: targetSchema.optional().describe('Element to read; defaults to the whole page'),
    format: z.enum(['text', 'html']).default('text').describe('Plain rendered text or raw HTML'),
    maxLength: z
      .number()
      .int()
      .positive()
      .default(20000)
      .describe('Truncate the result to this many characters'),
  }),
  execute({ target, format, maxLength }) {
    const element = target ? resolveTarget(target) : document.body;
    const full =
      format === 'text' ? element.innerText.replace(/\n{3,}/g, '\n\n').trim() : element.outerHTML;
    return {
      content: full.slice(0, maxLength),
      truncated: full.length > maxLength,
      length: full.length,
      source: cssPath(element),
    };
  },
});
