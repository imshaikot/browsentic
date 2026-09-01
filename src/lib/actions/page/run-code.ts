import { z } from 'zod';
import { defineAction } from '../core';
import { callToolkit } from './toolkit';

export const runCode = defineAction({
  name: 'page.runCode',
  description:
    'Call one function from the toolkit page.injectCode installed in this tab, with fresh arguments. This is the cheap, repeatable half of the pair: the user approved the code once, so every call runs without another prompt, and a page reload re-installs the approved toolkit on its own. It refuses if nothing is installed here, or if the tab has moved to a different site than the one the code was approved on — inject again in either case. The function’s return value comes back as JSON.',
  input: z.object({
    function: z.string().min(1).describe('Name of a function the installed toolkit assigned onto `tools`.'),
    args: z
      .array(z.unknown())
      .default([])
      .describe(
        'Arguments passed to the function, in order. JSON values only — this is where per-call data like a tag name belongs.',
      ),
    timeoutMs: z
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(10_000)
      .describe('How long the call may run before it is abandoned. Raise it for functions that wait on the page.'),
  }),
  async execute({ function: fn, args, timeoutMs }) {
    return { function: fn, returned: await callToolkit(fn, args, timeoutMs) };
  },
});
