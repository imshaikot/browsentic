import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const stopTimer = defineAction({
  name: 'page.stopTimer',
  description:
    'Cancel a scheduled job before it has run out. Nothing further fires and no notification is shown — the stop was asked for.',
  input: z.object({
    timerId: z
      .string()
      .optional()
      .describe('Omit when only one timer is scheduled; with several an omitted id stops nothing and the candidates are listed.'),
  }),
  execute() {
    throw new ActionError('page.stopTimer is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
