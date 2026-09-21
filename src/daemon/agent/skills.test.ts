import { describe, expect, test } from 'vitest';
import type { RunContext } from '@/lib/actions/protocol';
import { routeSkill, SCRIPTING_SKILL, type Skill } from './skills';

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
