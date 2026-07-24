import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const stateDir = process.env.VOICELINK_HOME ?? join(homedir(), '.voicelink');
export const lockfilePath = join(stateDir, 'daemon.json');
export const logPath = join(stateDir, 'daemon.log');

export interface Lockfile {
  pid: number;
  port: number;
  /** Bearer token for control clients (the CLI). Never leaves the filesystem. */
  token: string;
  protocolVersion: number;
  daemonVersion: string;
}

export function readLockfile(): Lockfile | null {
  try {
    const lock = JSON.parse(readFileSync(lockfilePath, 'utf8')) as Lockfile;
    return typeof lock?.port === 'number' && typeof lock?.token === 'string' ? lock : null;
  } catch {
    return null;
  }
}

export function writeLockfile(lock: Lockfile): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(lockfilePath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync only applies `mode` when creating; re-assert it for pre-existing files.
  chmodSync(lockfilePath, 0o600);
}

export function clearLockfile(): void {
  rmSync(lockfilePath, { force: true });
}

/** True when a process with this pid exists and we may signal it. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
