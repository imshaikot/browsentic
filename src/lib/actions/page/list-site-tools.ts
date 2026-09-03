import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const listSiteTools = defineAction({
  name: 'page.listSiteTools',
  description:
    'List the tools this site itself offers to agents through WebMCP (document.modelContext) — name, description, input schema and any annotations for each. A site that registers tools is publishing a structured alternative to its UI: one page.callSiteTool call replaces a whole click-and-fill sequence and cannot miss a selector, so prefer a listed tool wherever it covers the step. page.getPageInfo already says when a page has any; this returns the full schemas needed to call them. Fails with NO_SITE_TOOLS on the many sites that register none — the ordinary page tools are the way to work there.',
  input: z.object({}),
  execute() {
    throw new ActionError('page.listSiteTools is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
