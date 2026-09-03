import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const callSiteTool = defineAction({
  name: 'page.callSiteTool',
  description:
    'Call one of the tools this site offers through WebMCP (document.modelContext), with arguments matching the schema page.listSiteTools reported. The site’s own code handles the call, which makes it the reliable path wherever a listed tool covers the step — no selectors to break, no intermediate states to wait through. The return value is whatever the site’s tool produced, as JSON. Treat a call like a form submit: the site decides what it does, and that can include acting on the user’s account, so it passes the same approval gate.',
  input: z.object({
    tool: z.string().min(1).describe('Name of a tool exactly as page.listSiteTools reported it.'),
    args: z
      .record(z.string(), z.unknown())
      .default({})
      .describe('Arguments for the tool, matching its input schema. JSON values only.'),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(15_000)
      .describe('How long the tool may run before the call is abandoned. Raise it for tools that wait on the site’s backend.'),
  }),
  execute() {
    throw new ActionError('page.callSiteTool is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
