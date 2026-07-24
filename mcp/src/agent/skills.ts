import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir } from '../lockfile';
import { log } from '../log';

/** One markdown file under `mcp/skills/` or `~/.voicelink/skills/`. */
export interface Skill {
  name: string;
  description: string;
  /** Lowercased phrases; the more of them an instruction contains, the better the match. */
  triggers: string[];
  isDefault: boolean;
  /** Everything after the front matter — this becomes the system prompt. */
  body: string;
}

/** From `dist/`, `../skills` is the package's own skills directory. */
const bundledDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const userDir = join(stateDir, 'skills');

/** Named in the error when nothing loads, so a broken install is diagnosable from the message. */
export const skillDirs = [bundledDir, userDir] as const;

/** `@page-research find the price` — an explicit choice that skips scoring. */
const EXPLICIT = /^@([a-z0-9][a-z0-9-]*)\s+/i;

/**
 * Bundled skills first, then user skills, which shadow a bundled skill of the same name.
 * Read on every run so a user can edit a skill and re-ask without restarting the daemon.
 */
export function loadSkills(): Skill[] {
  const byName = new Map<string, Skill>();
  for (const dir of skillDirs) {
    for (const skill of readDir(dir)) byName.set(skill.name, skill);
  }
  return [...byName.values()];
}

function readDir(dir: string): Skill[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((entry) => entry.endsWith('.md'));
  } catch {
    return []; // No such directory — a user skills directory is optional.
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    try {
      const skill = parseSkill(readFileSync(join(dir, entry), 'utf8'), entry.replace(/\.md$/, ''));
      if (skill.body.trim()) skills.push(skill);
      else log(`skill ${join(dir, entry)} has no body; ignoring`);
    } catch (error) {
      log(`failed to read skill ${join(dir, entry)}`, error);
    }
  }
  return skills;
}

/**
 * An explicit `@name` prefix wins. Otherwise score by how many of a skill's triggers appear
 * in the instruction; ties go to the first loaded. Nothing matching falls back to the skill
 * marked `default: true`, or to the first one if no skill claims that.
 */
export function routeSkill(skills: Skill[], instruction: string): { skill: Skill; text: string } | null {
  if (!skills.length) return null;
  const fallback = skills.find((skill) => skill.isDefault) ?? skills[0];

  const explicit = EXPLICIT.exec(instruction);
  if (explicit) {
    const named = skills.find((skill) => skill.name.toLowerCase() === explicit[1].toLowerCase());
    if (named) return { skill: named, text: instruction.slice(explicit[0].length) };
    // Unknown name: treat the "@foo" as ordinary prose rather than silently dropping it.
  }

  const haystack = instruction.toLowerCase();
  let best = fallback;
  let bestScore = 0;
  for (const skill of skills) {
    const score = skill.triggers.reduce((count, trigger) => count + (haystack.includes(trigger) ? 1 : 0), 0);
    if (score > bestScore) {
      best = skill;
      bestScore = score;
    }
  }
  return { skill: best, text: instruction };
}

function parseSkill(raw: string, fallbackName: string): Skill {
  const { fields, body } = splitFrontMatter(raw);
  return {
    name: fields.name || fallbackName,
    description: fields.description ?? '',
    triggers: parseList(fields.triggers).map((trigger) => trigger.toLowerCase()),
    isDefault: fields.default === 'true',
    body,
  };
}

/**
 * A deliberately small reader for the `key: value` front matter these files use — enough for
 * strings and flat `[a, b]` lists, and not worth a YAML dependency in a daemon this size.
 */
function splitFrontMatter(raw: string): { fields: Record<string, string>; body: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!match) return { fields: {}, body: raw };

  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { fields, body: raw.slice(match[0].length) };
}

function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}
