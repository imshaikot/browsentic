import { z } from 'zod';
import { DEFAULT_MONITOR_TIMEOUT_MS, MAX_MONITOR_TIMEOUT_MS } from '@/lib/monitor/events';
import { ActionError, defineAction } from '../core';
import { targetSchema } from './dom';

export const startMonitor = defineAction({
  name: 'page.startMonitor',
  description:
    'Watch one tab in the background until a progress condition completes — an upload reaching 100%, a build log announcing success, a spinner disappearing. ' +
    'Returns a monitorId immediately; the extension pins the tab, keeps watching with no further tool calls even while the user works elsewhere, and notifies them on completion. ' +
    'Call page.findProgress first to pick a real signal. Check on it with page.monitorStatus, block for it with page.awaitMonitor, end it with page.stopMonitor.',
  input: z.object({
    until: z
      .object({
        kind: z
          .enum(['element-appears', 'element-vanishes', 'text-matches', 'progress-reaches', 'title-matches'])
          .describe('What ends the watch'),
        target: targetSchema
          .optional()
          .describe(
            'Element to watch — required for element-appears, element-vanishes and progress-reaches; optional scope for text-matches',
          ),
        pattern: z
          .string()
          .max(200)
          .optional()
          .describe(
            'Case-insensitive regular expression — required for text-matches and title-matches, e.g. "upload complete|processing finished"',
          ),
        threshold: z
          .number()
          .min(1)
          .max(100)
          .default(100)
          .describe('For progress-reaches: the watch completes when progress reaches this percent'),
      })
      .describe('The condition that completes the watch'),
    label: z
      .string()
      .max(80)
      .optional()
      .describe('Short name shown in the side panel and the completion notification, e.g. "YouTube upload"'),
    tabId: z
      .number()
      .int()
      .optional()
      .describe('Tab to watch, from page.openTab or page.switchTab. Defaults to the active tab.'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(MAX_MONITOR_TIMEOUT_MS)
      .default(DEFAULT_MONITOR_TIMEOUT_MS)
      .describe('Give up and report a timeout after this long'),
  }),
  execute() {
    throw new ActionError('page.startMonitor is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
