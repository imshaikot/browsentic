import { z } from 'zod';
import { ActionError, defineAction } from '../core';

export const stopDiagnostics = defineAction({
  name: 'page.stopDiagnostics',
  description:
    'Detach the debugger and take Chrome’s “Browsentic is debugging this browser” bar away. What was collected stays readable by page.readConsole and page.readNetwork afterwards, minus response bodies, which only exist while attached. ' +
    'Call this as soon as you have what you need rather than leaving the bar up.',
  input: z.object({
    diagnosticsId: z
      .string()
      .optional()
      .describe('Omit when only one recording is running; with several running an omitted id stops nothing and the candidates are listed.'),
  }),
  execute() {
    throw new ActionError(
      'page.stopDiagnostics is resolved by the Browsentic extension, not in the page',
      'UNSUPPORTED',
    );
  },
});
