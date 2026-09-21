import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { install, InstallError, readStamp } from './install';
import { stateDir } from './lockfile';
import { extensionDir, installStampPath } from './paths';

// Only a built package or a source checkout carries the extension; the test builds a small one of its own.
const packaged = vi.hoisted(() => ({ current: null as { dir: string; source: 'package' | 'repo' } | null }));
vi.mock('./paths', async (importOriginal) => ({ ...(await importOriginal<typeof import('./paths')>()), packagedExtension: () => packaged.current }));

const build = join(stateDir, 'package', 'extension', 'chrome-mv3');
const target = extensionDir();

const put = (dir: string, files: Record<string, string>) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
};

const release = (version: string, files: Record<string, string> = {}) => {
  rmSync(build, { recursive: true, force: true });
  put(build, { 'manifest.json': JSON.stringify({ version }), 'background.js': 'bg v1', 'content.js': 'cs', 'icons/icon-16.png': 'png', ...files });
};

const installed = () =>
  readdirSync(target, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(target.length + 1))
    .sort();

beforeEach(() => {
  packaged.current = { dir: build, source: 'package' };
  rmSync(target, { recursive: true, force: true });
  release('1.2.0');
});

afterEach(() => {
  if (existsSync(target)) chmodSync(target, 0o755);
});

describe('installing the extension', () => {
  test('a first install copies every file, and records what it installed', () => {
    expect(install(target)).toEqual({ dir: target, version: '1.2.0', source: 'package', files: 4, changed: 4, alreadyCurrent: false });
    expect([installed(), readStamp(target)]).toEqual([
      ['.browsentic-install.json', 'background.js', 'content.js', 'icons/icon-16.png', 'manifest.json'],
      { version: '1.2.0', installedAt: expect.any(String), source: 'package', files: 4 },
    ]);
  });

  test('the files are readable by the browser', () => {
    install(target);
    expect(statSync(join(target, 'background.js')).mode & 0o777).toBe(0o644);
  });

  test('the same version again copies nothing', () => {
    install(target);
    expect(install(target)).toMatchObject({ changed: 0, alreadyCurrent: true, files: 4 });
  });

  test('forcing it copies everything again', () => {
    install(target);
    expect(install(target, true)).toMatchObject({ changed: 4, alreadyCurrent: false });
  });

  test('a new version replaces only what changed, and removes what the new build dropped', () => {
    install(target);
    release('1.3.0', { 'background.js': 'bg v2', 'popup.html': '<html>' });
    rmSync(join(build, 'icons'), { recursive: true });
    expect([install(target), installed(), readFileSync(join(target, 'background.js'), 'utf8')]).toEqual([
      { dir: target, version: '1.3.0', source: 'package', files: 4, changed: 3, alreadyCurrent: false },
      ['.browsentic-install.json', 'background.js', 'content.js', 'manifest.json', 'popup.html'],
      'bg v2',
    ]);
  });

  test('a copy left half-written by a run that died is cleared away', () => {
    put(target, { 'background.js.tmp-4242': 'partial' });
    install(target);
    expect(installed()).not.toContain('background.js.tmp-4242');
  });

  test('a file the browser will not let go of is explained, with what to do', () => {
    install(target);
    release('1.3.0', { 'background.js': 'bg v2' });
    chmodSync(target, 0o555);
    const error = (() => {
      try {
        install(target);
      } catch (thrown) {
        return thrown;
      }
    })();
    expect([error instanceof InstallError, (error as InstallError).message, (error as InstallError).hint]).toEqual([
      true,
      'the browser is holding background.js open',
      'Disable the Browsentic card at chrome://extensions (or quit the browser), then run `browsentic update` again.',
    ]);
  });

  test('a build with no extension in it says how to get one', () => {
    packaged.current = null;
    expect(() => install(target)).toThrow(
      expect.objectContaining({
        message: 'this build carries no extension payload',
        hint: 'Reinstall with `npm i -g browsentic`, or run `yarn build` if you are in a source checkout.',
      }),
    );
  });
});

describe('the install stamp', () => {
  test('is absent before anything was installed', () => {
    expect(readStamp(target)).toBeNull();
  });

  test('that cannot be read counts as absent', () => {
    put(target, { '.browsentic-install.json': '{"version": ' });
    expect([readStamp(target), existsSync(installStampPath(target))]).toEqual([null, true]);
  });
});
