import { z } from 'zod';
import { AWAIT_DEFAULT_TIMEOUT_MS, AWAIT_MAX_TIMEOUT_MS } from '@/lib/monitor/events';
import { ActionError, defineAction } from '../core';

export const awaitMonitor = defineAction({
  name: 'page.awaitMonitor',
  description:
    'Block until a background monitor completes, then return its final state with the full log. ' +
    'A reply with settled: false means the timeout passed while the watch continues — call again to keep waiting; that is normal, not an error. ' +
    'If the call fails with EXTENSION_OFFLINE the monitor is still running in the browser — reconnect and call again.',
  input: z.object({
    monitorId: z.string().describe('The monitor to wait on, from page.startMonitor'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(AWAIT_MAX_TIMEOUT_MS)
      .default(AWAIT_DEFAULT_TIMEOUT_MS)
      .describe('Return after this long even if unfinished — the reply then has settled: false and the current state, so call again to keep waiting'),
  }),
  execute() {
    throw new ActionError('page.awaitMonitor is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
