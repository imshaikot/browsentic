import { z } from 'zod';
import { defineAction } from '../core';
import { cssPath, resolveTarget, targetSchema } from './dom';

const MAX_EXTRACT_CHARS = 200_000;

export const extractText = defineAction({
  name: 'page.extractText',
  description: 'Read the rendered text or raw HTML of an element or the whole page.',
  input: z.object({
    target: targetSchema.optional().describe('Element to read; defaults to the whole page'),
    format: z
      .enum(['text', 'html'])
      .default('text')
      .describe(
        'Plain rendered text, or raw HTML. HTML is denied by default — it carries comments and hidden nodes ' +
          'the reader never sees — and needs "raw-html-read": "allow" in the guardrail config.',
      ),
    maxLength: z
      .number()
      .int()
      .positive()
      .max(MAX_EXTRACT_CHARS)
      .default(20000)
      .describe('Truncate the result to this many characters'),
  }),
  execute({ target, format, maxLength }) {
    const element = target ? resolveTarget(target) : document.body;
    const full =
      format === 'text' ? element.innerText.replace(/\n{3,}/g, '\n\n').trim() : element.outerHTML;
    return {
      content: full.slice(0, Math.min(maxLength, MAX_EXTRACT_CHARS)),
      truncated: full.length > Math.min(maxLength, MAX_EXTRACT_CHARS),
      length: full.length,
      source: cssPath(element),
    };
  },
});
