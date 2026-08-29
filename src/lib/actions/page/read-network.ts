import { z } from 'zod';
import { DEFAULT_LIMIT, MAX_BODIES, MAX_LIMIT } from '@/lib/diagnostics/events';
import { ActionError, defineAction } from '../core';

export const readNetwork = defineAction({
  name: 'page.readNetwork',
  description:
    'Read the requests a page has made since page.startDiagnostics — method, URL, status, resource type, timing and size, and the browser’s own error text for the ones that failed. ' +
    'Newest last. This is how a button that “did nothing” turns into a 500 or a CORS refusal. Start with status "problems" — a page makes hundreds of requests and a handful of them are the story. ' +
    'Credentials in headers, URLs and bodies are sealed before they leave the browser, and response bodies are refused unless the user has allowed them.',
  input: z.object({
    diagnosticsId: z
      .string()
      .optional()
      .describe('Which recording to read, from page.startDiagnostics. Omit when only one is running.'),
    drain: z
      .boolean()
      .default(false)
      .describe('Forget the requests returned, so the next call reports only what happened since'),
    includeBodies: z
      .boolean()
      .default(false)
      .describe(
        `Fetch the response body of the ${MAX_BODIES} most recent requests returned, truncated. Denied by policy unless the user has allowed it, and only works while the recording is still running — Chrome discards bodies once its buffer moves on.`,
      ),
    includeHeaders: z
      .boolean()
      .default(false)
      .describe('Include request and response headers. Off by default because they are long and mostly noise.'),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_LIMIT)
      .default(DEFAULT_LIMIT)
      .describe('Most recent requests to return once the filters have been applied'),
    method: z
      .string()
      .max(10)
      .optional()
      .describe('Only requests with this HTTP method, e.g. "POST"'),
    status: z
      .enum(['all', 'problems', 'failed', 'pending'])
      .default('all')
      .describe(
        '"problems" is anything that failed or came back 4xx/5xx; "failed" is requests the browser could not complete at all; "pending" is requests with no response yet',
      ),
    urlContains: z
      .string()
      .max(200)
      .optional()
      .describe('Case-insensitive substring the URL must contain, e.g. "/api/" or "checkout"'),
  }),
  execute() {
    throw new ActionError('page.readNetwork is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
