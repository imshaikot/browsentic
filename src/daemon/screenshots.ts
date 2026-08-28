import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { readAgentConfig } from './agent/config';
import { uploadedSkillsDir } from './agent/skills';

export function saveScreenshot(dataUrl: string, opts: { filename?: string; dir?: string } = {}): string {
  const { mime, bytes } = parseDataUrl(dataUrl);
  const dir = opts.dir ? containedSkillDir(opts.dir) : resolveDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const ext = extensionFor(mime);
  const name = opts.filename ? sanitize(opts.filename, ext) : `screenshot-${stamp()}-${randomBytes(3).toString('hex')}.${ext}`;
  const target = join(dir, name);
  writeFileSync(target, bytes, { mode: 0o600 });
  chmodSync(target, 0o600);
  return target;
}

function containedSkillDir(dir: string): string {
  const root = resolve(uploadedSkillsDir());
  const target = resolve(dir);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`refusing to write a screenshot outside ${root}`);
  }
  return target;
}

function resolveDir(): string {
  const configured = readAgentConfig().screenshotDir;
  if (typeof configured === 'string' && configured.trim()) return expandHome(configured.trim());
  return join(homedir(), 'browsentic', 'screenshot');
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : join(homedir(), p);
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('screenshot result was not a base64 data URL');
  return { mime: match[1], bytes: Buffer.from(match[2], 'base64') };
}

function extensionFor(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function sanitize(filename: string, ext: string): string {
  let name = basename(filename).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  if (!name) name = `screenshot-${stamp()}`;
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
