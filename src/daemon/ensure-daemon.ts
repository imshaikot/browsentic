import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DAEMON_PORTS } from '@/lib/actions/protocol';
import { isRunning, readLockfile, type Lockfile } from './lockfile';
import { log } from './log';

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
  for (const port of DAEMON_PORTS) {
    if (port === lock?.port) continue;
    const pid = await healthyPid(port);
    if (pid === null) continue;
    const current = readLockfile();
    if (current?.pid === pid) return current;
  }
  return null;
}

async function healthyPid(port: number): Promise<number | null> {
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
