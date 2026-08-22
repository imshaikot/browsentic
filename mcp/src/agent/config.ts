import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS, AGENT_KINDS, DEFAULT_AGENT, isAgentKind, type AgentKind } from '@/lib/agents/catalog';
import { FENCE_SETTING, UNATTENDED_SETTING, type GuardrailValue, type RuleEffect } from '@/lib/settings/guardrails';
import type { GuardrailConfig } from '../guardrails';
import { stateDir } from '../lockfile';

export interface AgentSettings {
  /** Binary name or absolute path. Defaults to the agent's own command name. */
  bin: string;
  model?: string;
  effort?: string;
}

export interface AgentConfig {
  /** Which CLI the daemon spawns for side-panel runs and background tasks. */
  agent: AgentKind;
  agents: Record<AgentKind, AgentSettings>;
  requireApproval: string[];
  /** How many tab sessions may have a run going at once. */
  maxConcurrentRuns?: number;
  /** Overrides for the declared guardrail policy. See mcp/src/guardrails/policy.ts. */
  guardrails?: GuardrailConfig;
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

export const CONCURRENT_RUNS = { fallback: 3, max: 8 } as const;

export function maxConcurrentRuns(config: AgentConfig): number {
  return clamp(config.maxConcurrentRuns, CONCURRENT_RUNS);
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

const DEFAULT_MODEL: Partial<Record<AgentKind, string>> = {
  claude: 'claude-sonnet-5',
};

const DEFAULT_APPROVALS = ['page.submitForm'];

interface StoredConfig extends Record<string, unknown> {
  agent?: unknown;
  agents?: Record<string, { bin?: unknown; model?: unknown; effort?: unknown } | undefined>;
  requireApproval?: unknown;
  guardrails?: unknown;
  /** Pre-0.2 layout: one Claude Code runner, configured at the top level. */
  claudeBin?: unknown;
  model?: unknown;
  effort?: unknown;
}

function readStored(): StoredConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as StoredConfig) : {};
  } catch {
    return {};
  }
}

export function readAgentConfig(): AgentConfig {
  const stored = readStored();
  const agents = {} as Record<AgentKind, AgentSettings>;
  for (const kind of AGENT_KINDS) agents[kind] = settingsFor(stored, kind);

  return {
    ...(stored as Partial<AgentConfig>),
    agent: isAgentKind(stored.agent) ? stored.agent : DEFAULT_AGENT,
    agents,
    requireApproval: Array.isArray(stored.requireApproval)
      ? (stored.requireApproval as string[])
      : DEFAULT_APPROVALS,
  };
}

function settingsFor(stored: StoredConfig, kind: AgentKind): AgentSettings {
  const scoped = stored.agents?.[kind] ?? {};
  const legacy = kind === 'claude' ? { bin: stored.claudeBin, model: stored.model, effort: stored.effort } : {};
  return {
    bin: text(scoped.bin) ?? text(legacy.bin) ?? AGENTS[kind].bin,
    model: text(scoped.model) ?? text(legacy.model) ?? DEFAULT_MODEL[kind],
    effort: text(scoped.effort) ?? text(legacy.effort),
  };
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export interface ActiveAgent extends AgentSettings {
  kind: AgentKind;
}

export function activeAgent(config: AgentConfig): ActiveAgent {
  return { kind: config.agent, ...config.agents[config.agent] };
}

/** Switches the agent the daemon spawns, leaving every other key in config.json untouched. */
export function writeActiveAgent(kind: AgentKind): void {
  const stored = readStored();
  write({ ...stored, agent: kind });
}

/**
 * Write one guardrail override, leaving every other key in config.json alone. `null`
 * removes the override rather than writing a value equal to the default — so a config
 * file only ever names the decisions someone actually made, and a change to a shipped
 * default reaches an install that never overrode it.
 */
export function writeGuardrailSetting(setting: string, value: GuardrailValue): void {
  const stored = readStored();
  const guardrails: GuardrailConfig = { ...((stored.guardrails as GuardrailConfig | undefined) ?? {}) };

  if (setting === FENCE_SETTING) {
    if (value === null) delete guardrails.fence;
    else guardrails.fence = value === true;
  } else if (setting === UNATTENDED_SETTING) {
    if (value === null) delete guardrails.unattended;
    else guardrails.unattended = value === 'allow' ? 'allow' : 'deny';
  } else {
    const rules = { ...(guardrails.rules ?? {}) };
    if (value === null) delete rules[setting];
    else rules[setting] = value as RuleEffect;
    if (Object.keys(rules).length) guardrails.rules = rules;
    else delete guardrails.rules;
  }

  const next = { ...stored };
  if (Object.keys(guardrails).length) next.guardrails = guardrails;
  else delete next.guardrails;
  write(next);
}

function write(config: StoredConfig): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
