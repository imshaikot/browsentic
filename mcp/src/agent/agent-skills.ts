import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { AgentSkillMeta } from '@/lib/actions/protocol';
import type { AgentKind } from '@/lib/agents/catalog';
import { splitFrontMatter } from '@/lib/skills/format';
import { log } from '../log';
import type { AgentConfig } from './config';
import { RUNNERS } from './runners';
import { SKILL_FILE } from './skills';

const MAX_SKILLS = 100;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 200;
const MAX_SKILL_BYTES = 48 * 1024;
const TTL_MS = 30_000;

const ID_RE = /^[0-9a-f]{16}$/;

interface KnownSkill extends AgentSkillMeta {
  agent: AgentKind;
  path: string;
}

let cached: { at: number; agent: AgentKind; dirs: string; skills: KnownSkill[] } | null = null;

/** Every id ever handed to the extension resolves here or nowhere; ids from the wire never become paths. */
const known = new Map<string, KnownSkill>();

export function agentSkills(config: AgentConfig, { refresh = false } = {}): AgentSkillMeta[] {
  const agent = config.agent;
  const dirs = RUNNERS[agent].skillDirs?.() ?? [];
  const signature = dirs.join('\n');
  if (!refresh && cached && cached.agent === agent && cached.dirs === signature && Date.now() - cached.at < TTL_MS) {
    return cached.skills.map(meta);
  }

  const found: KnownSkill[] = [];
  for (const dir of dirs) scan(dir, agent, found);
  found.sort((a, b) => a.name.localeCompare(b.name));
  const skills = found.slice(0, MAX_SKILLS);
  if (found.length > skills.length) log(`agent skills: listing ${MAX_SKILLS} of ${found.length} found for ${agent}`);

  for (const [id, entry] of known) if (entry.agent === agent) known.delete(id);
  for (const skill of skills) known.set(skill.id, skill);
  cached = { at: Date.now(), agent, dirs: signature, skills };
  return skills.map(meta);
}

export type AgentSkillResolution =
  | { skill: { name: string; body: string } }
  | { error: { code: string; message: string } };

export function resolveAgentSkill(id: string, config: AgentConfig): AgentSkillResolution {
  if (!ID_RE.test(id)) return unknown();
  if (!known.has(id)) agentSkills(config, { refresh: true });
  const entry = known.get(id);
  if (!entry || entry.agent !== config.agent) return unknown();

  const dirs = RUNNERS[config.agent].skillDirs?.() ?? [];
  if (!dirs.some((dir) => entry.path.startsWith(dir + sep))) return unknown();
  try {
    const stats = statSync(entry.path);
    if (!stats.isFile()) return unknown();
    if (stats.size > MAX_SKILL_BYTES) {
      return {
        error: {
          code: 'SKILL_UNKNOWN',
          message: `The skill "${entry.name}" grew past ${MAX_SKILL_BYTES / 1024} KB, so it was not attached.`,
        },
      };
    }
    const body = splitFrontMatter(readFileSync(entry.path, 'utf8')).body.trim();
    if (!body) return unknown();
    return { skill: { name: entry.name, body } };
  } catch {
    return unknown();
  }
}

function unknown(): AgentSkillResolution {
  return {
    error: {
      code: 'SKILL_UNKNOWN',
      message: 'That agent skill is not in the catalog any more — reopen the picker and choose again.',
    },
  };
}

function meta(skill: KnownSkill): AgentSkillMeta {
  return { id: skill.id, name: skill.name, description: skill.description };
}

function scan(dir: string, agent: AgentKind, out: KnownSkill[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
  } catch {
    return;
  }
  for (const entry of entries) {
    // Stat the joined path rather than trusting the dirent, so symlinked skill folders count too.
    const path = entry.name.endsWith('.md') ? join(dir, entry.name) : join(dir, entry.name, SKILL_FILE);
    try {
      const stats = statSync(path);
      if (!stats.isFile() || stats.size > MAX_SKILL_BYTES) continue;
      const { fields, body } = splitFrontMatter(readFileSync(path, 'utf8'));
      if (!body.trim()) continue;
      const name = clean(unquote(fields.name) || entry.name.replace(/\.md$/, ''), MAX_NAME);
      if (!name) continue;
      out.push({ id: idOf(path), agent, name, description: clean(unquote(fields.description), MAX_DESCRIPTION), path });
    } catch {
      continue;
    }
  }
}

/** Titles cross the wire into the panel; control characters and length are stripped here, not there. */
function clean(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function unquote(value?: string): string {
  return (value ?? '').replace(/^(['"])([\s\S]*)\1$/, '$2');
}

function idOf(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 16);
}
