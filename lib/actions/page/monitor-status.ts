import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const monitorStatus = defineAction({
  name: 'page.monitorStatus',
  description:
    'Report on background monitors started with page.startMonitor: phase, percent, ETA, how long since anything changed, and the latest log lines.',
  input: z.object({
    monitorId: z
      .string()
      .optional()
      .describe('One monitor to report. Omit to list every active and recently finished monitor.'),
  }),
  execute() {
    throw new ActionError('page.monitorStatus is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
