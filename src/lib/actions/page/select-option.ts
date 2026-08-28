import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { resolveTarget, targetSchema } from './dom';

export const selectOption = defineAction({
  name: 'page.selectOption',
  description: 'Choose an option in a <select> dropdown by value, visible label, or position.',
  input: z.object({
    target: targetSchema.describe('The select element'),
    value: z.string().optional().describe('Match by option value'),
    label: z.string().optional().describe('Match by visible option text, case-insensitive'),
    index: z.number().int().nonnegative().optional().describe('Match by option position'),
  }),
  execute({ target, value, label, index }) {
    const el = resolveTarget(target);
    if (!(el instanceof HTMLSelectElement)) {
      throw new ActionError(`Target <${el.tagName.toLowerCase()}> is not a <select>`, 'INVALID_TARGET');
    }
    const options = [...el.options];
    let option: HTMLOptionElement | undefined;
    if (value !== undefined) {
      option = options.find((opt) => opt.value === value);
    } else if (label !== undefined) {
      const needle = label.trim().toLowerCase();
      option = options.find((opt) => (opt.label || opt.text).trim().toLowerCase() === needle);
    } else if (index !== undefined) {
      option = options[index];
    } else {
      throw new ActionError('Provide a "value", "label", or "index" to choose', 'INVALID_INPUT');
    }
    if (!option) {
      const labels = options.slice(0, 20).map((opt) => (opt.label || opt.text).trim());
      throw new ActionError(
        `No option matches ${JSON.stringify({ value, label, index })}; options are: ${labels.join(', ')}`,
        'TARGET_NOT_FOUND',
      );
    }
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
      el,
      option.value,
    );
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      selected: { value: option.value, label: option.label || option.text, index: option.index },
    };
  },
});
