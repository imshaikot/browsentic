import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { failure, success, type ActionResult, type SavedSkill } from '@/lib/actions/protocol';
import { SKILL_NAME_RE, serializeSkillFile, validateSkillDraft, type SkillDraft } from '@/lib/skills/format';
import { log } from '../log';
import { SKILL_FILE, bundledSkillNames, existingUserSkill, uploadedSkillsDir, userSkillPath } from './skills';

/**
 * The write side of the uploaded skills directory. Everything here is synchronous: the files
 * are a few KB of markdown, and the daemon answers the extension on the same tick.
 *
 * The extension sends structured fields, never a finished file — this module composes the front
 * matter, so an upload can only ever set the keys it was offered.
 */

/** `loadSkills()` reads every file in the directory on every instruction; keep it small. */
const MAX_SKILL_FILES = 50;

export function saveSkill(draft: SkillDraft): ActionResult<SavedSkill> {
  const checked = validateSkillDraft(draft, { reservedNames: bundledSkillNames() });
  if (!checked.ok) return failure('INVALID_INPUT', checked.message);
  const skill = checked.draft;

  // A hand-authored skill of the same name lives in a directory we do not own; an upload that
  // shadowed it would silently win on every run with no way to tell from the extension.
  if (existingUserSkill(skill.name)) {
    return failure(
      'NAME_TAKEN',
      `"${skill.name}" already exists at ${userSkillPath(skill.name)}. Rename this skill, or remove that file first.`,
    );
  }

  const dir = uploadedSkillsDir();
  const path = pathIn(dir, skill.name);
  if (!path) return failure('INVALID_INPUT', `"${skill.name}" is not a usable skill name.`);

  // A generated map owns the directory form of this name. The loader would prefer this flat
  // file, silently making the map inert, so refuse rather than quietly win.
  if (existsSync(join(dir, skill.name, SKILL_FILE))) {
    return failure(
      'NAME_TAKEN',
      `"${skill.name}" is a mapped site. Remove that map first, or give this skill another name.`,
    );
  }

  const replaced = existsSync(path);
  if (!replaced && countSkills(dir) >= MAX_SKILL_FILES) {
    return failure('TOO_MANY_SKILLS', `There are already ${MAX_SKILL_FILES} uploaded skills. Remove one first.`);
  }

  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Write then rename: `loadSkills()` reads these files on every instruction, and a plain
    // write leaves a window where a run in flight parses a half-written body.
    const temp = `${path}.tmp`;
    writeFileSync(temp, serializeSkillFile(skill), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } catch (error) {
    log(`failed to save skill ${skill.name}`, error);
    return failure('WRITE_FAILED', `Could not write ${path}: ${String(error)}`);
  }

  log(`${replaced ? 'replaced' : 'saved'} skill ${skill.name} (${skill.category}) at ${path}`);
  return success({ name: skill.name, path, replaced });
}

/**
 * Remove an uploaded skill — the flat `<name>.md` and **only** that. A generated map of the same
 * name is a different object with its own op: one `deleteSkill` must never take both down,
 * because the panel sends this when the user removes an upload and the map is not what they meant.
 */
export function deleteSkill(name: string): ActionResult<SavedSkill> {
  const dir = uploadedSkillsDir();
  const path = pathIn(dir, name);
  if (!path) return failure('INVALID_INPUT', `"${name}" is not a usable skill name.`);
  try {
    rmSync(path, { force: true });
  } catch (error) {
    log(`failed to delete skill ${name}`, error);
    return failure('WRITE_FAILED', `Could not remove ${path}: ${String(error)}`);
  }
  log(`removed skill ${name}`);
  return success({ name });
}

/**
 * Remove a generated map: its directory and everything under it. Three guards stand between a
 * name off the socket and a recursive delete — the name shape, the resolved parent, and the
 * presence of a `SKILL.md` inside. The last is the one that matters: it proves the target is a
 * skill directory and not, say, `screenshots`.
 */
export function deleteSiteMap(name: string): ActionResult<SavedSkill> {
  const dir = uploadedSkillsDir();
  const path = pathIn(dir, name);
  if (!path) return failure('INVALID_INPUT', `"${name}" is not a usable skill name.`);
  const mapDir = path.replace(/\.md$/, '');
  if (!existsSync(join(mapDir, SKILL_FILE))) {
    return failure('NOT_FOUND', `No mapped site called "${name}".`);
  }
  try {
    rmSync(mapDir, { recursive: true, force: true });
  } catch (error) {
    log(`failed to delete site map ${name}`, error);
    return failure('WRITE_FAILED', `Could not remove ${mapDir}: ${String(error)}`);
  }
  log(`removed site map ${name}`);
  return success({ name });
}

/**
 * The file a skill of this name occupies, or null if it would land anywhere but `dir`. The
 * name regex already rules out separators, but delete takes a name straight off the wire —
 * so the containment check is done on the resolved path, not on the input.
 */
function pathIn(dir: string, name: string): string | null {
  if (!SKILL_NAME_RE.test(name)) return null;
  const candidate = resolve(join(dir, `${name}.md`));
  return dirname(candidate) === resolve(dir) ? candidate : null;
}

/**
 * Both skill forms, since `MAX_SKILL_FILES` bounds a per-instruction cost — `loadSkills()`
 * re-reads every directory on every run — and a directory-form map costs the same read as a
 * flat file. Dot-prefixed entries are staging and do not count against the user.
 */
function countSkills(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(
      (entry) =>
        !entry.name.startsWith('.') &&
        (entry.isFile()
          ? entry.name.endsWith('.md')
          : entry.isDirectory() && existsSync(join(dir, entry.name, SKILL_FILE))),
    ).length;
  } catch {
    return 0;
  }
}
