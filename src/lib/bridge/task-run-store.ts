import { browser } from 'wxt/browser';
import type { RunItem } from './run-items';
import { withoutPreview } from './session-store';

export const TASK_RUNS_KEY = 'browsentic:taskRuns';

const bodyKey = (sessionId: string) => `browsentic:taskRun:${sessionId}`;

export const KEPT_PER_TASK = 3;
export const MAX_TASK_TRANSCRIPTS = 60;
const MAX_ITEMS = 300;

export interface TaskTranscriptMeta {
  sessionId: string;
  taskId: string;
  taskName: string;
  startedAt: number;
  updatedAt: number;
}

export async function listTaskTranscripts(): Promise<TaskTranscriptMeta[]> {
  const stored = await browser.storage.local.get(TASK_RUNS_KEY);
  const list = stored[TASK_RUNS_KEY];
  return Array.isArray(list) ? (list as TaskTranscriptMeta[]) : [];
}

function keptOf(list: TaskTranscriptMeta[]): { kept: TaskTranscriptMeta[]; dropped: TaskTranscriptMeta[] } {
  const seen = new Map<string, number>();
  const kept: TaskTranscriptMeta[] = [];
  const dropped: TaskTranscriptMeta[] = [];
  for (const meta of [...list].sort((a, b) => b.startedAt - a.startedAt)) {
    const count = seen.get(meta.taskId) ?? 0;
    const room = count < KEPT_PER_TASK && kept.length < MAX_TASK_TRANSCRIPTS;
    (room ? kept : dropped).push(meta);
    seen.set(meta.taskId, count + 1);
  }
  return { kept, dropped };
}

export async function putTaskTranscript(meta: TaskTranscriptMeta, items: RunItem[]): Promise<void> {
  if (!items.length) return;
  await browser.storage.local.set({ [bodyKey(meta.sessionId)]: items.slice(-MAX_ITEMS).map(withoutPreview) });
  const list = (await listTaskTranscripts()).filter((held) => held.sessionId !== meta.sessionId);
  const { kept, dropped } = keptOf([meta, ...list]);
  if (dropped.length) await browser.storage.local.remove(dropped.map((held) => bodyKey(held.sessionId)));
  await browser.storage.local.set({ [TASK_RUNS_KEY]: kept });
}

export async function readTaskTranscript(sessionId: string): Promise<RunItem[] | null> {
  const key = bodyKey(sessionId);
  const stored = await browser.storage.local.get(key);
  const items = stored[key];
  return Array.isArray(items) ? (items as RunItem[]) : null;
}

export async function dropTaskTranscripts(taskId: string): Promise<void> {
  const list = await listTaskTranscripts();
  const going = list.filter((meta) => meta.taskId === taskId);
  if (!going.length) return;
  await browser.storage.local.remove(going.map((meta) => bodyKey(meta.sessionId)));
  await browser.storage.local.set({ [TASK_RUNS_KEY]: list.filter((meta) => meta.taskId !== taskId) });
}
