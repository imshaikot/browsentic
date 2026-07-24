import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DAEMON_PORTS } from '@/lib/actions/protocol';
import { isRunning, readLockfile, type Lockfile } from './lockfile';
import { log } from './log';

const SPAWN_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 150;

/** A live daemon, started if one was not already running. */
export async function ensureDaemon(): Promise<Lockfile> {
  const existing = await probeExisting();
  if (existing) return existing;

  log('no daemon reachable; spawning one');
  const daemonMain = join(dirname(fileURLToPath(import.meta.url)), 'daemon-main.js');
  const child = spawn(process.execPath, [daemonMain], {
    detached: true,
    // Inheriting stdio would tie the daemon's lifetime and output to this MCP session.
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    const started = await probeExisting();
    if (started) return started;
  }
  throw new Error(`The VoiceLink daemon did not come up within ${SPAWN_TIMEOUT_MS}ms — see the log with "voicelink-mcp logs"`);
}

/** The lockfile of a daemon that is actually answering, or null. */
export async function probeExisting(): Promise<Lockfile | null> {
  const lock = readLockfile();
  if (lock && isRunning(lock.pid) && (await isHealthy(lock.port))) return lock;

  // A stale lockfile (crash, or a daemon started under a different HOME) hides a live daemon;
  // the port range is small enough to just check it.
  for (const port of DAEMON_PORTS) {
    if (port !== lock?.port && (await isHealthy(port)) && lock) return { ...lock, port };
  }
  return null;
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
