import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunContext } from '@/lib/actions/protocol';
import {
  hostnameOf,
  matchedDomains,
  parseCategory,
  parseList,
  splitFrontMatter,
  type SkillCategory,
} from '@/lib/skills/format';
import { stateDir } from '../lockfile';
import { log } from '../log';
import { readAgentConfig } from './config';

export type SkillSource = 'bundled' | 'user' | 'uploaded';

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  isDefault: boolean;
  category: SkillCategory;
  domains: string[];
  source: SkillSource;
  provenance: 'authored' | 'generated';
  body: string;
}

const bundledDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const userDir = join(stateDir, 'skills');

export function uploadedSkillsDir(): string {
  const configured = readAgentConfig().skillsDir;
  if (typeof configured === 'string' && configured.trim()) return expandHome(configured.trim());
  return join(homedir(), 'voicelink', 'skills');
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : join(homedir(), p);
}

function skillDirs(): { dir: string; source: SkillSource }[] {
  return [
    { dir: bundledDir, source: 'bundled' },
    { dir: userDir, source: 'user' },
    { dir: uploadedSkillsDir(), source: 'uploaded' },
  ];
}

export function skillDirNames(): string[] {
  return skillDirs().map(({ dir }) => dir);
}

export function userSkillPath(name: string): string {
  return join(userDir, `${name}.md`);
}

export function existingUserSkill(name: string): boolean {
  return existsSync(userSkillPath(name)) || existsSync(join(userDir, name, SKILL_FILE));
}

export const SKILL_FILE = 'SKILL.md';

const EXPLICIT = /^@([a-z0-9][a-z0-9-]*)\s+/i;

export function loadSkills(): Skill[] {
  const byName = new Map<string, Skill>();
  for (const { dir, source } of skillDirs()) {
    for (const skill of readDir(dir, source)) byName.set(skill.name, skill);
  }
  return [...byName.values()];
}

export function bundledSkillNames(): string[] {
  return readDir(bundledDir, 'bundled').map((skill) => skill.name);
}

function readDir(dir: string, source: SkillSource): Skill[] {
  let files: string[];
  let directories: string[];
  try {
    const entries = readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
    files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => entry.name);
    directories = entries
      .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, SKILL_FILE)))
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const skills: Skill[] = [];
  const flatNames = new Set(files.map((file) => file.replace(/\.md$/, '')));
  for (const name of directories) {
    if (flatNames.has(name)) {
      log(`skill "${name}" exists as both ${name}.md and ${name}/${SKILL_FILE} in ${dir}; using the file`);
      continue;
    }
    push(join(dir, name, SKILL_FILE), name);
  }
  for (const file of files) push(join(dir, file), file.replace(/\.md$/, ''));
  return skills;

  function push(path: string, fallbackName: string): void {
    try {
      const skill = parseSkill(readFileSync(path, 'utf8'), fallbackName, source);
      if (!skill.body.trim()) log(`skill ${path} has no body; ignoring`);
      else {
        if (skill.category === 'site-exploration' && !skill.domains.length) {
          log(`skill ${skill.name} is site-exploration with no domains; it will only apply via @${skill.name}`);
        }
        skills.push(skill);
      }
    } catch (error) {
      log(`failed to read skill ${path}`, error);
    }
  }
}

export interface RoutedSkill {
  base: Skill;
  overlays: Skill[];
  text: string;
}

export function routeSkill(skills: Skill[], instruction: string, context?: RunContext): RoutedSkill | null {
  if (!skills.length) return null;
  const bases = skills.filter((skill) => skill.category === 'general');
  const fallback = bases.find((skill) => skill.isDefault) ?? bases[0] ?? skills[0];

  let text = instruction;
  const forced: Skill[] = [];

  const explicit = EXPLICIT.exec(instruction);
  if (explicit) {
    const named = skills.find((skill) => skill.name.toLowerCase() === explicit[1].toLowerCase());
    if (named) {
      text = instruction.slice(explicit[0].length);
      if (named.category === 'general') return { base: named, overlays: overlaysFor(skills, context, []), text };
      forced.push(named);
    }
  }

  const haystack = text.toLowerCase();
  let best = fallback;
  let bestScore = 0;
  for (const skill of bases) {
    const score = skill.triggers.reduce((count, trigger) => count + (haystack.includes(trigger) ? 1 : 0), 0);
    if (score > bestScore) {
      best = skill;
      bestScore = score;
    }
  }
  return { base: best, overlays: overlaysFor(skills, context, forced), text };
}

function overlaysFor(skills: Skill[], context: RunContext | undefined, forced: Skill[]): Skill[] {
  const host = context?.url ? hostnameOf(context.url) : '';
  const matched = host
    ? skills
        .filter((skill) => skill.category === 'site-exploration' && !forced.includes(skill))
        .map((skill) => ({ skill, match: matchedDomains(host, skill.domains)[0] ?? '' }))
        .filter((entry) => entry.match)
        .sort((a, b) => b.match.length - a.match.length)
        .map((entry) => entry.skill)
    : [];
  return [...forced, ...matched];
}

function parseSkill(raw: string, fallbackName: string, source: SkillSource): Skill {
  const { fields, body } = splitFrontMatter(raw);
  const category = parseCategory(fields.category);
  return {
    name: fields.name || fallbackName,
    description: fields.description ?? '',
    triggers: parseList(fields.triggers).map((trigger) => trigger.toLowerCase()),
    isDefault: category === 'general' && fields.default === 'true',
    category,
    domains: category === 'site-exploration' ? parseList(fields.domains).map((d) => d.toLowerCase()) : [],
    source,
    provenance: fields.provenance === 'generated' && source === 'uploaded' ? 'generated' : 'authored',
    body,
  };
}
