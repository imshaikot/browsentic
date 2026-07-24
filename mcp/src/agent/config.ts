import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from '../lockfile';

/**
 * Agent settings, read from `~/.voicelink/config.json` on every run so edits take effect
 * without restarting the daemon. Everything is optional; the defaults below are a working
 * configuration on their own.
 *
 * There is deliberately no API key here: runs are executed by the user's own Claude Code
 * install (`claude -p`), which brings its own login.
 */
export interface AgentConfig {
  /** The Claude Code binary. A bare name resolves through PATH; an absolute path pins it. */
  claudeBin: string;
  /** Defaults to Sonnet 5 (see DEFAULTS); set to override with any `claude --model` value. */
  model?: string;
  /** Omit to use the user's default effort. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Action names that pause for a user decision before they execute. */
  requireApproval: string[];
  /**
   * Where `page.screenshot { save: true }` writes files. Absolute path; `~` is expanded.
   * Defaults to `~/voicelink/screenshot` (see `saveScreenshot`) — deliberately outside the
   * dotted `~/.voicelink` state dir, since screenshots are user-facing artifacts to browse.
   */
  screenshotDir?: string;
}

export const configPath = join(stateDir, 'config.json');

const DEFAULTS: AgentConfig = {
  claudeBin: 'claude',
  // Pin the spawned agent to Sonnet 5 rather than inheriting the user's Claude Code default;
  // a config.json `model` still overrides it.
  model: 'claude-sonnet-5',
  // A form submit is the canonical "this sends something to someone else" action.
  requireApproval: ['page.submitForm'],
};

export function readAgentConfig(): AgentConfig {
  let stored: Partial<AgentConfig> = {};
  try {
    stored = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<AgentConfig>;
  } catch {
    // No config file, or unreadable — the defaults are a complete configuration.
  }
  return {
    ...DEFAULTS,
    ...stored,
    // A malformed array here would break the approval gate open, so re-validate the shape.
    requireApproval: Array.isArray(stored.requireApproval) ? stored.requireApproval : DEFAULTS.requireApproval,
  };
}
