import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const listFiles = defineAction({
  name: 'page.listFiles',
  description: 'List the files the user has stored in VoiceLink, with their AI-generated summaries.',
  input: z.object({
    nameContains: z
      .string()
      .optional()
      .describe('Only return files whose name contains this text (case-insensitive).'),
  }),
  execute() {
    throw new ActionError('page.listFiles is resolved by the VoiceLink extension, not in the page', 'UNSUPPORTED');
  },
});
