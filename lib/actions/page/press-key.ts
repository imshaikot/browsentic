import { z } from 'zod';
import { defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';
import { keyboardInit } from './keyboard';

export const pressKey = defineAction({
  name: 'page.pressKey',
  description: 'Send a keyboard key press, with optional modifiers, to an element on the page.',
  input: z.object({
    key: z.string().describe('DOM KeyboardEvent.key value, e.g. "Enter", "Escape", "ArrowDown", "a"'),
    modifiers: z
      .array(z.enum(['ctrl', 'shift', 'alt', 'meta']))
      .default([])
      .describe('Modifier keys held during the press'),
    target: targetSchema
      .optional()
      .describe('Element to receive the key; defaults to the currently focused element'),
  }),
  execute({ key, modifiers, target }) {
    const el = target
      ? resolveTarget(target)
      : ((document.activeElement as HTMLElement | null) ?? document.body);
    try {
      el.focus();
    } catch {}
    const init = keyboardInit(key, modifiers);
    const notPrevented = el.dispatchEvent(new KeyboardEvent('keydown', init));
    const printable = key.length === 1 && !init.ctrlKey && !init.metaKey;
    if (notPrevented && (printable || key === 'Enter')) {
      el.dispatchEvent(new KeyboardEvent('keypress', init));
    }
    if (printable && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const next = el.value.slice(0, start) + key + el.value.slice(end);
      // Synthetic key events never insert text; write through the native value setter so
      // framework-controlled inputs (e.g. React) observe the change.
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next);
      const caret = start + key.length;
      try {
        el.setSelectionRange(caret, caret);
      } catch {}
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: key, inputType: 'insertText' }));
    }
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    // Synthetic Enter performs no default action; emulate implicit form submission from a single input.
    if (key === 'Enter' && notPrevented && el instanceof HTMLInputElement) el.form?.requestSubmit();
    return { key, modifiers, receivedBy: describeElement(el) };
  },
});
