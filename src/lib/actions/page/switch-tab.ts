import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const switchTab = defineAction({
  name: 'page.switchTab',
  description:
    'Bring another open tab to the front, making it the tab every later page action targets. Call it with no arguments to list the open tabs and their ids first.',
  input: z.object({
    tabId: z
      .number()
      .int()
      .optional()
      .describe('Id of the tab to switch to, as reported by page.openTab or a no-argument page.switchTab.'),
    match: z
      .string()
      .optional()
      .describe(
        'Instead of an id, switch to the tab whose title or URL contains this text (case-insensitive). If several tabs match, nothing is switched and the candidates are listed.',
      ),
  }),
  execute() {
    throw new ActionError('page.switchTab is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
