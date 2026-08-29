import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import {
  DOWNLOAD_TTL_DAYS,
  MAX_ATTACH_BYTES,
  MAX_DOWNLOAD_BYTES,
  describeSize,
  extensionOf,
  isExecutableName,
} from '@/lib/downloads/limits';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { hostAllowed } from './guardrails';
import { readAgentConfig } from './agent/config';
import { stateDir } from './lockfile';
import { log } from './log';

/**
 * Where a captured download lives and what the agent is told about it.
 *
 * The daemon owns this end for the same reason it owns screenshots: it is the only half
 * with a filesystem. It is also the only half that knows a run's scope, so every refusal
 * lands here — and a refusal deletes the file the browser already wrote, because the point
 * of refusing an installer is that the installer does not end up on the disk.
 *
 * The agent gets `notes`: name, type, size, and the shape of the thing. Never the bytes,
 * never a path it could read from, and never a directory it could list.
 */

export interface DownloadRecord {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  host?: string;
  notes: string;
  savedTo: string;
  capturedAt: string;
}

export interface CapturedItem {
  browserPath: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  host?: string;
}

const indexPath = join(stateDir, 'downloads.json');

export function downloadDir(): string {
  const configured = readAgentConfig().downloadDir;
  if (typeof configured === 'string' && configured.trim()) return expandHome(configured.trim());
  return join(homedir(), 'browsentic', 'download');
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : join(homedir(), p);
}

function readIndex(): DownloadRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as DownloadRecord[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(records: DownloadRecord[]): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(indexPath, JSON.stringify(records, null, 2), { mode: 0o600 });
  chmodSync(indexPath, 0o600);
}

function discard(path: string): void {
  try {
    unlinkSync(path);
  } catch {}
}

/**
 * Take the file the browser just wrote, or refuse it and delete it.
 *
 * `hosts` is the run's scope. A download whose host the run was never pointed at is the
 * same exfiltration-shaped surprise as an off-scope navigation, except it arrives after
 * the fact — there is nothing left to confirm, so it is refused and removed.
 */
export function adoptDownload(item: CapturedItem, hosts?: readonly string[]): ActionResult<DownloadRecord> {
  const { browserPath } = item;
  if (!browserPath || !existsSync(browserPath)) {
    return failure('DOWNLOAD_MISSING', 'The browser reported a download that is no longer on disk.');
  }

  if (hosts && item.host && !hostAllowed(item.host, hosts)) {
    discard(browserPath);
    return failure(
      'DOWNLOAD_OFF_SCOPE',
      `That download came from ${item.host}, which is not a site this run was asked about. It has been deleted.`,
    );
  }

  if (isExecutableName(item.name)) {
    discard(browserPath);
    return failure(
      'DOWNLOAD_REFUSED',
      `Browsentic does not keep executables — “${item.name}” is a .${extensionOf(item.name)} file. It has been deleted.`,
    );
  }

  const size = sizeOf(browserPath, item.size);
  if (size > MAX_DOWNLOAD_BYTES) {
    discard(browserPath);
    return failure(
      'DOWNLOAD_TOO_LARGE',
      `That file is ${describeSize(size)}, over the ${describeSize(MAX_DOWNLOAD_BYTES)} download limit. It has been deleted.`,
    );
  }

  sweepDownloads();

  const dir = downloadDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const savedTo = join(dir, `${stamp()}-${safeName(item.name)}`);
  try {
    relocate(browserPath, savedTo);
  } catch (error) {
    return failure('DOWNLOAD_SAVE_FAILED', error instanceof Error ? error.message : String(error));
  }
  chmodSync(savedTo, 0o600);

  const record: DownloadRecord = {
    id,
    name: item.name,
    mime: item.mime,
    size,
    url: item.url,
    host: item.host,
    notes: notesFor(savedTo, item.name, item.mime, size),
    savedTo,
    capturedAt: new Date().toISOString(),
  };
  writeIndex([record, ...readIndex()]);
  log(`captured ${item.name} (${describeSize(size)}) from ${item.host ?? 'unknown host'} → ${savedTo}`);
  return success(record);
}

