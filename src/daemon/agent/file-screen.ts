import { FILE_LIMITS, MAX_STORED_FILE_BYTES, type FileKind } from '@/lib/files/report';

export interface ScreenedFile {
  name: string;
  mime: string;
  /** What the browser measured; the bytes win when they arrived. */
  size: number;
}

export interface Reader {
  label: string;
  opens: readonly FileKind[];
  /** The agents that can open a kind this one cannot, to name in the rejection. */
  openers: (kind: FileKind) => string[];
}

export type Screening =
  | { ok: true; kind: FileKind; extension: string }
  | { ok: false; code: 'EMPTY' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_TYPE'; message: string; kind?: FileKind };

const SAMPLE_BYTES = 64 * 1024;

const KIND_NAMES: Record<FileKind, string> = { text: 'text', pdf: 'PDF', image: 'image' };
const KIND_PLURALS: Record<FileKind, string> = { text: 'text files', pdf: 'PDFs', image: 'images' };

export function screenFile(file: ScreenedFile, bytes: Buffer, reader: Reader): Screening {
  const size = Math.max(file.size, bytes.length);
  const name = `“${file.name}”`;
  if (size > MAX_STORED_FILE_BYTES) {
    return { ok: false, code: 'FILE_TOO_LARGE', message: `${name} is ${megabytes(size)}; files over ${megabytes(MAX_STORED_FILE_BYTES)} are not read.` };
  }
  if (bytes.length === 0) return { ok: false, code: 'EMPTY', message: `${name} is empty.` };

  const kind = kindOf(bytes);
  if (!kind) return { ok: false, code: 'UNSUPPORTED_TYPE', message: `${name} is ${describeBinary(bytes, file.mime)}. Browsentic reads text, PDF and image files.` };

  if (bytes.length > FILE_LIMITS[kind]) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      kind,
      message: `${name} is ${megabytes(bytes.length)}; ${KIND_NAMES[kind]} files over ${megabytes(FILE_LIMITS[kind])} are not read.`,
    };
  }

  if (!reader.opens.includes(kind)) {
    const openers = reader.openers(kind);
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      kind,
      message:
        `${reader.label} cannot open ${KIND_PLURALS[kind]} here.` +
        (openers.length ? ` Switch to ${openers.join(' or ')} to have it read.` : ''),
    };
  }
  return { ok: true, kind, extension: extensionOf(bytes, kind) };
}

/** The extension the bytes earn. An agent picks how to open a file by its name, so the name must not lie. */
export function extensionOf(bytes: Buffer, kind: FileKind): string {
  if (kind === 'text') return 'txt';
  if (kind === 'pdf') return 'pdf';
  if (startsWith(bytes, 'GIF8')) return 'gif';
  if (startsWith(bytes, 'RIFF')) return 'webp';
  return bytes[0] === 0xff ? 'jpg' : 'png';
}

const ZIP = 'PK\u0003\u0004';

export function kindOf(bytes: Buffer): FileKind | null {
  if (startsWith(bytes, '%PDF-')) return 'pdf';
  if (isImage(bytes)) return 'image';
  if (startsWith(bytes, ZIP)) return null;
  return isText(bytes) ? 'text' : null;
}

function isImage(bytes: Buffer): boolean {
  return (
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    startsWith(bytes, 'GIF87a') ||
    startsWith(bytes, 'GIF89a') ||
    (startsWith(bytes, 'RIFF') && bytes.subarray(8, 12).toString('latin1') === 'WEBP')
  );
}

function isText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, SAMPLE_BYTES);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
    return true;
  } catch {
    return false;
  }
}

function describeBinary(bytes: Buffer, mime: string): string {
  if (startsWith(bytes, ZIP)) return 'a ZIP archive (Word, Excel and PowerPoint files are ZIP archives too)';
  return `a binary file${mime ? ` (${mime})` : ''}`;
}

function startsWith(bytes: Buffer, prefix: string): boolean {
  return bytes.subarray(0, prefix.length).toString('latin1') === prefix;
}

function megabytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`;
}
