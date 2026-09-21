import { mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import type { AgentKind } from '@/lib/agents/catalog';
import { agentSkills, resolveAgentSkill } from './agent-skills';
import { readAgentConfig } from './config';

const claudeSkills = join(homedir(), '.claude', 'skills');
const codexSkills = join(homedir(), '.codex', 'skills');

const config = (agent: AgentKind = 'claude') => ({ ...readAgentConfig(), agent });

const skillFile = (path: string, body: string, fields: Record<string, string> = {}) => {
  mkdirSync(dirname(path), { recursive: true });
  const front = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  writeFileSync(path, front.length ? `---\n${front.join('\n')}\n---\n\n${body}` : body);
  return path;
};

const listed = (agent: AgentKind = 'claude') => agentSkills(config(agent), { refresh: true });
const idOf = (name: string, agent: AgentKind = 'claude') => listed(agent).find((skill) => skill.name === name)?.id ?? '';

beforeEach(() => {
  for (const dir of [join(homedir(), '.claude'), join(homedir(), '.codex'), join(homedir(), 'elsewhere')]) rmSync(dir, { recursive: true, force: true });
});

describe("listing the active agent's own skills", () => {
  test('both a flat file and a folder with SKILL.md count, sorted by name, each with an opaque id', () => {
    skillFile(join(claudeSkills, 'review.md'), 'Review the diff.', { description: 'Reviews code' });
    skillFile(join(claudeSkills, 'deploy', 'SKILL.md'), 'Ship it.', { name: 'deploy-app', description: '"Deploys the app"' });
    expect(listed()).toEqual([
      { id: expect.stringMatching(/^[0-9a-f]{16}$/), name: 'deploy-app', description: 'Deploys the app' },
      { id: expect.stringMatching(/^[0-9a-f]{16}$/), name: 'review', description: 'Reviews code' },
    ]);
  });

  test('hidden files, skills with no body and skills over 48 KB are left out', () => {
    skillFile(join(claudeSkills, '.draft.md'), 'Not yet.');
    skillFile(join(claudeSkills, 'empty.md'), '   ', { description: 'nothing below' });
    truncateSync(skillFile(join(claudeSkills, 'huge.md'), 'x'), 49 * 1024);
    skillFile(join(claudeSkills, 'kept.md'), 'Do the thing.');
    expect(listed().map((skill) => skill.name)).toEqual(['kept']);
  });

  test('a name or description is cleaned of control characters and cut to length before it reaches the panel', () => {
    skillFile(join(claudeSkills, 'x.md'), 'Body.', { name: `badname`, description: 'd'.repeat(300) });
    expect(listed()[0]).toMatchObject({ name: 'bad name', description: 'd'.repeat(200) });
  });

  test('a skill folder that is a symlink counts', () => {
    skillFile(join(homedir(), 'elsewhere', 'linked', 'SKILL.md'), 'Linked body.');
    mkdirSync(claudeSkills, { recursive: true });
    symlinkSync(join(homedir(), 'elsewhere', 'linked'), join(claudeSkills, 'linked'));
    expect(listed().map((skill) => skill.name)).toEqual(['linked']);
  });

  test('a new skill appears on refresh, and the listing is reused for half a minute otherwise', () => {
    skillFile(join(claudeSkills, 'first.md'), 'One.');
    listed();
    skillFile(join(claudeSkills, 'second.md'), 'Two.');
    expect([agentSkills(config()).length, listed().length]).toEqual([1, 2]);
  });

  test('only the first hundred are listed', () => {
    for (let i = 0; i < 105; i++) skillFile(join(claudeSkills, `skill-${String(i).padStart(3, '0')}.md`), 'Body.');
    expect(listed()).toHaveLength(100);
  });

  test("each agent lists from its own directories, and one with none lists nothing", () => {
    skillFile(join(claudeSkills, 'claude-only.md'), 'Body.');
    skillFile(join(codexSkills, 'codex-only.md'), 'Body.');
    expect([listed('codex').map((skill) => skill.name), listed('antigravity')]).toEqual([['codex-only'], []]);
  });
});

describe('attaching one to a message', () => {
  test('an id from the listing resolves to the skill, re-read at that moment, without its front matter', () => {
    const path = skillFile(join(claudeSkills, 'review.md'), 'Old body.', { description: 'Reviews code' });
    const id = idOf('review');
    skillFile(path, 'New body.', { description: 'Reviews code' });
    expect(resolveAgentSkill(id, config())).toEqual({ skill: { name: 'review', body: 'New body.' } });
  });

  test('an id that is not one the daemon issues never reaches the disk', () => {
    expect(resolveAgentSkill('../../.ssh/id_rsa', config())).toMatchObject({ error: { code: 'SKILL_UNKNOWN' } });
  });

  test('a well-formed id nobody was given is unknown', () => {
    expect(resolveAgentSkill('0123456789abcdef', config())).toMatchObject({ error: { code: 'SKILL_UNKNOWN' } });
  });

  test("after switching agents, the old agent's skills no longer resolve", () => {
    skillFile(join(claudeSkills, 'review.md'), 'Body.');
    const id = idOf('review');
    expect(resolveAgentSkill(id, config('codex'))).toMatchObject({ error: { code: 'SKILL_UNKNOWN' } });
  });

  test('a skill deleted since it was listed is unknown', () => {
    const path = skillFile(join(claudeSkills, 'gone.md'), 'Body.');
    const id = idOf('gone');
    rmSync(path);
    expect(resolveAgentSkill(id, config())).toMatchObject({ error: { code: 'SKILL_UNKNOWN' } });
  });

  test('a skill emptied since it was listed is unknown', () => {
    const path = skillFile(join(claudeSkills, 'hollow.md'), 'Body.');
    const id = idOf('hollow');
    writeFileSync(path, '---\nname: hollow\n---\n\n');
    expect(resolveAgentSkill(id, config())).toMatchObject({ error: { code: 'SKILL_UNKNOWN' } });
  });

  test('a skill that grew past 48 KB since it was listed says so', () => {
    const path = skillFile(join(claudeSkills, 'grown.md'), 'Body.');
    const id = idOf('grown');
    truncateSync(path, 49 * 1024);
    expect(resolveAgentSkill(id, config())).toEqual({
      error: { code: 'SKILL_UNKNOWN', message: 'The skill "grown" grew past 48 KB, so it was not attached.' },
    });
  });

  test('a skill whose file became a folder is unknown', () => {
    const path = skillFile(join(claudeSkills, 'shape.md'), 'Body.');
    const id = idOf('shape');
    rmSync(path);
    mkdirSync(path);
    expect(resolveAgentSkill(id, config())).toMatchObject({ error: { code: 'SKILL_UNKNOWN' } });
  });
});