/** Across filesystems a rename fails, so fall back to copy-then-delete rather than leaving it. */
function relocate(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

function sizeOf(path: string, reported: number): number {
  try {
    return statSync(path).size;
  } catch {
    return reported;
  }
}

export function listDownloads(input: unknown): ActionResult {
  sweepDownloads();
  const filter = (input as { nameContains?: unknown } | undefined)?.nameContains;
  const needle = typeof filter === 'string' ? filter.toLowerCase() : null;
  const downloads = readIndex()
    .filter((record) => existsSync(record.savedTo))
    .filter((record) => !needle || record.name.toLowerCase().includes(needle))
    .map(({ id, name, mime, size, host, notes, savedTo, capturedAt }) => ({
      id,
      name,
      mime,
      size,
      host,
      notes,
      savedTo,
      capturedAt,
    }));
  return success({ downloads });
}

export function readDownloadBytes(id: string): ActionResult<{ name: string; mime: string; content: string }> {
  const record = readIndex().find((entry) => entry.id === id);
  if (!record) {
    return failure(
      'DOWNLOAD_NOT_FOUND',
      `No captured download with id "${id}". Call page.listDownloads to see what has been captured.`,
    );
  }
  if (!existsSync(record.savedTo)) {
    return failure('DOWNLOAD_MISSING', `“${record.name}” is no longer in the download folder — capture it again.`);
  }
  if (record.size > MAX_ATTACH_BYTES) {
    return failure(
      'DOWNLOAD_TOO_LARGE',
      `“${record.name}” is ${describeSize(record.size)}; files over ${describeSize(MAX_ATTACH_BYTES)} cannot be attached to a page.`,
    );
  }
  return success({
    name: record.name,
    mime: record.mime || 'application/octet-stream',
    content: readFileSync(record.savedTo).toString('base64'),
  });
}

/**
 * page.attachFile takes a stored file by fileId, which the extension resolves, or a captured
 * download by downloadId, whose bytes only exist on this side. Filling them in here keeps
 * download-then-upload working without the agent ever holding the file.
 *
 * The stripping is the load-bearing half. `name`, `mime` and `content` are internal fields
 * one of the two stores writes, and a caller that supplies its own would be uploading bytes
 * it composed rather than a file the user vouched for — under an approval prompt that says
 * otherwise. So they are dropped here, on the trusted side of the socket, every time.
 */
export function resolveAttachment(action: string, input: unknown): ActionResult<unknown> {
  if (action !== 'page.attachFile') return { ok: true, data: input };
  const { name: _name, mime: _mime, content: _content, ...args } = (input ?? {}) as Record<string, unknown>;
  if (typeof args.downloadId !== 'string' || !args.downloadId) return { ok: true, data: args };
  if (typeof args.fileId === 'string' && args.fileId) {
    return failure('INVALID_INPUT', 'Give either "fileId" or "downloadId", not both.');
  }
  const bytes = readDownloadBytes(args.downloadId);
  return bytes.ok ? { ok: true, data: { ...args, ...bytes.data } } : bytes;
}

/** Downloads are bigger than screenshots and accumulate the same way, so they expire. */
export function sweepDownloads(): number {
  const cutoff = Date.now() - ttlDays() * 24 * 60 * 60 * 1000;
  const records = readIndex();
  const keep = records.filter((record) => {
    if (!existsSync(record.savedTo)) return false;
    if (Date.parse(record.capturedAt) >= cutoff) return true;
    discard(record.savedTo);
    return false;
  });
  if (keep.length !== records.length) writeIndex(keep);
  return records.length - keep.length;
}

export function clearDownloads(): number {
  const records = readIndex();
  for (const record of records) discard(record.savedTo);
  writeIndex([]);
  try {
    rmSync(downloadDir(), { recursive: true, force: true });
  } catch {}
  return records.length;
}

export function storedDownloads(): DownloadRecord[] {
  return readIndex().filter((record) => existsSync(record.savedTo));
}

function ttlDays(): number {
  const configured = readAgentConfig().downloadTtlDays;
  return typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? configured
    : DOWNLOAD_TTL_DAYS;
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-ndjson))/;
const HEAD_BYTES = 64 * 1024;

/**
 * What the agent is told, derived from the file rather than from a model: enough to know
 * what it captured and hand it on, and nothing that carries the file's contents.
 */
function notesFor(path: string, name: string, mime: string, size: number): string {
  const extension = extensionOf(name);
  const kind = mime || `${extension || 'unknown'} file`;
  const textual = TEXT_TYPES.test(mime) || extension === 'csv' || extension === 'tsv';
  const shape = textual ? textShape(path, extension === 'csv' || mime === 'text/csv') : null;
  return [`${kind}, ${describeSize(size)}`, shape].filter(Boolean).join(' — ');
}

function textShape(path: string, tabular: boolean): string | null {
  try {
    const head = readFileSync(path).subarray(0, HEAD_BYTES).toString('utf8');
    const lines = head.split('\n').filter((line) => line.trim().length > 0);
    if (!lines.length) return 'empty';
    if (!tabular) return `${lines.length} lines`;
    return `${lines.length} rows × ${lines[0].split(',').length} columns`;
  } catch {
    return null;
  }
}

function safeName(name: string): string {
  const cleaned = basename(name).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned || 'download';
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
