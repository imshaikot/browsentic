import { z } from 'zod';
import { defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';

export const focusInput = defineAction({
  name: 'page.focusInput',
  description: 'Focus an input or editable element and place the caret, or select all its content.',
  input: z.object({
    target: targetSchema.describe('The input, textarea, or editable element to focus'),
    caret: z
      .enum(['start', 'end', 'all'])
      .default('end')
      .describe('Where to leave the caret, or select all content'),
  }),
  execute({ target, caret }) {
    const el = resolveTarget(target);
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (caret === 'all') {
        el.select();
      } else {
        const position = caret === 'start' ? 0 : el.value.length;
        try {
          el.setSelectionRange(position, position);
        } catch {}
      }
    } else if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      if (caret !== 'all') range.collapse(caret === 'start');
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    return describeElement(el);
  },
});
