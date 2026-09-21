import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearLockfile, isRunning, lockfilePath, readLockfile, stateDir, writeLockfile, type Lockfile } from './lockfile';
import { extensionDir, installStampPath, userDir } from './paths';

const lock: Lockfile = { pid: process.pid, port: 49_152, token: 'secret-token', protocolVersion: 9, daemonVersion: '0.6.2' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('where state lives', () => {
  const pathsWith = async (home: string | undefined) => {
    vi.resetModules();
    vi.stubEnv('BROWSENTIC_HOME', home);
    return import('./paths');
  };

  test('BROWSENTIC_HOME moves the private state', async () => {
    expect((await pathsWith('/tmp/elsewhere')).stateDir).toBe('/tmp/elsewhere');
  });

  test('without it, state is ~/.browsentic', async () => {
    expect((await pathsWith(undefined)).stateDir).toBe(join(homedir(), '.browsentic'));
  });

  // Chrome derives an unpacked extension's id from its path, so this one must not follow BROWSENTIC_HOME.
  test('the files you open, and the extension, stay in ~/browsentic wherever state goes', async () => {
    const paths = await pathsWith('/tmp/elsewhere');
    expect([paths.userDir, paths.extensionDir()]).toEqual([join(homedir(), 'browsentic'), join(homedir(), 'browsentic', 'extension', 'chrome-mv3')]);
  });

  test('setup --dir can put the extension somewhere else', () => {
    expect(extensionDir('/var/app/browsentic')).toBe('/var/app/browsentic');
  });

  test('the install stamp sits in the extension directory', () => {
    expect(installStampPath(join(userDir, 'extension'))).toBe(join(userDir, 'extension', '.browsentic-install.json'));
  });
});

describe('the lockfile', () => {
  beforeEach(() => {
    mkdirSync(stateDir, { recursive: true });
    clearLockfile();
  });

  test('what is written is what is read back', () => {
    writeLockfile(lock);
    expect(readLockfile()).toEqual(lock);
  });

  test('it holds the control token, so only the user can read it', () => {
    writeLockfile(lock);
    expect(statSync(lockfilePath).mode & 0o777).toBe(0o600);
  });

  test('no lockfile means no daemon', () => {
    expect(readLockfile()).toBeNull();
  });

  test('a lockfile without a port and token is no daemon either', () => {
    writeFileSync(lockfilePath, JSON.stringify({ pid: 1, port: '8765' }));
    expect(readLockfile()).toBeNull();
  });

  test('a lockfile that is not JSON is no daemon', () => {
    writeFileSync(lockfilePath, 'daemon.json');
    expect(readLockfile()).toBeNull();
  });
});

describe('whether a daemon is still running', () => {
  test('this process is', () => {
    expect(isRunning(process.pid)).toBe(true);
  });

  test('one that has exited is not', () => {
    const exited = spawnSync(process.execPath, ['-e', '']).pid;
    expect(isRunning(exited)).toBe(false);
  });
});
