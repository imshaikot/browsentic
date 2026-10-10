import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { stubCli } from '../agent/runners/fixtures/support';
import { adbCandidates, isProgram, locateAdb, startServer } from './adb';

const VERSION = readFileSync(new URL('./fixtures/adb-version.txt', import.meta.url), 'utf8');

describe('where adb is looked for', () => {
  test('macOS: the setting, PATH, the SDK variables, Android Studio\'s SDK, then Homebrew', () => {
    expect(
      adbCandidates({
        configured: '/custom/adb',
        platform: 'darwin',
        home: '/Users/me',
        env: { PATH: '/usr/bin:/bin', ANDROID_HOME: '/sdk', ANDROID_SDK_ROOT: '/old-sdk' },
      }),
    ).toEqual([
      '/custom/adb',
      '/usr/bin/adb',
      '/bin/adb',
      '/sdk/platform-tools/adb',
      '/old-sdk/platform-tools/adb',
      '/Users/me/Library/Android/sdk/platform-tools/adb',
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb',
    ]);
  });

  test('Windows: adb.exe on PATH however the variable is spelled, the SDK under LOCALAPPDATA, winget, Scoop, Chocolatey, then a zip unpacked in Downloads', () => {
    expect(
      adbCandidates({
        platform: 'win32',
        home: 'C:\\Users\\me',
        env: { Path: '"C:\\Tools";C:\\Windows', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', ProgramFiles: 'D:\\Programs' },
      }),
    ).toEqual([
      'C:\\Tools\\adb.exe',
      'C:\\Windows\\adb.exe',
      'C:\\Users\\me\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
      'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe',
      'D:\\Programs\\WinGet\\Packages\\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\\platform-tools\\adb.exe',
      'C:\\Users\\me\\scoop\\shims\\adb.exe',
      'C:\\ProgramData\\chocolatey\\bin\\adb.exe',
      'C:\\Users\\me\\Downloads\\platform-tools\\adb.exe',
      'C:\\Users\\me\\Downloads\\platform-tools-latest-windows\\platform-tools\\adb.exe',
    ]);
  });

  test('Linux: the SDK Android Studio makes in the home directory', () => {
    expect(adbCandidates({ platform: 'linux', home: '/home/me', env: {} })).toEqual([
      '/home/me/Android/Sdk/platform-tools/adb',
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb',
    ]);
  });

  test('a place named twice is tried once', () => {
    expect(adbCandidates({ platform: 'linux', home: '/h', env: { PATH: '/a:/a', ANDROID_HOME: '/h/Android/Sdk' } })).toEqual([
      '/a/adb',
      '/h/Android/Sdk/platform-tools/adb',
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb',
    ]);
  });
});

describe('finding adb', () => {
  const dir = mkdtempSync(join(tmpdir(), 'browsentic-adb-'));
  const fake = (name: string, script: string) => stubCli(join(dir, name), script);

  test('nothing anywhere is null', async () => {
    expect(await locateAdb({ platform: 'linux', home: dir, env: {} }, () => false)).toBeNull();
  });

  test('the first one that exists is run once for its version', async () => {
    const adb = fake('adb-good', `process.stdout.write(${JSON.stringify(VERSION)});`);
    expect(await locateAdb({ configured: adb, env: {} }, (path) => path === adb)).toEqual({ path: adb, version: '37.0.0-14910828' });
  });

  test('one that fails says how, in its own first line', async () => {
    const adb = fake('adb-broken', `process.stderr.write('dyld: Library not loaded\\nmore\\n'); process.exit(1);`);
    expect(await locateAdb({ configured: adb, env: {} }, (path) => path === adb)).toEqual({ path: adb, broken: 'dyld: Library not loaded' });
  });

  test.skipIf(process.platform === 'win32')('a directory or a file that cannot run is not a program', () => {
    expect(isProgram(dir)).toBe(false);
    expect(isProgram(new URL('./fixtures/adb-version.txt', import.meta.url).pathname)).toBe(false);
    expect(isProgram(fake('adb-runs', ''))).toBe(true);
  });

  // stubCli is a .cmd on Windows, which spawn refuses without a shell; a real adb is an .exe.
  test.skipIf(process.platform === 'win32')('start-server runs in adb\'s own folder, which the server it forks keeps as its working folder', async () => {
    const where = join(dir, 'start-server-cwd.txt');
    expect(await startServer(fake('adb-where', `require('node:fs').writeFileSync(${JSON.stringify(where)}, process.cwd());`))).toBe(true);
    expect(readFileSync(where, 'utf8')).toBe(realpathSync(dir));
  });

  test.skipIf(process.platform === 'win32')('start-server is judged by its exit, not by output a forked server could hold open', async () => {
    const forks = fake('adb-forks', `require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'inherit', detached: true }).unref();`);
    const started = Date.now();
    expect(await startServer(forks)).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(await startServer(fake('adb-refuses', 'process.exit(1);'))).toBe(false);
    expect(await startServer(join(dir, 'missing'))).toBe(false);
  }, 30_000);
});
