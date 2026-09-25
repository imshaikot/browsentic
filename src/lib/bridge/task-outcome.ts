import { headlineOf, type TaskResult } from '@/lib/schedules/task';
import type { RunItem } from './run-items';

export type TaskVerdict = Pick<TaskResult, 'outcome' | 'reason' | 'headline'>;

export function verdictOf(items: readonly RunItem[]): TaskVerdict {
  const last = items.at(-1);
  if (last?.kind === 'notice' && last.tone === 'error') {
    return { outcome: /^CANCELLED\b/.test(last.text) ? 'cancelled' : 'failed', reason: last.text };
  }
  const reply = items.findLast((item) => item.kind === 'assistant');
  const headline = reply?.kind === 'assistant' ? headlineOf(reply.text) : undefined;
  return headline ? { outcome: 'ok', headline } : { outcome: 'ok' };
}

export function replayVerdict(steps: number, extracted?: string): TaskVerdict {
  const firstLine = extracted?.split('\n').find((line) => line.trim());
  return { outcome: 'ok', headline: (firstLine && headlineOf(firstLine)) || `Replayed all ${steps} steps.` };
}

export function handOverPrompt(replay: {
  name: string;
  goal: string;
  ordinal: number;
  total: number;
  intent: string;
  error: string;
}): string {
  return [
    `Replaying the recording “${replay.name}” stopped at step ${replay.ordinal} of ${replay.total} (${replay.intent}): ${replay.error}.`,
    `Its goal: ${replay.goal}`,
    'The steps before it are done. Finish the job from where it stopped, on this page.',
  ].join('\n\n');
}
