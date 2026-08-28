import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const stopMonitor = defineAction({
  name: 'page.stopMonitor',
  description:
    'Stop a background monitor before it completes. The tab is unpinned again if the monitor pinned it. No notification is shown — the stop was asked for.',
  input: z.object({
    monitorId: z
      .string()
      .optional()
      .describe('Omit when only one monitor is running; with several running an omitted id stops nothing and the candidates are listed.'),
  }),
  execute() {
    throw new ActionError('page.stopMonitor is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
