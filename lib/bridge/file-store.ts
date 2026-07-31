import { browser } from 'wxt/browser';
import { analyzeFile } from './socket';

export const FILES_INDEX_KEY = 'browsentic:files';

const fileBytesKey = (id: string) => `browsentic:file:${id}`;

export type FileStatus = 'pending' | 'ready' | 'error';

export interface StoredFileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  status: FileStatus;
  summary?: string;
  digest?: string;
  error?: string;
  addedAt: number;
}

export interface StoredFileBytes {
  id: string;
  name: string;
  mime: string;
  content: string;
}

export async function listMeta(): Promise<StoredFileMeta[]> {
  const stored = await browser.storage.local.get(FILES_INDEX_KEY);
  const list = stored[FILES_INDEX_KEY];
  return Array.isArray(list) ? (list as StoredFileMeta[]) : [];
}

async function writeIndex(list: StoredFileMeta[]): Promise<void> {
  await browser.storage.local.set({ [FILES_INDEX_KEY]: list });
}

export async function putFile(meta: StoredFileMeta, content: string): Promise<void> {
  const bytes: StoredFileBytes = { id: meta.id, name: meta.name, mime: meta.mime, content };
  await browser.storage.local.set({ [fileBytesKey(meta.id)]: bytes });
  const list = await listMeta();
  await writeIndex([meta, ...list.filter((f) => f.id !== meta.id)]);
}

export async function readBytes(id: string): Promise<StoredFileBytes | null> {
  const key = fileBytesKey(id);
  const stored = await browser.storage.local.get(key);
  const bytes = stored[key] as StoredFileBytes | undefined;
  return bytes && typeof bytes.content === 'string' ? bytes : null;
}

export async function updateMeta(id: string, patch: Partial<StoredFileMeta>): Promise<void> {
  const list = await listMeta();
  await writeIndex(list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
}

export async function removeFile(id: string): Promise<void> {
  await browser.storage.local.remove(fileBytesKey(id));
  const list = await listMeta();
  await writeIndex(list.filter((f) => f.id !== id));
}

export async function analyzeStoredFile(fileId: string): Promise<void> {
  const bytes = await readBytes(fileId);
  if (!bytes) {
    await updateMeta(fileId, { status: 'error', error: 'File bytes are missing from storage.' });
    return;
  }
  const meta = (await listMeta()).find((f) => f.id === fileId);
  const result = await analyzeFile({
    name: bytes.name,
    mime: bytes.mime,
    size: meta?.size ?? 0,
    content: bytes.content,
  });
  if (result.ok) {
    await updateMeta(fileId, {
      status: 'ready',
      summary: result.data.summary,
      digest: result.data.digest,
      error: undefined,
    });
  } else {
    await updateMeta(fileId, { status: 'error', error: `${result.error.code}: ${result.error.message}` });
  }
}
