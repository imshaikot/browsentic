import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { takeStartLock } from './ensure-daemon';
import { stateDir } from './lockfile';

const lock = join(stateDir, 'daemon.start.lock');

describe('the start lock', () => {
  let release: (() => void) | null = null;

  afterEach(() => release?.());

  it('lets one starter spawn and keeps every other one waiting for it', () => {
    release = takeStartLock();

    expect(release).toBeTypeOf('function');
    expect(takeStartLock()).toBeNull();
  });

  it('is free again once released', () => {
    takeStartLock()!();

    release = takeStartLock();
    expect(release).toBeTypeOf('function');
  });

  it('breaks a lock its holder died with', () => {
    writeFileSync(lock, `999999999 ${Date.now()}\n`);

    release = takeStartLock();
    expect(release).toBeTypeOf('function');
  });

  it('breaks a lock held far longer than any start takes', () => {
    writeFileSync(lock, `${process.pid} ${Date.now() - 60_000}\n`);

    release = takeStartLock();
    expect(release).toBeTypeOf('function');
    release!();
    release = null;
    expect(existsSync(lock)).toBe(false);
  });
});
