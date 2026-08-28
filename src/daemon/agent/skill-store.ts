import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { failure, success, type ActionResult, type SavedSkill } from '@/lib/actions/protocol';
import { SKILL_NAME_RE, serializeSkillFile, validateSkillDraft, type SkillDraft } from '@/lib/skills/format';
import { log } from '../log';
import { SKILL_FILE, bundledSkillNames, existingUserSkill, uploadedSkillsDir, userSkillPath } from './skills';

const MAX_SKILL_FILES = 50;

export function saveSkill(draft: SkillDraft): ActionResult<SavedSkill> {
  const checked = validateSkillDraft(draft, { reservedNames: bundledSkillNames() });
  if (!checked.ok) return failure('INVALID_INPUT', checked.message);
  const skill = checked.draft;

  if (existingUserSkill(skill.name)) {
    return failure(
      'NAME_TAKEN',
      `"${skill.name}" already exists at ${userSkillPath(skill.name)}. Rename this skill, or remove that file first.`,
    );
  }

  const dir = uploadedSkillsDir();
  const path = pathIn(dir, skill.name);
  if (!path) return failure('INVALID_INPUT', `"${skill.name}" is not a usable skill name.`);

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

function pathIn(dir: string, name: string): string | null {
  if (!SKILL_NAME_RE.test(name)) return null;
  const candidate = resolve(join(dir, `${name}.md`));
  return dirname(candidate) === resolve(dir) ? candidate : null;
}

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
