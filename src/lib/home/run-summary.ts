import type { RunItem } from '@/lib/bridge/run-items';

type Tool = Extract<RunItem, { kind: 'tool' }>;

type User = Extract<RunItem, { kind: 'user' }>;

/** The latest turn of a conversation, told in one card: what was asked and where it stands. */
export type RunSummary =
  | { phase: 'idle' }
  | { phase: 'working'; asked: string; step?: Tool }
  | { phase: 'approval'; asked: string; step: Tool }
  | { phase: 'reply'; asked: string; reply: string; live: boolean }
  | { phase: 'failed'; asked: string; message: string }
  | { phase: 'done'; asked: string; step?: Tool };

const isTool = (item: RunItem): item is Tool => item.kind === 'tool';

export function summarize(items: readonly RunItem[], running: boolean): RunSummary {
  const start = items.findLastIndex((item) => item.kind === 'user');
  if (start < 0) return { phase: 'idle' };

  const asked = (items[start] as User).text;
  const turn = items.slice(start + 1);
  const step = turn.findLast(isTool);
  const awaiting = turn.find((item): item is Tool => isTool(item) && item.awaiting === true);
  if (running && awaiting) return { phase: 'approval', asked, step: awaiting };

  const last = turn.at(-1);
  if (last?.kind === 'assistant') return { phase: 'reply', asked, reply: last.text, live: running };
  if (last?.kind === 'notice' && last.tone === 'error') return { phase: 'failed', asked, message: last.text };
  if (running) return { phase: 'working', asked, step };

  const reply = turn.findLast((item) => item.kind === 'assistant');
  return reply ? { phase: 'reply', asked, reply: reply.text, live: false } : { phase: 'done', asked, step };
}

export const toolName = (step: Tool): string => step.action.replace(/^page\./, '');
