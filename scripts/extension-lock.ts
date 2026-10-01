import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const LOCK = 'src/extension/store-lock.json';

interface Lock {
  version: string;
  why: string;
  files: Record<string, string>;
}

const [command = 'check', build = 'dist/chrome-mv3'] = process.argv.slice(2);

function filesOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** The manifest's version is left out, so a Bridge-only release can relabel the same build. */
function contentOf(path: string): Buffer {
  const bytes = readFileSync(join(build, path));
  if (path !== 'manifest.json') return bytes;
  const { version: _version, ...rest } = JSON.parse(bytes.toString('utf8'));
  return Buffer.from(JSON.stringify(rest));
}

function hashesOf(): Record<string, string> {
  return Object.fromEntries(filesOf(build).map((path) => [path, createHash('sha256').update(contentOf(path)).digest('hex')]));
}

function write(): void {
  const { version } = JSON.parse(readFileSync(join(build, 'manifest.json'), 'utf8')) as { version: string };
  const lock: Lock = {
    version,
    why: `The Chrome Web Store and Edge Add-ons are reviewing this build of v${version}. Until they publish it, a change that alters the built extension waits for the next store submission; the Bridge, the CLI and the apps can change freely.`,
    files: hashesOf(),
  };
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`Locked ${Object.keys(lock.files).length} files of the v${version} store build in ${LOCK}.`);
}

function check(): void {
  const lock = JSON.parse(readFileSync(LOCK, 'utf8')) as Lock;
  const built = hashesOf();
  const paths = [...new Set([...Object.keys(lock.files), ...Object.keys(built)])].sort();
  const drift = paths.flatMap((path) => {
    if (!(path in built)) return [`  missing  ${path}`];
    if (!(path in lock.files)) return [`  added    ${path}`];
    return lock.files[path] === built[path] ? [] : [`  changed  ${path}`];
  });
  if (drift.length === 0) {
    console.log(`${build} is the v${lock.version} store build, file for file.`);
    return;
  }
  console.error(
    [
      `${build} is not the v${lock.version} build the stores have:`,
      ...drift,
      '',
      lock.why,
      `To submit a new store build on purpose: yarn build, then node scripts/extension-lock.ts write, and upload that zip to both stores.`,
    ].join('\n'),
  );
  process.exit(1);
}

if (command === 'write') write();
else if (command === 'check') check();
else {
  console.error('usage: node scripts/extension-lock.ts [check|write] [build dir, default dist/chrome-mv3]');
  process.exit(1);
}
