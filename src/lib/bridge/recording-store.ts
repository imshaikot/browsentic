import { browser } from 'wxt/browser';
import type { SavedRecording } from '@/lib/actions/protocol';
import { hostOf, originOf, type RecordedEvent } from '@/lib/recordings/events';
import { validateRecordingWorkflow, type RecordingWorkflow } from '@/lib/recordings/workflow';
import { analyzeRecording } from './socket';

export const RECORDINGS_INDEX_KEY = 'browsentic:recordings';

const bodyKey = (id: string) => `browsentic:recording:${id}`;

const MAX_RECORDINGS = 20;

export type RecordingStatus = 'recording' | 'analyzing' | 'ready' | 'error';

export interface StoredRecordingMeta {
  id: string;
  name: string;
  host: string;
  startUrl: string;
  status: RecordingStatus;
  capturedValues: boolean;
  events: number;
  steps?: number;
  goal?: string;
  summary?: string;
  warnings?: string[];
  durationMs: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredRecordingBody {
  id: string;
  events: RecordedEvent[];
  workflow?: RecordingWorkflow;
}

export async function listRecordings(): Promise<StoredRecordingMeta[]> {
  const stored = await browser.storage.local.get(RECORDINGS_INDEX_KEY);
  const list = stored[RECORDINGS_INDEX_KEY];
  return Array.isArray(list) ? (list as StoredRecordingMeta[]) : [];
}

async function writeIndex(list: StoredRecordingMeta[]): Promise<void> {
  await browser.storage.local.set({ [RECORDINGS_INDEX_KEY]: list });
}

export async function putRecording(meta: StoredRecordingMeta, body: StoredRecordingBody): Promise<void> {
  await browser.storage.local.set({ [bodyKey(meta.id)]: body });
  const list = await listRecordings();
  const existing = list.find((r) => r.id === meta.id);
  const kept = [{ ...existing, ...meta }, ...list.filter((r) => r.id !== meta.id)];
  const dropped = kept.slice(MAX_RECORDINGS);
  if (dropped.length) await browser.storage.local.remove(dropped.map((r) => bodyKey(r.id)));
  await writeIndex(kept.slice(0, MAX_RECORDINGS));
}

export async function readRecordingBody(id: string): Promise<StoredRecordingBody | null> {
  const key = bodyKey(id);
  const stored = await browser.storage.local.get(key);
  const body = stored[key] as StoredRecordingBody | undefined;
  return body && Array.isArray(body.events) ? body : null;
}

export async function updateRecordingMeta(id: string, patch: Partial<StoredRecordingMeta>): Promise<void> {
  const list = await listRecordings();
  if (!list.some((r) => r.id === id)) return;
  await writeIndex(list.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)));
}

export async function removeRecording(id: string): Promise<void> {
  await browser.storage.local.remove(bodyKey(id));
  const list = await listRecordings();
  await writeIndex(list.filter((r) => r.id !== id));
}

export async function renameRecording(id: string, name: string): Promise<void> {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!cleaned) return;
  await updateRecordingMeta(id, { name: cleaned });
}

export async function analyzeStoredRecording(recordingId: string): Promise<void> {
  const meta = (await listRecordings()).find((r) => r.id === recordingId);
  if (!meta) return;
  const body = await readRecordingBody(recordingId);
  if (!body || !body.events.length) {
    await updateRecordingMeta(recordingId, {
      status: 'error',
      error: 'The recorded steps are missing from storage.',
    });
    return;
  }

  await updateRecordingMeta(recordingId, { status: 'analyzing', error: undefined });
  const result = await analyzeRecording({
    id: meta.id,
    name: meta.name,
    host: meta.host,
    startUrl: meta.startUrl,
    captureValues: meta.capturedValues,
    durationMs: meta.durationMs,
    events: body.events,
  });

  if (!result.ok) {
    await updateRecordingMeta(recordingId, {
      status: 'error',
      error: `${result.error.code}: ${result.error.message}`,
    });
    return;
  }

  const checked = validateRecordingWorkflow(result.data.workflow, { origin: originOf(meta.startUrl) });
  if (!checked.ok) {
    await updateRecordingMeta(recordingId, { status: 'error', error: checked.message });
    return;
  }

  await browser.storage.local.set({
    [bodyKey(recordingId)]: { ...body, workflow: checked.workflow } satisfies StoredRecordingBody,
  });
  await updateRecordingMeta(recordingId, {
    status: 'ready',
    goal: checked.workflow.goal,
    summary: checked.workflow.summary,
    steps: checked.workflow.steps.length,
    warnings: [...result.data.warnings, ...checked.warnings].slice(0, 8),
    name: meta.name === defaultRecordingName(meta.host, meta.createdAt) ? checked.workflow.goal : meta.name,
    error: undefined,
  });
}

export async function resumePendingAnalyses(): Promise<void> {
  const list = await listRecordings();
  for (const meta of list) {
    if (meta.status === 'analyzing' || meta.error?.startsWith('EXTENSION_OFFLINE')) {
      await analyzeStoredRecording(meta.id);
    }
  }
}

export function defaultRecordingName(host: string, createdAt: number): string {
  const when = new Date(createdAt);
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return `${host || 'Browsing'} — ${stamp}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function asSavedRecording(meta: StoredRecordingMeta): SavedRecording {
  return {
    id: meta.id,
    name: meta.name,
    host: meta.host || hostOf(meta.startUrl),
    goal: meta.goal,
    steps: meta.steps,
    capturedValues: meta.capturedValues,
    durationMs: meta.durationMs,
  };
}
