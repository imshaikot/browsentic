import { browser } from 'wxt/browser';
import { analyzeFile } from './socket';

/**
 * The extension's file repository, kept entirely in `browser.storage.local` (the
 * `unlimitedStorage` permission lifts the default quota). Two shapes, split so a status or
 * summary update never rewrites the file bytes:
 *
 *   'voicelink:files'      -> StoredFileMeta[]     the small, reactive index the UI and
 *                                                  page.listFiles read
 *   'voicelink:file:<id>'  -> StoredFileBytes      base64 bytes, read only when attaching
 *
 * Content-script actions cannot read this store directly (they run in the page's origin), so
 * page.listFiles / page.attachFile are resolved in the background via `lib/bridge/invoke.ts`,
 * which imports the readers here.
 */

/** The reactive metadata index — never holds file bytes. */
export const FILES_INDEX_KEY = 'voicelink:files';

const fileBytesKey = (id: string) => `voicelink:file:${id}`;

export type FileStatus = 'pending' | 'ready' | 'error';

export interface StoredFileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  status: FileStatus;
  /** Present once the daemon has summarized the file. */
  summary?: string;
  /** Present when analysis failed. */
  error?: string;
  addedAt: number;
}

export interface StoredFileBytes {
  id: string;
  name: string;
  mime: string;
  /** Raw base64, with no `data:` prefix. */
  content: string;
}

/** The file index, or an empty list when nothing is stored. */
export async function listMeta(): Promise<StoredFileMeta[]> {
  const stored = await browser.storage.local.get(FILES_INDEX_KEY);
  const list = stored[FILES_INDEX_KEY];
  return Array.isArray(list) ? (list as StoredFileMeta[]) : [];
}

async function writeIndex(list: StoredFileMeta[]): Promise<void> {
  await browser.storage.local.set({ [FILES_INDEX_KEY]: list });
}

/** Store a file: its bytes under their own key, its metadata at the head of the index. */
export async function putFile(meta: StoredFileMeta, content: string): Promise<void> {
  const bytes: StoredFileBytes = { id: meta.id, name: meta.name, mime: meta.mime, content };
  await browser.storage.local.set({ [fileBytesKey(meta.id)]: bytes });
  const list = await listMeta();
  await writeIndex([meta, ...list.filter((f) => f.id !== meta.id)]);
}

/** The raw bytes for a stored file, or null when the id is unknown. */
export async function readBytes(id: string): Promise<StoredFileBytes | null> {
  const key = fileBytesKey(id);
  const stored = await browser.storage.local.get(key);
  const bytes = stored[key] as StoredFileBytes | undefined;
  return bytes && typeof bytes.content === 'string' ? bytes : null;
}

/** Patch one file's metadata in place, leaving its bytes untouched. */
export async function updateMeta(id: string, patch: Partial<StoredFileMeta>): Promise<void> {
  const list = await listMeta();
  await writeIndex(list.map((f) => (f.id === id ? { ...f, ...patch } : f)));
}

/** Remove a file and its bytes. */
export async function removeFile(id: string): Promise<void> {
  await browser.storage.local.remove(fileBytesKey(id));
  const list = await listMeta();
  await writeIndex(list.filter((f) => f.id !== id));
}

/**
 * The daemon round-trip for a stored file: read its bytes, ask the daemon to summarize, and
 * fold the result back into the index. Called from the background worker (it owns the socket),
 * so the summary lands even if the side panel that started it has since closed.
 */
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
    await updateMeta(fileId, { status: 'ready', summary: result.data.summary, error: undefined });
  } else {
    await updateMeta(fileId, { status: 'error', error: `${result.error.code}: ${result.error.message}` });
  }
}
