import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { configPath } from './agent/config';
import { stateDir } from './lockfile';
import { userDir } from './paths';
import { planUninstall, purgeNpxCache, removeAll } from './uninstall';

const npxEntry = (root: string, key: string, version: string) => {
  const dir = join(root, key);
  mkdirSync(join(dir, 'node_modules', 'browsentic'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ _npx: { packages: ['browsentic@latest'] } }));
  writeFileSync(join(dir, 'node_modules', 'browsentic', 'package.json'), JSON.stringify({ name: 'browsentic', version }));
  return dir;
};

const configure = (value: Record<string, unknown>) => writeFileSync(configPath, JSON.stringify(value));
const made = (...paths: string[]) => {
  for (const path of paths) mkdirSync(path, { recursive: true });
};
const outside = join(homedir(), 'Elsewhere');

beforeEach(() => {
  vi.stubEnv('npm_config_cache', join(stateDir, 'npm-cache'));
  for (const dir of [stateDir, userDir, outside, join(homedir(), '.npm')]) rmSync(dir, { recursive: true, force: true });
  made(stateDir, join(userDir, 'skills'), join(userDir, 'extension', 'chrome-mv3'));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('planning an uninstall', () => {
  test('by default it is the private state and the visible files, the extension among them', () => {
    expect(planUninstall()).toEqual({
      removals: [
        { label: 'state', path: stateDir, holds: 'pairing keys, config, approvals, logs', keep: undefined },
        { label: 'files', path: userDir, holds: 'the extension, skills, site maps, screenshots, captured downloads', keep: undefined },
      ],
      elsewhere: [],
      npx: [],
    });
  });

  test('an extension installed somewhere else with setup --dir is removed too', () => {
    made(join(outside, 'browsentic-ext'));
    configure({ extensionDir: join(outside, 'browsentic-ext') });
    expect(planUninstall().removals[0]).toEqual({ label: 'extension', path: join(outside, 'browsentic-ext'), holds: 'the unpacked build Chrome loads' });
  });

  test('keeping skills keeps them in both places', () => {
    expect(planUninstall({ keepSkills: true }).removals.map((removal) => removal.keep)).toEqual([['skills'], ['skills']]);
  });

  test('folders the user configured outside both roots are named, never deleted', () => {
    made(join(outside, 'skills'), join(outside, 'shots'));
    configure({ skillsDir: join(outside, 'skills'), screenshotDir: join(outside, 'shots'), downloadDir: join(userDir, 'downloads') });
    expect(planUninstall().elsewhere).toEqual([
      { label: 'skills', path: join(outside, 'skills'), holds: 'site maps and uploaded skills' },
      { label: 'screenshots', path: join(outside, 'shots'), holds: 'captures taken with save: true' },
    ]);
  });

  test('a configured folder that does not exist is not mentioned', () => {
    configure({ screenshotDir: join(outside, 'never-made') });
    expect(planUninstall().elsewhere).toEqual([]);
  });

  test('npx caches holding a copy are included', () => {
    const dir = npxEntry(join(homedir(), '.npm', '_npx'), 'f6', '0.6.0');
    expect(planUninstall().npx).toEqual([{ dir, version: '0.6.0', packages: ['browsentic@latest'], running: false }]);
  });

  test('with nothing installed there is nothing to remove', () => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
    expect(planUninstall().removals).toEqual([]);
  });
});

describe('removing', () => {
  test('everything planned goes', () => {
    const outcomes = removeAll(planUninstall().removals);
    expect([outcomes.map((outcome) => [outcome.removal.label, outcome.removed, outcome.kept]), existsSync(stateDir), existsSync(userDir)]).toEqual([
      [
        ['state', true, []],
        ['files', true, []],
      ],
      false,
      false,
    ]);
  });

  test('keeping skills empties each folder around them and says what was left', () => {
    writeFileSync(join(userDir, 'skills', 'mine.md'), 'Mine.');
    const [, files] = removeAll(planUninstall({ keepSkills: true }).removals);
    expect([files.kept, readdirSync(userDir), existsSync(join(userDir, 'skills', 'mine.md'))]).toEqual([['skills'], ['skills'], true]);
  });

  test('a folder with nothing to keep is removed outright', () => {
    removeAll(planUninstall({ keepSkills: true }).removals);
    expect(existsSync(stateDir)).toBe(false);
  });

  test('a removal that fails is reported, not thrown, and the rest still happen', () => {
    made(outside);
    writeFileSync(join(outside, 'not-a-folder'), '');
    const [failed, removed] = removeAll([
      { label: 'odd', path: join(outside, 'not-a-folder'), holds: '', keep: ['skills'] },
      { label: 'state', path: stateDir, holds: '' },
    ]);
    expect([failed.removed, failed.error, removed.removed]).toEqual([false, expect.stringContaining('ENOTDIR'), true]);
  });
});

describe('purging npx caches', () => {
  test('each cache is deleted, and each outcome reported', () => {
    const dir = npxEntry(join(homedir(), '.npm', '_npx'), 'g7', '0.6.0');
    const [purged] = purgeNpxCache(planUninstall().npx);
    expect([purged.removed, existsSync(dir)]).toEqual([true, false]);
  });

  test('a cache that cannot be deleted is reported rather than stopping the uninstall', () => {
    const root = join(homedir(), '.npm', '_npx');
    const dir = npxEntry(root, 'h8', '0.6.0');
    chmodSync(root, 0o555);
    try {
      const [purged] = purgeNpxCache(planUninstall().npx);
      expect([purged.removed, typeof purged.error, existsSync(dir)]).toEqual([false, 'string', true]);
    } finally {
      chmodSync(root, 0o755);
    }
  });
});
