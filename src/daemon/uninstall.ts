import { existsSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { readAgentConfig } from './agent/config';
import { uploadedSkillsDir } from './agent/skills';
import { downloadDir } from './downloads';
import { npxEntries, type NpxEntry } from './npx';
import { extensionDir, stateDir, userDir } from './paths';
import { screenshotDir } from './screenshots';

export interface Removal {
  label: string;
  path: string;
  holds: string;
  /** Paths under `path` to leave behind, relative to it. */
  keep?: string[];
}

export interface UninstallPlan {
  removals: Removal[];
  /** Configured directories outside the two roots. Named, never deleted — the user put them there. */
  elsewhere: Removal[];
  npx: NpxEntry[];
}

function contains(root: string, path: string): boolean {
  const inside = relative(root, path);
  return !inside.startsWith('..') && !isAbsolute(inside);
}

/**
 * What removing Browsentic means on this machine, resolved rather than assumed: an install can
 * have been pointed elsewhere with `setup --dir`, and skills, screenshots and downloads each
 * take a config override.
 */
export function planUninstall(options: { keepSkills?: boolean } = {}): UninstallPlan {
  const config = readAgentConfig();
  const extension = extensionDir(config.extensionDir);
  const roots = [stateDir, userDir];

  const removals: Removal[] = [];
  if (!roots.some((root) => contains(root, extension)) && existsSync(extension)) {
    removals.push({ label: 'extension', path: extension, holds: 'the unpacked build Chrome loads' });
  }
  removals.push({
    label: 'state',
    path: stateDir,
    holds: 'pairing keys, config, approvals, logs',
    keep: options.keepSkills ? ['skills'] : undefined,
  });
  removals.push({
    label: 'files',
    path: userDir,
    holds: 'the extension, skills, site maps, screenshots, captured downloads',
    keep: options.keepSkills ? ['skills'] : undefined,
  });

  const elsewhere: Removal[] = [];
  const outside = (label: string, path: string, holds: string) => {
    if (!roots.some((root) => contains(root, path)) && existsSync(path)) elsewhere.push({ label, path, holds });
  };
  outside('skills', uploadedSkillsDir(), 'site maps and uploaded skills');
  outside('screenshots', screenshotDir(), 'captures taken with save: true');
  outside('downloads', downloadDir(), 'files captured from pages');

  return {
    removals: removals.filter((removal) => existsSync(removal.path)),
    elsewhere,
    npx: npxEntries(),
  };
}

export interface RemovalOutcome {
  removal: Removal;
  removed: boolean;
  /** What was left behind, so the report can say "emptied" rather than claim a clean sweep. */
  kept: string[];
  error?: string;
}

export function removeAll(removals: Removal[]): RemovalOutcome[] {
  return removals.map((removal) => {
    try {
      const kept = removal.keep?.length ? keepingSome(removal.path, removal.keep) : [];
      if (!kept.length) rmSync(removal.path, { recursive: true, force: true });
      return { removal, removed: true, kept };
    } catch (error) {
      return { removal, removed: false, kept: [], error: (error as Error).message };
    }
  });
}

/** Empties `dir` apart from `keep`, and reports what survived — nothing means delete the lot. */
function keepingSome(dir: string, keep: string[]): string[] {
  const kept: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (keep.includes(entry)) kept.push(entry);
    else rmSync(join(dir, entry), { recursive: true, force: true });
  }
  return kept;
}

export interface CachePurge {
  entry: NpxEntry;
  removed: boolean;
  error?: string;
}

/**
 * Delete the npx caches, including the one this process is running out of.
 *
 * Self-deletion is deliberate and safe on POSIX: the CLI is a single bundled file that Node has
 * already read, and an unlinked inode stays readable to whoever holds it open. Windows can
 * refuse, which is why the failure is reported rather than thrown — the directory is a cache,
 * and a user who deletes it by hand loses nothing.
 */
export function purgeNpxCache(entries: NpxEntry[]): CachePurge[] {
  return entries.map((entry) => {
    try {
      rmSync(entry.dir, { recursive: true, force: true });
      return { entry, removed: true };
    } catch (error) {
      return { entry, removed: false, error: (error as Error).message };
    }
  });
}
