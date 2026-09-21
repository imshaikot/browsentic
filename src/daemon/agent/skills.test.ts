import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import type { RunContext } from '@/lib/actions/protocol';
import { stateDir } from '../lockfile';
import { bundledSkillNames, loadSkills, routeSkill, SCRIPTING_SKILL, skillDirNames, uploadedSkillsDir, type Skill } from './skills';

const skill = (name: string): Skill => ({
  name,
  description: '',
  triggers: ['20', 'every'],
  isDefault: name === 'browser-control',
  category: 'general',
  domains: [],
  source: 'bundled',
  provenance: 'authored',
  body: name,
});

const library = [skill('browser-control'), skill(SCRIPTING_SKILL)];
const route = (context?: RunContext) => routeSkill(library, 'create 20 tags, every one of them', context);

describe('the Live tool switch decides whether the agent is even told', () => {
  test('with the switch off the scripting skill is not attached', () => {
    expect(route({})?.overlays.map((s) => s.name)).toEqual([]);
  });

  test('with the switch off the base skill is unaffected', () => {
    expect(route({})?.base.name).toBe('browser-control');
  });

  test('with the switch on it rides along as an overlay', () => {
    expect(route({ liveTools: true })?.overlays.map((s) => s.name)).toEqual([SCRIPTING_SKILL]);
  });

  test('it never replaces the base skill it advises against', () => {
    expect(route({ liveTools: true })?.base.name).toBe('browser-control');
  });

  test('no context at all means off', () => {
    expect(routeSkill(library, 'create 20 tags')?.overlays.map((s) => s.name)).toEqual([]);
  });
});

// docs/internals/agent-runs.md § Skill routing states each of these.
describe('loading skills', () => {
  const userSkills = join(stateDir, 'skills');
  const write = (path: string, fields: Record<string, string>, body = 'Do it this way.') => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n\n${body}`);
  };
  const named = (name: string) => loadSkills().find((loaded) => loaded.name === name);

  beforeEach(() => {
    rmSync(userSkills, { recursive: true, force: true });
    rmSync(uploadedSkillsDir(), { recursive: true, force: true });
  });

  test('skills come from the package, then ~/.browsentic/skills, then ~/browsentic/skills', () => {
    expect(skillDirNames().slice(1)).toEqual([userSkills, uploadedSkillsDir()]);
  });

  test('the bundled skills load, with browser-control as the default', () => {
    expect([bundledSkillNames().includes('browser-control'), named('browser-control')?.isDefault]).toEqual([true, true]);
  });

  test('a later directory shadows an earlier one by name', () => {
    write(join(userSkills, 'page-research.md'), { name: 'page-research', triggers: '[research]' }, 'My own research rules.');
    expect([named('page-research')?.source, named('page-research')?.body.trim()]).toEqual(['user', 'My own research rules.']);
  });

  test('a flat file and a folder with SKILL.md are both skills, and when both exist the file wins', () => {
    write(join(uploadedSkillsDir(), 'invoices', 'SKILL.md'), { description: 'from the folder' });
    write(join(uploadedSkillsDir(), 'refunds', 'SKILL.md'), { description: 'folder only' });
    write(join(uploadedSkillsDir(), 'invoices.md'), { description: 'from the file' });
    expect([named('invoices')?.description, named('refunds')?.description]).toEqual(['from the file', 'folder only']);
  });

  test('a skill with no instructions is ignored', () => {
    write(join(userSkills, 'hollow.md'), { name: 'hollow' }, '   ');
    expect(named('hollow')).toBeUndefined();
  });

  test('only a map in the uploaded folder can claim to be machine-generated', () => {
    write(join(userSkills, 'claims.md'), { provenance: 'generated', category: 'site-exploration', domains: '[a.com]' });
    write(join(uploadedSkillsDir(), 'mapped.md'), { provenance: 'generated', category: 'site-exploration', domains: '[b.com]' });
    expect([named('claims')?.provenance, named('mapped')?.provenance]).toEqual(['authored', 'generated']);
  });

  test('edits apply to the next run, with nothing to reload', () => {
    write(join(userSkills, 'fresh.md'), { description: 'first' });
    const before = named('fresh')?.description;
    write(join(userSkills, 'fresh.md'), { description: 'second' });
    expect([before, named('fresh')?.description]).toEqual(['first', 'second']);
  });
});

describe('routing an instruction', () => {
  const general = (name: string, triggers: string[], isDefault = false): Skill => ({ ...skill(name), triggers, isDefault });
  const site = (name: string, domains: string[]): Skill => ({ ...skill(name), category: 'site-exploration', domains, triggers: [] });
  const skills = [
    general('browser-control', ['click'], true),
    general('page-research', ['research', 'compare']),
    general('page-theming', ['dark mode']),
    site('example-com', ['example.com']),
    site('docs-example-com', ['docs.example.com']),
    site('unscoped-notes', []),
  ];
  const route = (instruction: string, url?: string) => routeSkill(skills, instruction, url ? { url } : undefined);

  test('the base skill is the one whose triggers the instruction hits most', () => {
    expect(route('research and compare the plans, then click one')?.base.name).toBe('page-research');
  });

  test('with no hits, the default skill runs', () => {
    expect(route('hello there')?.base.name).toBe('browser-control');
  });

  test('@name pins a skill and is taken off the instruction', () => {
    expect(route('@page-theming make it readable')).toMatchObject({ base: { name: 'page-theming' }, text: 'make it readable' });
  });

  test('@name for a skill that does not exist is left as part of the instruction', () => {
    expect(route('@nobody research this')).toMatchObject({ base: { name: 'page-research' }, text: '@nobody research this' });
  });

  test("site notes ride along when the tab's host matches, the closest domain first", () => {
    expect(route('click sign in', 'https://docs.example.com/start')?.overlays.map((overlay) => overlay.name)).toEqual(['docs-example-com', 'example-com']);
  });

  test('site notes for another site stay out', () => {
    expect(route('click sign in', 'https://notexample.com/')?.overlays).toEqual([]);
  });

  test('site notes with no domains only apply when pinned, and then ride on the base the words chose', () => {
    expect(route('@unscoped-notes research the pricing')).toMatchObject({
      base: { name: 'page-research' },
      overlays: [{ name: 'unscoped-notes' }],
      text: 'research the pricing',
    });
  });

  test('with no skills at all there is nothing to route to', () => {
    expect(routeSkill([], 'click')).toBeNull();
  });
});
