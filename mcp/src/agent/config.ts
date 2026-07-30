import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from '../lockfile';

export interface AgentConfig {
  claudeBin: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  requireApproval: string[];
  screenshotDir?: string;
  skillsDir?: string;
  siteMap?: {
    research?: boolean;
    allowClicks?: boolean;
    maxPages?: number;
    maxScreenshots?: number;
    timeoutMs?: number;
  };
}

export const SITE_MAP_LIMITS = {
  pages: { fallback: 15, max: 40 },
  screenshots: { fallback: 10, max: 24 },
  timeoutMs: { fallback: 10 * 60_000, max: 30 * 60_000 },
} as const;

export interface SiteMapSettings {
  research: boolean;
  allowClicks: boolean;
  maxPages: number;
  maxScreenshots: number;
  timeoutMs: number;
}

export function siteMapSettings(config: AgentConfig): SiteMapSettings {
  const stored = config.siteMap ?? {};
  return {
    research: stored.research !== false,
    allowClicks: stored.allowClicks === true,
    maxPages: clamp(stored.maxPages, SITE_MAP_LIMITS.pages),
    maxScreenshots: clamp(stored.maxScreenshots, SITE_MAP_LIMITS.screenshots),
    timeoutMs: clamp(stored.timeoutMs, SITE_MAP_LIMITS.timeoutMs),
  };
}

function clamp(value: unknown, { fallback, max }: { fallback: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

export const configPath = join(stateDir, 'config.json');

const DEFAULTS: AgentConfig = {
  claudeBin: 'claude',
  model: 'claude-sonnet-5',
  requireApproval: ['page.submitForm'],
};

export function readAgentConfig(): AgentConfig {
  let stored: Partial<AgentConfig> = {};
  try {
    stored = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<AgentConfig>;
  } catch {
  }
  return {
    ...DEFAULTS,
    ...stored,
    requireApproval: Array.isArray(stored.requireApproval) ? stored.requireApproval : DEFAULTS.requireApproval,
  };
}
