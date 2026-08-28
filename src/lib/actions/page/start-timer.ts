import { z } from 'zod';
import {
  DEFAULT_MAX_RUNS,
  MAX_PROMPT_CHARS,
  MAX_TIMER_MS,
  MAX_TIMER_RUNS,
  MIN_TIMER_MS,
} from '@/lib/timers/events';
import { ActionError, defineAction } from '../core';

export const startTimer = defineAction({
  name: 'page.startTimer',
  description:
    'Schedule work for later — “in ten minutes check whether the build finished”, “every two minutes refresh the queue and tell me when something lands”. ' +
    'Returns a timerId immediately; the extension keeps the schedule with no further tool calls and wakes this conversation with your prompt each time it fires, so set it and end your turn. ' +
    'Reach for page.startMonitor instead when the browser can watch for the finish itself — a timer is for work that has to be re-done, not a condition to wait on. ' +
    'Check on it with page.timerStatus, end it with page.stopTimer.',
  input: z.object({
    prompt: z
      .string()
      .min(1)
      .max(MAX_PROMPT_CHARS)
      .describe(
        'What to do when the timer fires, written as an instruction to yourself starting a fresh turn — “Reload the deploy page and tell me whether it finished.” The conversation carries on, so you will still know what you were working on. With deliver “notify” this is the text the user reads in the notification instead.',
      ),
    afterMs: z
      .number()
      .int()
      .min(MIN_TIMER_MS)
      .max(MAX_TIMER_MS)
      .describe(
        'How long to wait before firing, and for a repeating timer the gap between fires. 30 seconds is the shortest interval the browser can keep.',
      ),
    repeat: z
      .boolean()
      .default(false)
      .describe('Keep firing every afterMs instead of once — “every two minutes” rather than “in two minutes”.'),
    maxRuns: z
      .number()
      .int()
      .min(1)
      .max(MAX_TIMER_RUNS)
      .default(DEFAULT_MAX_RUNS)
      .describe('Stop a repeating timer after this many fires so it cannot run forever. Ignored when repeat is false.'),
    label: z
      .string()
      .max(80)
      .optional()
      .describe('Short name shown in the side panel and in notifications, e.g. “deploy check”.'),
    deliver: z
      .enum(['agent', 'notify'])
      .default('agent')
      .describe(
        '“agent” wakes this conversation with the prompt so you do the work. “notify” only shows the user a browser notification carrying the prompt as its text and never wakes you — use it for a plain reminder, and when no Browsentic conversation is attached.',
      ),
  }),
  execute() {
    throw new ActionError('page.startTimer is resolved by the Browsentic extension, not in the page', 'UNSUPPORTED');
  },
});
