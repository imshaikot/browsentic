import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { installStampPath, packagedExtension, type InstallStamp } from './paths.js';

export interface InstallResult {
  dir: string;
  version: string;
  source: 'package' | 'repo';
  files: number;
  changed: number;
  alreadyCurrent: boolean;
}

/** Every file under `dir`, as paths relative to it. */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [relative(base, full)];
  });
}

const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

function sameContent(a: string, b: string): boolean {
  try {
    if (statSync(a).size !== statSync(b).size) return false;
    return hash(a) === hash(b);
  } catch {
    return false;
  }
}

export function readStamp(dir: string): InstallStamp | null {
  try {
    return JSON.parse(readFileSync(installStampPath(dir), 'utf8')) as InstallStamp;
  } catch {
    return null;
  }
}

export class InstallError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}

/**
 * Copy the packaged extension into `dir`, replacing files one at a time.
 *
 * Not a directory swap. Renaming the old tree aside leaves the path briefly non-existent, and
 * a browser that starts in that window disables the extension and drops it from the profile,
 * forcing the user through "Load unpacked" again. Renaming over a *file* is atomic on every
 * platform and stays safe while another process holds the old inode open, which gives the same
 * guarantee at the granularity that actually matters.
 */
export function install(dir: string, force = false): InstallResult {
  const packaged = packagedExtension();
  if (!packaged) {
    throw new InstallError(
      'this build carries no extension payload',
      'Reinstall with `npm i -g browsentic`, or run `yarn build` if you are in a source checkout.',
    );
  }

  const manifestPath = join(packaged.dir, 'manifest.json');
  const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version as string;

  const stamp = readStamp(dir);
  if (!force && stamp?.version === version && existsSync(manifestPath)) {
    return {
      dir,
      version,
      source: packaged.source,
      files: stamp.files,
      changed: 0,
      alreadyCurrent: true,
    };
  }

  const sources = walk(packaged.dir);
  mkdirSync(dir, { recursive: true, mode: 0o755 });

  // Leftovers from a run that died mid-copy.
  for (const stale of walk(dir).filter((f) => /\.tmp-\d+$/.test(f))) {
    rmSync(join(dir, stale), { force: true });
  }

  // The manifest goes last. If this dies partway through, the old manifest is left pointing at
  // a superset of the files present, which a browser loads without complaint. The reverse (a
  // new manifest naming files that are not there yet) is a broken extension.
  const ordered = [...sources.filter((f) => f !== 'manifest.json'), 'manifest.json'];

  let changed = 0;
  for (const rel of ordered) {
    const from = join(packaged.dir, rel);
    const to = join(dir, rel);
    if (!force && sameContent(from, to)) continue;

    mkdirSync(join(to, '..'), { recursive: true, mode: 0o755 });
    const tmp = `${to}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, readFileSync(from), { mode: 0o644 });
      chmodSync(tmp, 0o644);
      renameSync(tmp, to);
      changed++;
    } catch (error) {
      rmSync(tmp, { force: true });
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
        throw new InstallError(
          `the browser is holding ${rel} open`,
          'Disable the Browsentic card at chrome://extensions (or quit the browser), then run `browsentic update` again.',
        );
      }
      throw error;
    }
  }

  // Anything the new build dropped. After the manifest, for the same reason.
  const wanted = new Set(sources);
  for (const rel of walk(dir)) {
    if (wanted.has(rel) || rel === '.browsentic-install.json') continue;
    rmSync(join(dir, rel), { force: true });
  }

  const record: InstallStamp = {
    version,
    installedAt: new Date().toISOString(),
    source: packaged.source,
    files: sources.length,
  };
  writeFileSync(installStampPath(dir), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });

  return { dir, version, source: packaged.source, files: sources.length, changed, alreadyCurrent: false };
}
