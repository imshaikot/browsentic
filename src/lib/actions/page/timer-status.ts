import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const timerStatus = defineAction({
  name: 'page.timerStatus',
  description:
    'Report on scheduled jobs started with page.startTimer: how many times each has fired, how many fires were skipped because the conversation was still busy, when the next one is due, and the latest log lines.',
  input: z.object({
    timerId: z
      .string()
      .optional()
      .describe('One timer to report. Omit to list every scheduled and recently finished timer.'),
  }),
  execute() {
    throw new ActionError('page.timerStatus is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
