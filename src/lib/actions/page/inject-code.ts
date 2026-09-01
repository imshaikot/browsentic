import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const MAX_CODE_LENGTH = 32_768;

export const injectCode = defineAction({
  name: 'page.injectCode',
  description:
    'Install a small toolkit of JavaScript functions into the page, to be called later with page.runCode. Reach for it only when the ordinary tools are the wrong shape: a step sequence you are about to repeat three or more times with different inputs (create 20 tags, delete every row), or a capability no tool covers (seek a video, read a canvas, drive a bespoke editor API). The user reviews and approves the code before it runs — one approval covers every later page.runCode call and survives page reloads, so batch work needs no further prompts. The toolkit is bound to the tab and origin it was approved on; navigating to another site voids it. Installing goes through Chrome’s debugger, so the browser shows a “Browsentic is debugging this browser” bar for the moment it takes, it cannot install on a tab that has DevTools open, and it is unavailable on Firefox — the calls afterwards are cheap and show nothing. For a one-off click or fill, the ordinary tools are always the better choice.',
  input: z.object({
    purpose: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'One plain sentence saying what this toolkit does and why it is needed — shown to the user on the approval prompt, so write it for them, not for the page.',
      ),
    code: z
      .string()
      .min(1)
      .max(MAX_CODE_LENGTH)
      .describe(
        'JavaScript source that assigns each entry point onto the provided `tools` object: `tools.addTag = async (name) => {…}`. It runs once in the page’s main world after the user approves it, so it can use the page’s DOM, globals and same-origin fetch, but nothing of the extension. Keep it pure of data: anything that varies per call arrives as arguments through page.runCode, and secrets never belong in it. Async functions are awaited; return values must be JSON-serializable.',
      ),
    call: z
      .object({
        function: z.string().min(1).describe('Name of a function the code assigns onto `tools`.'),
        args: z.array(z.unknown()).default([]).describe('Arguments for that first call, JSON values only.'),
      })
      .optional()
      .describe('Call one of the new functions immediately after installing, saving a round trip when the first use is already known.'),
  }),
  execute() {
    throw new ActionError('page.injectCode is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
