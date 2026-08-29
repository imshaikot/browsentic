import { z } from 'zod';
import { DEFAULT_LIMIT, MAX_LIMIT } from '@/lib/diagnostics/events';
import { ActionError, defineAction } from '../core';

export const readConsole = defineAction({
  name: 'page.readConsole',
  description:
    'Read the console messages and uncaught exceptions a page has reported since page.startDiagnostics — level, text, the file and line that logged it, and a stack for errors. ' +
    'Newest last. Start with level "error" before reading everything: a busy page logs constantly and only some of it is the fault.',
  input: z.object({
    contains: z
      .string()
      .max(200)
      .optional()
      .describe('Case-insensitive substring the message must contain, e.g. "TypeError" or a component name'),
    diagnosticsId: z
      .string()
      .optional()
      .describe('Which recording to read, from page.startDiagnostics. Omit when only one is running.'),
    drain: z
      .boolean()
      .default(false)
      .describe('Forget the messages returned, so the next call reports only what happened since'),
    level: z
      .enum(['all', 'debug', 'info', 'warn', 'error'])
      .default('all')
      .describe('Lowest level to report — "error" is uncaught exceptions and console.error alone'),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_LIMIT)
      .default(DEFAULT_LIMIT)
      .describe('Most recent messages to return once the filters have been applied'),
  }),
  execute() {
    throw new ActionError('page.readConsole is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
