import { browser } from 'wxt/browser';
import type { RunItem } from './use-run';
import { nameSession } from './socket';

export const SESSIONS_INDEX_KEY = 'browsentic:sessions';

const transcriptKey = (id: string) => `browsentic:session:${id}`;

const MAX_SESSIONS = 50;

const MAX_ITEMS = 500;

export const TITLE_TURNS = [1, 5, 15] as const;

export interface StoredSessionMeta {
  id: string;
  title?: string;
  host?: string;
  url?: string;
  claudeSessionId?: string;
  turns: number;
  titledAtTurn?: number;
  namingAt?: number;
  createdAt: number;
  updatedAt: number;
}

export const NAMING_STALE_MS = 60_000;

export const isNaming = (session: StoredSessionMeta): boolean =>
  session.namingAt !== undefined && Date.now() - session.namingAt < NAMING_STALE_MS;

export interface StoredSessionTranscript {
  id: string;
  items: RunItem[];
}

export async function listSessions(): Promise<StoredSessionMeta[]> {
  const stored = await browser.storage.local.get(SESSIONS_INDEX_KEY);
  const list = stored[SESSIONS_INDEX_KEY];
  return Array.isArray(list) ? (list as StoredSessionMeta[]) : [];
}

async function writeIndex(list: StoredSessionMeta[]): Promise<void> {
  await browser.storage.local.set({ [SESSIONS_INDEX_KEY]: list });
}

export type SessionFields = Omit<StoredSessionMeta, 'title' | 'titledAtTurn' | 'namingAt'>;

export async function putSession(fields: SessionFields, items: RunItem[]): Promise<void> {
  if (!items.length) return;
  const transcript: StoredSessionTranscript = { id: fields.id, items: items.slice(-MAX_ITEMS) };
  await browser.storage.local.set({ [transcriptKey(fields.id)]: transcript });

  const list = await listSessions();
  const existing = list.find((s) => s.id === fields.id);
  const kept = [{ ...existing, ...fields }, ...list.filter((s) => s.id !== fields.id)];
  const dropped = kept.slice(MAX_SESSIONS);
  if (dropped.length) await browser.storage.local.remove(dropped.map((s) => transcriptKey(s.id)));
  await writeIndex(kept.slice(0, MAX_SESSIONS));
}

export async function readTranscript(id: string): Promise<StoredSessionTranscript | null> {
  const key = transcriptKey(id);
  const stored = await browser.storage.local.get(key);
  const transcript = stored[key] as StoredSessionTranscript | undefined;
  return transcript && Array.isArray(transcript.items) ? transcript : null;
}

export async function updateSessionMeta(id: string, patch: Partial<StoredSessionMeta>): Promise<void> {
  const list = await listSessions();
  if (!list.some((s) => s.id === id)) return;
  await writeIndex(list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

export async function removeSession(id: string): Promise<void> {
  await browser.storage.local.remove(transcriptKey(id));
  const list = await listSessions();
  await writeIndex(list.filter((s) => s.id !== id));
}

const MAX_TITLE_CHARS = 60;

const MAX_TITLE_MESSAGES = 12;

export async function nameStoredSession(sessionId: string): Promise<void> {
  const meta = (await listSessions()).find((s) => s.id === sessionId);
  if (!meta) return;
  const transcript = await readTranscript(sessionId);
  const messages = (transcript?.items ?? [])
    .filter((item): item is Extract<RunItem, { kind: 'user' }> => item.kind === 'user')
    .map((item) => item.text)
    .slice(-MAX_TITLE_MESSAGES);
  if (!messages.length) return;

  const turns = meta.turns;
  await updateSessionMeta(sessionId, { namingAt: Date.now() });
  const result = await nameSession({ host: meta.host, messages });
  if (result.ok && result.data.title.trim()) {
    await updateSessionMeta(sessionId, {
      title: result.data.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS),
      titledAtTurn: turns,
      namingAt: undefined,
    });
    return;
  }
  await updateSessionMeta(sessionId, { titledAtTurn: turns, namingAt: undefined });
}

export function titleDueAt(turns: number, titledAtTurn = 0): number | null {
  const crossed = TITLE_TURNS.filter((threshold) => turns >= threshold);
  const latest = crossed.at(-1);
  return latest !== undefined && latest > titledAtTurn ? latest : null;
}
