import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';
import { keyboardInit } from './keyboard';

export const fillInput = defineAction({
  name: 'page.fillInput',
  description: 'Fill a text input, textarea, or contenteditable element like a user typing.',
  input: z.object({
    target: targetSchema.describe('Element to type into'),
    value: z.string().describe('Text to enter'),
    clear: z.boolean().default(true).describe('Replace existing content instead of appending'),
    pressEnter: z.boolean().default(false).describe('Press Enter afterwards, which submits many forms'),
  }),
  execute({ target, value, clear, pressEnter }) {
    const el = resolveTarget(target);
    el.focus();
    let next: string;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      next = clear ? value : el.value + value;
      // React/Vue ignore direct .value writes on controlled inputs, so use the native prototype setter.
      const proto =
        el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, next);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      next = clear ? value : (el.textContent ?? '') + value;
      el.textContent = next;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    } else {
      throw new ActionError(`<${el.tagName.toLowerCase()}> is not an editable element`, 'INVALID_TARGET');
    }
    if (pressEnter) {
      const enter = keyboardInit('Enter');
      const notPrevented = el.dispatchEvent(new KeyboardEvent('keydown', enter));
      el.dispatchEvent(new KeyboardEvent('keyup', enter));
      // A real Enter submits only when the keydown wasn't cancelled, and never from a textarea.
      if (notPrevented && !(el instanceof HTMLTextAreaElement)) el.closest('form')?.requestSubmit();
    }
    return { element: describeElement(el), value: next };
  },
});
