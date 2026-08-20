import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../log';
import type { AgentSettings } from '../config';

const RUN_DIR_TTL_MS = 24 * 60 * 60_000;

/** Concurrent runs each get their own workspace; yesterday's are nobody's. */
export function sweepRunDirs(base: string, ttlMs = RUN_DIR_TTL_MS): void {
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return;
  }
  const cutoff = Date.now() - ttlMs;
  for (const entry of entries) {
    const path = join(base, entry);
    try {
      if (statSync(path).mtimeMs < cutoff) rmSync(path, { recursive: true, force: true });
    } catch {
      continue;
    }
  }
}

/** Drops a reasoning-effort name the CLI would reject rather than letting it fail the run. */
export function effortOf(settings: AgentSettings, accepted: string[]): string | undefined {
  const effort = settings.effort;
  if (!effort) return undefined;
  if (accepted.includes(effort)) return effort;
  log(`ignoring effort "${effort}" — accepted values are ${accepted.join(', ')}`);
  return undefined;
}

export function parseJsonLine<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

/** Pulls the outermost JSON object out of text a CLI may have wrapped in prose. */
export function parseJsonBlob<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
