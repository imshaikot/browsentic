import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import type { SkillDraft } from '@/lib/skills/format';
import { stateDir } from '../lockfile';
import { deleteSiteMap, deleteSkill, saveSkill } from './skill-store';
import { loadSkills, uploadedSkillsDir } from './skills';

const draft = (overrides: Partial<SkillDraft> = {}): SkillDraft => ({
  name: 'expense-reports',
  description: 'Files expense reports',
  category: 'general',
  domains: [],
  triggers: ['expense report'],
  body: 'Open the form, attach the receipt, submit.',
  ...overrides,
});

const uploaded = () => uploadedSkillsDir();
const code = (result: ReturnType<typeof saveSkill>) => (result.ok ? 'saved' : result.error.code);

beforeEach(() => {
  rmSync(uploaded(), { recursive: true, force: true });
  rmSync(join(stateDir, 'skills'), { recursive: true, force: true });
});

describe('saving a skill from the panel', () => {
  test('it lands in ~/browsentic/skills, readable only by the user, and the next run loads it', () => {
    const saved = saveSkill(draft());
    const path = join(uploaded(), 'expense-reports.md');
    expect({
      saved,
      mode: statSync(path).mode & 0o777,
      loaded: loadSkills().find((skill) => skill.name === 'expense-reports')?.source,
    }).toEqual({ saved: { ok: true, data: { name: 'expense-reports', path, replaced: false } }, mode: 0o600, loaded: 'uploaded' });
  });

  test('it is written as front matter and the body', () => {
    saveSkill(draft());
    expect(readFileSync(join(uploaded(), 'expense-reports.md'), 'utf8')).toBe(
      '---\nname: expense-reports\ndescription: Files expense reports\ntriggers: [expense report]\n---\n\nOpen the form, attach the receipt, submit.\n',
    );
  });

  test('saving the same name again replaces it, and says so', () => {
    saveSkill(draft());
    expect(saveSkill(draft({ body: 'New steps.' }))).toMatchObject({ ok: true, data: { replaced: true } });
  });

  test('a name that is not lowercase letters, digits and hyphens is refused', () => {
    expect(saveSkill(draft({ name: '../escape' }))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  test('the name of a built-in skill is refused', () => {
    expect(saveSkill(draft({ name: 'browser-control' }))).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', message: '"browser-control" is the name of a built-in skill. Pick another.' },
    });
  });

  test('the name of a skill the user wrote by hand is refused, with where that one is', () => {
    mkdirSync(join(stateDir, 'skills'), { recursive: true });
    writeFileSync(join(stateDir, 'skills', 'expense-reports.md'), 'Mine.');
    expect(saveSkill(draft())).toEqual({
      ok: false,
      error: {
        code: 'NAME_TAKEN',
        message: `"expense-reports" already exists at ${join(stateDir, 'skills', 'expense-reports.md')}. Rename this skill, or remove that file first.`,
      },
    });
  });

  test('the name of a mapped site is refused', () => {
    mkdirSync(join(uploaded(), 'expense-reports'), { recursive: true });
    writeFileSync(join(uploaded(), 'expense-reports', 'SKILL.md'), 'Map.');
    expect(code(saveSkill(draft()))).toBe('NAME_TAKEN');
  });

  test('past fifty uploaded skills a new one is refused, but an existing one can still be replaced', () => {
    for (let i = 0; i < 50; i++) saveSkill(draft({ name: `skill-${i}` }));
    expect([code(saveSkill(draft({ name: 'one-more' }))), code(saveSkill(draft({ name: 'skill-7', body: 'Updated.' })))]).toEqual([
      'TOO_MANY_SKILLS',
      'saved',
    ]);
  });

  test('a skills directory that cannot be written is a clean failure', () => {
    mkdirSync(join(uploaded(), '..'), { recursive: true });
    writeFileSync(uploaded(), 'a file where the directory should be');
    expect(code(saveSkill(draft()))).toBe('WRITE_FAILED');
    rmSync(uploaded());
  });
});

describe('removing one', () => {
  test('a skill is removed by name', () => {
    saveSkill(draft());
    expect([deleteSkill('expense-reports'), loadSkills().some((skill) => skill.name === 'expense-reports')]).toEqual([
      { ok: true, data: { name: 'expense-reports' } },
      false,
    ]);
  });

  test('a name that could reach outside the skills directory removes nothing', () => {
    expect([deleteSkill('../config'), deleteSiteMap('../../.browsentic')]).toEqual([
      { ok: false, error: { code: 'INVALID_INPUT', message: '"../config" is not a usable skill name.' } },
      { ok: false, error: { code: 'INVALID_INPUT', message: '"../../.browsentic" is not a usable skill name.' } },
    ]);
  });

  test('a mapped site is removed with everything in its folder', () => {
    mkdirSync(join(uploaded(), 'example-com', 'screenshots'), { recursive: true });
    writeFileSync(join(uploaded(), 'example-com', 'SKILL.md'), 'Map.');
    expect([deleteSiteMap('example-com'), loadSkills().some((skill) => skill.name === 'example-com')]).toEqual([
      { ok: true, data: { name: 'example-com' } },
      false,
    ]);
  });

  test('removing a map that is not there says so', () => {
    expect(deleteSiteMap('nowhere-com')).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'No mapped site called "nowhere-com".' } });
  });
});
