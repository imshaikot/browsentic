import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { cssPath, resolveTarget, targetSchema } from './dom';

export const submitForm = defineAction({
  name: 'page.submitForm',
  description: 'Submit a form, firing its submit event and validation as if the user pressed Enter.',
  input: z.object({
    target: targetSchema
      .optional()
      .describe('The form, or any element inside it; defaults to the first form on the page'),
  }),
  execute({ target }) {
    const form = target
      ? resolveTarget(target).closest('form')
      : document.querySelector('form');
    if (!form) {
      throw new ActionError('No form found to submit', 'TARGET_NOT_FOUND');
    }
    // requestSubmit runs validation and submit handlers; form.submit() bypasses both.
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.submit();
    }
    // Read attributes, not the IDL props: a control named "action"/"method" shadows them with a DOM node.
    return {
      form: cssPath(form),
      action: form.getAttribute('action') || undefined,
      method: (form.getAttribute('method') || 'get').toLowerCase(),
    };
  },
});
