import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clearLockfile, isRunning, readLockfile, type Lockfile } from './lockfile';
import { log } from './log';
import { daemonPorts } from './ports';

const SPAWN_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 150;

export async function ensureDaemon(): Promise<Lockfile> {
  const existing = await probeExisting();
  if (existing) return existing;

  log('no daemon reachable; spawning one');
  const daemonMain = join(dirname(fileURLToPath(import.meta.url)), 'daemon-main.js');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.BROWSENTIC_AGENT_RUN;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const child = spawn(process.execPath, [daemonMain], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();

  const deadline = Date.now() + SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    const started = await probeExisting();
    if (started) return started;
  }
  throw new Error(`The Browsentic daemon did not come up within ${SPAWN_TIMEOUT_MS}ms — see the log with "browsentic-mcp logs"`);
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

/** SIGTERM every daemon, then SIGKILL whatever is still standing, and drop the lockfile. */
export async function stopDaemons(graceMs = 5_000): Promise<StopResult> {
  const daemons = await runningDaemons();
  for (const { pid } of daemons) kill(pid, 'SIGTERM');

  const remaining = await waitForExit(daemons, graceMs);
  for (const { pid } of remaining) kill(pid, 'SIGKILL');
  const stubborn = await waitForExit(remaining, 2_000);

  clearLockfile();
  return { stopped: daemons.filter((daemon) => !stubborn.includes(daemon)), stubborn };
}

function kill(pid: number, signal: NodeJS.Signals): void {
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
