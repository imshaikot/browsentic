import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clearLockfile, holdWake, isRunning, readLockfile, stateDir, type Lockfile } from './lockfile';
import { log } from './log';
import { daemonPorts } from './ports';
import { runBridgeTask } from './windows-task';

const SPAWN_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 150;
const START_LOCK = join(stateDir, 'daemon.start.lock');
const STALE_START_MS = SPAWN_TIMEOUT_MS * 2;

export const daemonMainPath = () => join(dirname(fileURLToPath(import.meta.url)), 'daemon-main.js');

export interface EnsureOptions {
  /** Start it through Task Scheduler: the caller runs in a job that dies with it (Firefox's native host on Windows). */
  outsideJob?: boolean;
}

/**
 * Several browsers wake the Bridge at once when the computer starts, and each would spawn its own on
 * the next free port. Whoever holds the start lock spawns; everyone else waits for the one it starts.
 */
export async function ensureDaemon(options: EnsureOptions = {}): Promise<Lockfile> {
  const deadline = Date.now() + SPAWN_TIMEOUT_MS * 2;
  for (;;) {
    const existing = await probeExisting();
    if (existing) return existing;
    const release = takeStartLock();
    if (release) {
      try {
        return (await probeExisting()) ?? (await spawnDaemon(options));
      } finally {
        release();
      }
    }
    if (Date.now() > deadline) throw new Error('Another Browsentic Bridge was starting and never came up — see "browsentic logs"');
    await delay(POLL_INTERVAL_MS);
  }
}

export function takeStartLock(retry = true): (() => void) | null {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(START_LOCK, `${process.pid} ${Date.now()}\n`, { flag: 'wx', mode: 0o600 });
    return () => rmSync(START_LOCK, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return () => undefined;
  }
  const [pid, at] = readStartLock();
  if (retry && (!isRunning(pid) || Date.now() - at > STALE_START_MS)) {
    rmSync(START_LOCK, { force: true });
    return takeStartLock(false);
  }
  return null;
}

function readStartLock(): [number, number] {
  try {
    const [pid, at] = readFileSync(START_LOCK, 'utf8').trim().split(' ').map(Number);
    return [pid || 0, at || 0];
  } catch {
    return [0, 0];
  }
}

/** One the task started is waited for, never doubled by one spawned in the job that is about to die. */
async function spawnDaemon({ outsideJob = false }: EnsureOptions): Promise<Lockfile> {
  if (outsideJob && process.platform === 'win32' && runBridgeTask()) {
    log('no daemon reachable; starting one through Task Scheduler');
    return cameUp();
  }
  log('no daemon reachable; spawning one');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.BROWSENTIC_AGENT_RUN;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.NODE_NO_WARNINGS;
  const child = spawn(process.execPath, [daemonMainPath()], {
    detached: true,
    stdio: 'ignore',
    env,
    windowsHide: true,
  });
  child.unref();
  return cameUp();
}

async function cameUp(): Promise<Lockfile> {
  const started = await waitForDaemon(SPAWN_TIMEOUT_MS);
  if (started) return started;
  throw new Error(`The Browsentic daemon did not come up within ${SPAWN_TIMEOUT_MS}ms — see the log with "browsentic logs"`);
}

async function waitForDaemon(timeoutMs: number): Promise<Lockfile | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    const started = await probeExisting();
    if (started) return started;
  }
  return null;
}

export async function probeExisting(): Promise<Lockfile | null> {
  const lock = readLockfile();
  if (lock && isRunning(lock.pid) && (await healthyPid(lock.port)) === lock.pid) return lock;

  // The control token is minted per daemon, so a daemon found on another port is only reachable
  // through the lockfile it wrote itself — which its pid identifies.
  for (const port of daemonPorts) {
    if (port === lock?.port) continue;
    const pid = await healthyPid(port);
    if (pid === null) continue;
    const current = readLockfile();
    if (current?.pid === pid) return current;
  }
  return null;
}

export interface RunningDaemon {
  pid: number;
  port: number;
}

/**
 * Every daemon actually answering on a Browsentic port.
 *
 * Discovered by probe rather than from the lockfile, because the failure this is here for is a
 * daemon whose lockfile is gone — deleted by hand, or by an uninstall that ran in the wrong
 * order. Such a daemon holds its port and keeps serving forever, and nothing that reads
 * ~/.browsentic can see it. Probing also rules out killing an unrelated process that inherited
 * a recorded pid.
 */
export async function runningDaemons(): Promise<RunningDaemon[]> {
  const found = new Map<number, number>();
  for (const port of daemonPorts) {
    const pid = await healthyPid(port);
    if (pid !== null && !found.has(pid)) found.set(pid, port);
  }
  return [...found].map(([pid, port]) => ({ pid, port }));
}

export interface StopResult {
  stopped: RunningDaemon[];
  stubborn: RunningDaemon[];
}

/**
 * SIGTERM every daemon, then SIGKILL whatever is still standing, and drop the lockfile. Windows has no
 * SIGTERM to catch — a kill there ends the daemon alone, and the agent CLIs it started run on — so each
 * one is ended there with everything it started.
 */
export async function stopDaemons(graceMs = 5_000): Promise<StopResult> {
  holdWake();
  const daemons = await runningDaemons();
  for (const { pid } of daemons) kill(pid, 'SIGTERM');

  const remaining = await waitForExit(daemons, graceMs);
  for (const { pid } of remaining) kill(pid, 'SIGKILL');
  const stubborn = await waitForExit(remaining, 2_000);

  clearLockfile();
  return { stopped: daemons.filter((daemon) => !stubborn.includes(daemon)), stubborn };
}

function kill(pid: number, signal: NodeJS.Signals): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Already gone, or ours to signal no longer. Either way the wait below settles it.
  }
}

async function waitForExit(daemons: RunningDaemon[], timeoutMs: number): Promise<RunningDaemon[]> {
  const deadline = Date.now() + timeoutMs;
  let alive = daemons.filter((daemon) => isRunning(daemon.pid));
  while (alive.length && Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    alive = alive.filter((daemon) => isRunning(daemon.pid));
  }
  return alive;
}

export async function healthyPid(port: number): Promise<number | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return null;
    const health = (await response.json()) as { pid?: unknown };
    return typeof health.pid === 'number' ? health.pid : null;
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
