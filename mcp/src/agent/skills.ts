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

/** Where a skill came from, which is also what may be written to it. */
export type SkillSource = 'bundled' | 'user' | 'uploaded';

/** One markdown file from any of the three skill directories. */
export interface Skill {
  name: string;
  description: string;
  /** Lowercased phrases; the more of them an instruction contains, the better the match. */
  triggers: string[];
  isDefault: boolean;
  /** `general` skills compete for the base slot; `site-exploration` skills stack on top. */
  category: SkillCategory;
  /** Hosts a site-exploration skill applies to. Empty for a general skill. */
  domains: string[];
  source: SkillSource;
  /** `generated` marks a machine-written map: derived from pages, so it is trusted least. */
  provenance: 'authored' | 'generated';
  /** Everything after the front matter — this becomes the system prompt. */
  body: string;
}

/** From `dist/`, `../skills` is the package's own skills directory. */
const bundledDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const userDir = join(stateDir, 'skills');

/**
 * Where the extension's uploads land. Deliberately outside the dotted state directory and
 * separate from `userDir`: this one is machine-managed, so the daemon can write and delete
 * in it without ever touching a file someone hand-authored.
 */
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

/** Read in this order; a later directory shadows an earlier one by skill name. */
function skillDirs(): { dir: string; source: SkillSource }[] {
  return [
    { dir: bundledDir, source: 'bundled' },
    { dir: userDir, source: 'user' },
    { dir: uploadedSkillsDir(), source: 'uploaded' },
  ];
}

/** Named in the error when nothing loads, so a broken install is diagnosable from the message. */
export function skillDirNames(): string[] {
  return skillDirs().map(({ dir }) => dir);
}

/** The path a skill of this name would occupy in a hand-authored (not uploaded) file. */
export function userSkillPath(name: string): string {
  return join(userDir, `${name}.md`);
}

/**
 * True when a hand-authored skill already owns this name. The uploaded directory is read last
 * and therefore shadows `~/.voicelink/skills/`, so writing over that name would silently replace
 * the user's own notes on every future run — the thing `saveSkill`'s NAME_TAKEN guard exists for.
 */
export function existingUserSkill(name: string): boolean {
  return existsSync(userSkillPath(name)) || existsSync(join(userDir, name, SKILL_FILE));
}

/** The file that makes a directory a skill, matching this repo's own `.claude/skills` layout. */
export const SKILL_FILE = 'SKILL.md';

/** `@page-research find the price` — an explicit choice that skips scoring. */
const EXPLICIT = /^@([a-z0-9][a-z0-9-]*)\s+/i;

/**
 * Bundled skills first, then hand-written ones, then uploads — each shadowing the last by name.
 * Read on every run so a user can edit a skill and re-ask without restarting the daemon.
 */
export function loadSkills(): Skill[] {
  const byName = new Map<string, Skill>();
  for (const { dir, source } of skillDirs()) {
    for (const skill of readDir(dir, source)) byName.set(skill.name, skill);
  }
  return [...byName.values()];
}

/** Names an upload may not claim — shadowing one would delete a shipped prompt. */
export function bundledSkillNames(): string[] {
  return readDir(bundledDir, 'bundled').map((skill) => skill.name);
}

/**
 * One directory's skills, in both forms: `<name>/SKILL.md` (what a mapping run generates, since
 * it needs somewhere to put screenshots) and flat `<name>.md`. A deliberately-placed flat file
 * wins a name collision, and the collision is logged rather than resolved silently.
 *
 * Entries beginning with a dot are skipped entirely. That single rule is what makes
 * `<uploadedDir>/.staging/` a quarantine rather than a convention: an unreviewed map is not
 * merely unrouted, it is never opened, so it cannot reach a prompt by any path.
 */
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
    return []; // No such directory — only the bundled one is expected to exist.
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
          // Still loaded — `@name` can reach it — but it will never engage on its own.
          log(`skill ${skill.name} is site-exploration with no domains; it will only apply via @${skill.name}`);
        }
        skills.push(skill);
      }
    } catch (error) {
      log(`failed to read skill ${path}`, error);
    }
  }
}

/** What a run is built from: one base skill, plus any site notes that apply to the tab. */
export interface RoutedSkill {
  base: Skill;
  overlays: Skill[];
  text: string;
}

/**
 * Pick the base skill and the overlays for one instruction.
 *
 * An explicit `@name` prefix wins: naming a general skill picks the base outright, while naming
 * a site-exploration skill forces it on as an overlay and lets the base route normally — so
 * `@acme-admin fill the form` still gets the browser-driving skill underneath it. Otherwise the
 * base is scored by how many of a skill's triggers appear in the instruction, and every
 * site-exploration skill whose domains match the tab's host is stacked on top.
 */
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
      // A named general skill *is* the base and settles routing; a named site skill only
      // pins itself on, so the base is still chosen from what was actually asked for.
      if (named.category === 'general') return { base: named, overlays: overlaysFor(skills, context, []), text };
      forced.push(named);
    }
    // Unknown name: treat the "@foo" as ordinary prose rather than silently dropping it.
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

/**
 * Every site-exploration skill that applies right now: the ones pinned with `@name`, then the
 * ones whose domains match the tab's host, most specific domain first.
 */
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
    // A site skill must never claim the fallback slot: it would then apply on every host,
    // which is the one thing its domains exist to prevent.
    isDefault: category === 'general' && fields.default === 'true',
    category,
    domains: category === 'site-exploration' ? parseList(fields.domains).map((d) => d.toLowerCase()) : [],
    source,
    // Only an uploaded-directory skill may claim to be generated: the field is a trust *demotion*,
    // so a hand-authored file claiming it costs nothing, but a bundled one never should.
    provenance: fields.provenance === 'generated' && source === 'uploaded' ? 'generated' : 'authored',
    body,
  };
}
