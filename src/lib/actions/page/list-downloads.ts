import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const listDownloads = defineAction({
  name: 'page.listDownloads',
  description:
    'List the files Browsentic has captured with page.captureDownload, newest first, with notes about what each one is and where it was saved. Use a downloadId from here with page.attachFile to upload one to another page.',
  input: z.object({
    nameContains: z
      .string()
      .optional()
      .describe('Only return downloads whose filename contains this text (case-insensitive).'),
  }),
  execute() {
    throw new ActionError(
      'page.listDownloads is resolved by the Browsentic daemon, not in the page',
      'UNSUPPORTED',
    );
  },
});
