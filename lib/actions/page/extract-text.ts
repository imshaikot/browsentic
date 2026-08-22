import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { digestOf, groupEnd, readCursor, writeCursor } from './chunks';
import { cssPath, resolveTarget, targetSchema } from './dom';

const MAX_EXTRACT_CHARS = 200_000;

export const extractText = defineAction({
  name: 'page.extractText',
  description:
    'Read the rendered text or raw HTML of an element or the whole page, one group at a time. ' +
    'A group is cut at the last paragraph or sentence boundary that fits in maxLength, never mid-sentence, ' +
    'and the same page always groups the same way. When more text remains the reply carries a cursor — pass it ' +
    'back for the next group, and keep going until no cursor comes back. ' +
    'The cursor is checked against the text it already handed you, so two groups never come from two different ' +
    'versions of the page: if the page rewrote what you had read, the reply is "stale": true and nothing else, ' +
    'and the read starts over with no cursor.',
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
      .describe('Characters per group — the reply stops at the last boundary that fits, so it comes back a little shorter'),
    cursor: z
      .string()
      .max(32)
      .optional()
      .describe('Continue a read: the cursor the previous reply returned. Omit to start from the top.'),
  }),
  execute({ target, format, maxLength, cursor }) {
    const element = target ? resolveTarget(target) : document.body;
    const full =
      format === 'text' ? element.innerText.replace(/\n{3,}/g, '\n\n').trim() : element.outerHTML;
    const source = cssPath(element);
    const budget = Math.min(maxLength, MAX_EXTRACT_CHARS);

    const resume = cursor ? readCursor(cursor) : null;
    if (cursor && !resume) {
      throw new ActionError(
        'That is not a cursor page.extractText handed out — omit it to read from the top',
        'INVALID_INPUT',
      );
    }
    if (resume && digestOf(full.slice(0, resume.offset)) !== resume.digest) {
      return { stale: true, source, length: full.length };
    }

    const offset = resume?.offset ?? 0;
    const end = groupEnd(full, offset, budget);
    const more = end < full.length;
    return {
      content: full.slice(offset, end).trimEnd(),
      source,
      length: full.length,
      offset,
      truncated: more,
      ...(more ? { nextOffset: end, cursor: writeCursor(end, full.slice(0, end)) } : {}),
    };
  },
});
