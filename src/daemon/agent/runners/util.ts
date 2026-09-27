import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS, type AgentKind } from '@/lib/agents/catalog';
import { log } from '../../log';
import type { AgentSettings } from '../config';

const RUN_DIR_TTL_MS = 24 * 60 * 60_000;

/**
 * How long a CLI should wait on one browser tool call before giving up on it. An approval card
 * waits on the user, page_awaitMonitor up to ten minutes, and a call the CLI abandons still runs
 * once the user answers — after the model has been told it failed.
 */
export const MCP_CALL_TIMEOUT_MS = 30 * 60_000;

/** What the user reads when the agent CLI started but the browser tools it was given did not. */
export const browserToolsDidNotStart = (label: string): string =>
  `${label} could not start Browsentic's browser tools, so this run could not reach the page. ` +
  'Run "browsentic restart", then send the message again.';

/** How to install an agent here. A line piped into a POSIX shell means nothing on Windows, so there it is the docs. */
export function installHint(kind: AgentKind, platform: NodeJS.Platform = process.platform): string {
  const { install, docs } = AGENTS[kind];
  return platform === 'win32' && /\|\s*(ba)?sh\b/.test(install) ? docs : install;
}

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

/**
 * One directory per conversation, for a CLI that reads its settings from the folder a run starts
 * in. The name is whatever identifies the conversation, spelled so it is safe as a path segment.
 */
export function conversationDir(base: string, key: string): string {
  return join(base, key.replace(/[^\w-]/g, '_'));
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
