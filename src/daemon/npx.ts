import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The installed package, whatever tree it landed in. The bundle sits one level down, in dist/. */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type InstallKind = 'npx' | 'global' | 'repo' | 'app';

/** Written beside the payload by Browsentic.app when it lays the CLI down in ~/.browsentic/cli. */
export const APP_MARKER = '.browsentic-app.json';

const inNpxCache = (path: string) => path.split(sep).includes('_npx');

/**
 * How this CLI got here, which decides how it can replace itself and whether a throwaway
 * cache is what is pinning an old version in place.
 */
export function installKind(): InstallKind {
  if (inNpxCache(packageRoot)) return 'npx';
  if (existsSync(join(packageRoot, APP_MARKER))) return 'app';
  // A build config the `files` allowlist never ships. Checking for the extension payload
  // instead would misread a checkout that still has src/daemon/extension/ staged from a
  // previous `npm pack`, which is the normal state of a maintainer's tree.
  if (existsSync(join(packageRoot, 'tsup.config.ts'))) return 'repo';
  return 'global';
}

export interface NpxEntry {
  dir: string;
  /** The version of browsentic sitting in it, when its package.json can be read. */
  version: string | null;
  /** What the user asked for, e.g. `browsentic@latest`. npm keys the directory on this. */
  packages: string[];
  /** True for the entry this very process is running out of. */
  running: boolean;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function cacheRoots(): string[] {
  const roots = [
    process.env.npm_config_cache,
    process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? homedir(), 'npm-cache') : null,
    join(homedir(), '.npm'),
  ].filter((root): root is string => !!root);
  return [...new Set(roots.map((root) => join(root, '_npx')))];
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Every throwaway npx install holding a copy of this package.
 *
 * This is the whole reason `npx browsentic setup` can keep installing a months-old extension:
 * npm names the directory after the spec it was asked for, writes the version it resolved
 * *that first time* into it as a caret range, and every later `npx browsentic` satisfies
 * itself from that without consulting the registry again. Deleting the directory is the only
 * thing that makes npm look a second time.
 */
export function npxEntries(): NpxEntry[] {
  const own = inNpxCache(packageRoot) ? real(resolve(packageRoot, '..', '..')) : null;
  const scanned = cacheRoots().flatMap((root) => {
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => real(join(root, entry.name)));
    } catch {
      return [];
    }
  });

  const entries = new Map<string, NpxEntry>();
  for (const dir of [...scanned, ...(own ? [own] : [])]) {
    if (entries.has(dir)) continue;
    const manifest = readJson(join(dir, 'node_modules', 'browsentic', 'package.json'));
    if (!manifest) continue;
    const requested = readJson(join(dir, 'package.json'))?._npx as { packages?: unknown } | undefined;
    entries.set(dir, {
      dir,
      version: typeof manifest.version === 'string' ? manifest.version : null,
      packages: Array.isArray(requested?.packages) ? (requested.packages as string[]) : [],
      running: dir === own,
    });
  }
  return [...entries.values()];
}

/**
 * The spec this process was launched with, when it is an npx run — `browsentic@latest` for a
 * bare `npx browsentic`, or an exact version when the user pinned one. A pin is a decision,
 * not a stale cache, so nothing may upgrade past it.
 */
export function pinnedVersion(): string | null {
  const own = npxEntries().find((entry) => entry.running);
  const spec = own?.packages.find((name) => name === 'browsentic' || name.startsWith('browsentic@'));
  const requested = spec?.slice('browsentic@'.length);
  return requested && /^\d+\.\d+\.\d+/.test(requested) ? requested : null;
}
