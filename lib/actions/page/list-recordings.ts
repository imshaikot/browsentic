import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const listRecordings = defineAction({
  name: 'page.listRecordings',
  description:
    'List the browsing sessions the user recorded in VoiceLink, with the goal and step count of each. Use page.readRecording to open one.',
  input: z.object({
    host: z
      .string()
      .optional()
      .describe('Only return recordings made on this hostname, e.g. "app.example.com".'),
    nameContains: z
      .string()
      .optional()
      .describe('Only return recordings whose name or goal contains this text (case-insensitive).'),
  }),
  execute() {
    throw new ActionError(
      'page.listRecordings is resolved by the VoiceLink extension, not in the page',
      'UNSUPPORTED',
    );
  },
});
