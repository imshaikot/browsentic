import { browser } from 'wxt/browser';
import { MAX_STORED_FILE_BYTES, refusal, type FileReport, type FileVerdict } from '@/lib/files/report';
import { analyzeFile, cancelAnalysis } from './socket';

export const FILES_INDEX_KEY = 'browsentic:files';

const fileBytesKey = (id: string) => `browsentic:file:${id}`;

export type FileStatus = 'pending' | FileVerdict;

export interface StoredFileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  status: FileStatus;
  /** The conversation it was attached in. Only that conversation's agent is handed its report. */
  sessionId?: string;
  report?: FileReport;
  /** The agent session that was handed the report. Any other one is handed it again. */
  deliveredTo?: string;
  addedAt: number;
}

export interface StoredFileBytes {
  id: string;
  name: string;
  mime: string;
  content: string;
}

export type NewFile = Pick<StoredFileMeta, 'id' | 'name' | 'mime' | 'size'>;

let queue: Promise<unknown> = Promise.resolve();

/** The latest request per file. A reply to an older one — from before a reconnect, say — is stale. */
const attempts = new Map<string, string>();

/** The index has one writer, the background, and its writes go through here one at a time. */
function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export async function listMeta(): Promise<StoredFileMeta[]> {
  const stored = await browser.storage.local.get(FILES_INDEX_KEY);
  const list = stored[FILES_INDEX_KEY];
  return Array.isArray(list) ? (list as StoredFileMeta[]) : [];
}

export async function filesFor(sessionId: string): Promise<StoredFileMeta[]> {
  return (await listMeta()).filter((file) => file.sessionId === sessionId);
}

async function writeIndex(list: StoredFileMeta[]): Promise<void> {
  await browser.storage.local.set({ [FILES_INDEX_KEY]: list });
}

/** The panel keeps the bytes itself, under the file's own key; the background indexes the file when it is attached. */
export async function putBytes(bytes: StoredFileBytes): Promise<void> {
  await browser.storage.local.set({ [fileBytesKey(bytes.id)]: bytes });
}

export async function readBytes(id: string): Promise<StoredFileBytes | null> {
  const key = fileBytesKey(id);
  const stored = await browser.storage.local.get(key);
  const bytes = stored[key] as StoredFileBytes | undefined;
  return bytes && typeof bytes.content === 'string' ? bytes : null;
}

export function indexFile(file: NewFile, sessionId: string): Promise<void> {
  return locked(async () => {
    const meta: StoredFileMeta = { ...file, sessionId, status: 'pending', addedAt: Date.now() };
    await writeIndex([meta, ...(await listMeta()).filter((f) => f.id !== file.id)]);
  });
}

export function updateMeta(id: string, patch: Partial<StoredFileMeta>): Promise<void> {
  return locked(async () => {
    const list = await listMeta();
    if (!list.some((f) => f.id === id)) return;
    await writeIndex(list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  });
}

export function removeFile(id: string): Promise<void> {
  return removeWhere((file) => file.id === id, [id]);
}

export function removeFilesFor(sessionIds: string[]): Promise<void> {
  const gone = new Set(sessionIds);
  return removeWhere((file) => file.sessionId !== undefined && gone.has(file.sessionId));
}

/** Drops files whose conversation is neither open nor in history, and files from before attachments had one. */
export function sweepOrphanFiles(conversations: Iterable<string>): Promise<void> {
  const known = new Set(conversations);
  return removeWhere((file) => !file.sessionId || !known.has(file.sessionId));
}

function removeWhere(matches: (file: StoredFileMeta) => boolean, alsoBytes: string[] = []): Promise<void> {
  return locked(async () => {
    const list = await listMeta();
    const gone = list.filter(matches).map((file) => file.id);
    const ids = [...new Set([...gone, ...alsoBytes])];
    if (!ids.length) return;
    await browser.storage.local.remove(ids.map(fileBytesKey));
    if (gone.length) await writeIndex(list.filter((file) => !matches(file)));
  });
}

/**
 * Hands a file to the daemon's file analyst. Resolves once the request is on the socket, with the
 * report still to come — so an instruction sent after it finds the analyst already reading.
 */
export async function requestAnalysis(fileId: string): Promise<{ settled: Promise<void> }> {
  const meta = (await listMeta()).find((f) => f.id === fileId);
  if (!meta?.sessionId) return { settled: Promise.resolve() };
  const tooLarge = meta.size > MAX_STORED_FILE_BYTES;
  const bytes = tooLarge ? null : await readBytes(fileId);
  if (!tooLarge && !bytes) {
    const missing = refusal('failed', undefined, 'FILE_NOT_FOUND', 'The file’s bytes are missing from storage; attach it again.');
    return { settled: settleFile(fileId, missing) };
  }

  const attempt = crypto.randomUUID();
  attempts.set(fileId, attempt);
  await updateMeta(fileId, { status: 'pending', report: undefined, deliveredTo: undefined });
  const reply = analyzeFile({
    fileId,
    sessionId: meta.sessionId,
    name: meta.name,
    mime: meta.mime,
    size: meta.size,
    content: bytes?.content ?? '',
  });
  const settled = reply.then(async (result) => {
    if (attempts.get(fileId) !== attempt) return;
    attempts.delete(fileId);
    await settleFile(fileId, result.ok ? result.data : refusal('failed', undefined, result.error.code, result.error.message));
  });
  return { settled };
}

function settleFile(fileId: string, report: FileReport): Promise<void> {
  return updateMeta(fileId, { status: report.verdict, report });
}

/** Stops the analyst on a file that is going away, then forgets the file. */
export async function discardFile(fileId: string): Promise<void> {
  const meta = (await listMeta()).find((f) => f.id === fileId);
  if (meta?.status === 'pending') cancelAnalysis(fileId);
  await removeFile(fileId);
}

/** Files left reading when the worker slept or the daemon restarted are read again. */
export async function resumePendingFiles(): Promise<void> {
  for (const file of await listMeta()) {
    if (file.status === 'pending' && file.sessionId) void requestAnalysis(file.id);
  }
}

export function cancelAnalysesFor(files: StoredFileMeta[]): void {
  for (const file of files) if (file.status === 'pending') cancelAnalysis(file.id);
}
