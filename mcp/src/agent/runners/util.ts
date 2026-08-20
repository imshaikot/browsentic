import { log } from '../../log';
import type { AgentSettings } from '../config';

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
