import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stateDir } from './lockfile';
import { npxEntries } from './npx';

const npmCache = join(homedir(), '.npm', '_npx');
const configuredCache = join(stateDir, 'npm-cache');

/** An npx cache entry as npm leaves it: what was asked for, and the package it resolved. */
const npxEntry =(root: string, key: string, version: string | null, packages = ['browsentic@latest']) => {
  const dir = join(root, key);
  mkdirSync(join(dir, 'node_modules', 'browsentic'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ _npx: { packages } }));
  if (version) writeFileSync(join(dir, 'node_modules', 'browsentic', 'package.json'), JSON.stringify({ name: 'browsentic', version }));
  return dir;
};

beforeEach(() => {
  vi.stubEnv('npm_config_cache', configuredCache);
  rmSync(join(homedir(), '.npm'), { recursive: true, force: true });
  rmSync(configuredCache, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('npx caches holding browsentic', () => {
  test('are found in the configured npm cache and in ~/.npm, with the version each holds and what was asked for', () => {
    const configured = npxEntry(join(configuredCache, '_npx'), 'a1', '0.6.1', ['browsentic@0.6.1']);
    const home = npxEntry(npmCache, 'b2', '0.5.0');
    expect(npxEntries()).toEqual([
      { dir: configured, version: '0.6.1', packages: ['browsentic@0.6.1'], running: false },
      { dir: home, version: '0.5.0', packages: ['browsentic@latest'], running: false },
    ]);
  });

  test('an entry holding some other package is not ours', () => {
    mkdirSync(join(npmCache, 'c3', 'node_modules', 'cowsay'), { recursive: true });
    expect(npxEntries()).toEqual([]);
  });

  test('an entry whose version cannot be read is still listed, so it can still be cleared', () => {
    const dir = npxEntry(npmCache, 'd4', null);
    writeFileSync(join(dir, 'node_modules', 'browsentic', 'package.json'), '{"name": "browsentic"}');
    expect(npxEntries()).toEqual([{ dir, version: null, packages: ['browsentic@latest'], running: false }]);
  });

  test('the same entry reached twice is listed once', () => {
    const dir = npxEntry(npmCache, 'e5', '0.6.2');
    mkdirSync(join(configuredCache, '_npx'), { recursive: true });
    symlinkSync(dir, join(configuredCache, '_npx', 'e5'));
    expect(npxEntries().map((entry) => entry.dir)).toEqual([dir]);
  });

  test('with no npx cache there is nothing to find', () => {
    expect(npxEntries()).toEqual([]);
  });
});
