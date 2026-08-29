import { z } from 'zod';
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS } from '@/lib/diagnostics/events';
import { ActionError, defineAction } from '../core';

export const startDiagnostics = defineAction({
  name: 'page.startDiagnostics',
  description:
    'Start recording what a page reports rather than what it shows — console messages, uncaught exceptions and every request the tab makes. ' +
    'Console and network events only exist while Chrome’s debugger is attached, so this has to be running before the thing you are diagnosing happens: start it, then reload or click, then read. ' +
    'Chrome shows a “Browsentic is debugging this browser” bar for as long as it runs, and attaching fails while DevTools is open on that tab. ' +
    'Read what it collected with page.readConsole and page.readNetwork, and end it with page.stopDiagnostics. ' +
    'Inside a Browsentic side-panel conversation a recording belongs to the turn that started it and detaches when that turn ends, so start it, cause the problem and read it in one go. Chrome only.',
  input: z.object({
    capture: z
      .array(z.enum(['console', 'network']))
      .default(['console', 'network'])
      .describe('What to record. Narrow it to one when the other would only add noise.'),
    reload: z
      .boolean()
      .default(false)
      .describe(
        'Reload the page once recording has started, so errors thrown during load are caught — they are otherwise long gone by the time anything attaches',
      ),
    tabId: z
      .number()
      .int()
      .optional()
      .describe('Tab to record, from page.openTab or page.switchTab. Defaults to the active tab.'),
    timeoutMs: z
      .number()
      .int()
      .min(MIN_TIMEOUT_MS)
      .max(MAX_TIMEOUT_MS)
      .default(DEFAULT_TIMEOUT_MS)
      .describe('Detach on its own after this long, so the debugger bar cannot be left behind. Chrome will not fire an alarm sooner than 30 s.'),
  }),
  execute() {
    throw new ActionError(
      'page.startDiagnostics is resolved by the Browsentic extension, not in the page',
      'UNSUPPORTED',
    );
  },
});
