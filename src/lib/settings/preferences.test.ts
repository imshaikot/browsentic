import { describe, expect, test } from 'vitest';
import { isPreferenceChange } from './preferences';

describe('what a settings screen may ask the daemon to change', () => {
  test('a theme the extension has, and a guardrail set to an effect, a switch or back to its default', () => {
    const changes = [
      { kind: 'theme', theme: 'phosphor' },
      { kind: 'guardrail', setting: 'form-submission', value: 'confirm' },
      { kind: 'guardrail', setting: 'fence', value: false },
      { kind: 'guardrail', setting: 'file-upload', value: null },
    ];
    expect(changes.map(isPreferenceChange)).toEqual([true, true, true, true]);
  });

  test('anything else is refused before it reaches config.json', () => {
    const changes = [
      null,
      'theme',
      { kind: 'theme', theme: 'solarized' },
      { kind: 'guardrail', setting: 'form-submission', value: 'sometimes' },
      { kind: 'guardrail', value: 'allow' },
      { kind: 'agent', agent: 'codex' },
    ];
    expect(changes.map(isPreferenceChange)).toEqual([false, false, false, false, false, false]);
  });
});
