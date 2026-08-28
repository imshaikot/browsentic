import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The private half: lockfile, pairing keys, config, approvals, logs. Mode 0700 throughout,
 * and relocatable, because tests and sandboxes need somewhere else to put it.
 */
export const stateDir = process.env.BROWSENTIC_HOME ?? join(homedir(), '.browsentic');

/**
 * The visible half: skills, recordings, screenshots, and the unpacked extension. Things you
 * are meant to open, read and edit. Deliberately NOT relocatable by BROWSENTIC_HOME.
 */
export const userDir = join(homedir(), 'browsentic');

/**
 * Where `browsentic setup` installs the extension for the browser to load.
 *
 * Two properties of this path are load-bearing, and both are easy to break:
 *
 *  - **It never carries a version.** Chrome derives an unpacked extension's ID from the
 *    absolute path of its directory, and the daemon binds each session key to the resulting
 *    `chrome-extension://<id>` origin. A versioned path would hand out a new identity on
 *    every update and silently unpair the browser.
 *  - **It does not live under stateDir.** stateDir moves with BROWSENTIC_HOME, which would
 *    make the extension ID hostage to an environment variable. It is also a dotfolder, and
 *    Chrome's "Load unpacked" dialog is the native folder picker, which hides those.
 */
export function extensionDir(override?: string): string {
  return override ?? join(userDir, 'extension', 'chrome-mv3');
}

/** Records what `install()` last wrote, so `status` can report installed-versus-loaded. */
export function installStampPath(dir: string): string {
  return join(dir, '.browsentic-install.json');
}

export interface InstallStamp {
  version: string;
  installedAt: string;
  source: 'package' | 'repo';
  files: number;
}

/**
 * The extension build this CLI ships or sits beside, in preference order:
 *
 *  1. `<pkg>/extension/chrome-mv3` — staged into the tarball at prepack time. This is what an
 *     `npm i` or `npx` install has, and it mirrors how bundled skills already resolve
 *     (see agent/skills.ts).
 *  2. `<repo>/dist/chrome-mv3` — a source checkout, i.e. `yarn mcp:link` or running
 *     `node mcp/dist/cli.js` directly.
 */
export function packagedExtension(): { dir: string; source: 'package' | 'repo' } | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    { dir: join(here, '..', 'extension', 'chrome-mv3'), source: 'package' as const },
    { dir: join(here, '..', '..', 'dist', 'chrome-mv3'), source: 'repo' as const },
  ];
  return candidates.find((c) => existsSync(join(c.dir, 'manifest.json'))) ?? null;
}
