import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const closeTab = defineAction({
  name: 'page.closeTab',
  description:
    'Close an open tab. With no arguments it closes the tab page actions are currently targeting, and later actions follow the browser to whichever tab it brings to the front.',
  input: z.object({
    tabId: z
      .number()
      .int()
      .optional()
      .describe('Id of the tab to close, as reported by page.openTab or a no-argument page.switchTab.'),
    match: z
      .string()
      .optional()
      .describe(
        'Instead of an id, close the tab whose title or URL contains this text (case-insensitive). If several tabs match, nothing is closed and the candidates are listed.',
      ),
  }),
  execute() {
    throw new ActionError('page.closeTab is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
