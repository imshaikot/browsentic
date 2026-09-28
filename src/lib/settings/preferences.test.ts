import { describe, expect, test } from 'vitest';
import { isPreferenceChange } from './preferences';

describe('what a settings screen may ask the daemon to change', () => {
  test('a theme the extension has, a guardrail set to an effect, a switch or back to its default, and a whole profile', () => {
    const changes = [
      { kind: 'theme', theme: 'phosphor' },
      { kind: 'guardrail', setting: 'form-submission', value: 'confirm' },
      { kind: 'guardrail', setting: 'fence', value: false },
      { kind: 'guardrail', setting: 'file-upload', value: null },
      { kind: 'profile', profile: { fields: { email: 'ada@example.com' }, details: [], instructions: 'Be brief.' } },
    ];
    expect(changes.map(isPreferenceChange)).toEqual([true, true, true, true, true]);
  });

  test('anything else is refused before it reaches config.json', () => {
    const changes = [
      null,
      'theme',
      { kind: 'theme', theme: 'solarized' },
      { kind: 'guardrail', setting: 'form-submission', value: 'sometimes' },
      { kind: 'guardrail', value: 'allow' },
      { kind: 'agent', agent: 'codex' },
      { kind: 'profile', profile: { fields: { nickname: 'Ada' }, details: [], instructions: '' } },
      { kind: 'profile' },
    ];
    expect(changes.map(isPreferenceChange)).toEqual(changes.map(() => false));
  });
});
