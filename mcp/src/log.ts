import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { logPath, stateDir } from './lockfile';

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Daemon logging. Never write to stdout from the CLI process — stdout is the MCP
 * JSON-RPC stream, and a stray line corrupts the session.
 */
export function log(message: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} ${message}${detail === undefined ? '' : ` ${format(detail)}`}\n`;
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    rotateIfLarge();
    appendFileSync(logPath, line);
  } catch {
    // Logging must never take the daemon down.
  }
  if (process.env.VOICELINK_DEBUG) process.stderr.write(line);
}

function rotateIfLarge(): void {
  try {
    if (statSync(logPath).size > MAX_BYTES) renameSync(logPath, `${logPath}.1`);
  } catch {
    // No log file yet.
  }
}

function format(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`;
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}
