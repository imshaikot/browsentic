import { describe, expect, test } from 'vitest';
import { decide } from './decide';
import { policyFrom } from './policy';
import { scopeFor } from './scope';
import { guardrailSettings, settingWritable } from './settings';

// The tab writes overrides, not switches that turn protection on. An untouched install has none,
// so the shipped posture never depends on someone having opened it.
describe('an untouched install', () => {
  const untouched = guardrailSettings({}, ['page.submitForm'], '/tmp/config.json');
  const locked = untouched.rules.filter((rule) => rule.locked);

  test('a untouched install overrides nothing', () => {
    expect(untouched.rules.filter((rule) => rule.override !== undefined)).toHaveLength(0);
  });

  test('and every switch reads as off', () => {
    expect([untouched.fence.overridden, untouched.unattended.overridden]).toEqual([false, false]);
  });

  test('the screen lists every rule', () => {
    expect(untouched.rules).toHaveLength(policyFrom().rules.length);
  });

  test('each row falls back to the shipped effect', () => {
    expect(untouched.rules.every((row, at) => row.fallback === policyFrom().rules[at].effect)).toBe(true);
  });

  test('rows carry the reason the agent is given', () => {
    expect(untouched.rules.every((row) => row.reason.length > 0)).toBe(true);
  });

  test('the structural rules are locked', () => {
    expect(locked.map((rule) => rule.id)).toEqual(['reserved-action', 'non-http-navigation', 'unreadable-navigation', 'secret-in-url']);
  });

  test('every locked rule denies', () => {
    expect(locked.every((rule) => rule.fallback === 'deny')).toBe(true);
  });

  for (const { id } of locked) {
    test(`the panel cannot write ${id}`, () => {
      expect(settingWritable(id, 'allow')).toBe(false);
    });
  }
});

describe('what the panel may write', () => {
  test('an unlocked rule is writable', () => {
    expect(settingWritable('form-submission', 'allow')).toBe(true);
  });

  test('clearing an override is writable', () => {
    expect(settingWritable('form-submission', null)).toBe(true);
  });

  test('a rule that does not exist is refused', () => {
    expect(settingWritable('made-up-rule', 'allow')).toBe(false);
  });

  test('a rule cannot take a boolean', () => {
    expect(settingWritable('form-submission', true)).toBe(false);
  });

  test('fence takes a boolean', () => {
    expect([settingWritable('fence', false), settingWritable('fence', 'deny')]).toEqual([true, false]);
  });

  test('unattended takes a side', () => {
    expect([settingWritable('unattended', 'allow'), settingWritable('unattended', 'confirm')]).toEqual([true, false]);
  });
});

describe('an overridden install', () => {
  const overridden = guardrailSettings({ rules: { 'form-submission': 'allow' }, fence: false, unattended: 'allow' }, ['page.submitForm'], '/tmp/config.json');
  const formSubmission = overridden.rules.find((rule) => rule.id === 'form-submission');

  test('an override is reported as one', () => {
    expect(formSubmission?.override).toBe('allow');
  });

  test('while its fallback still shows the default', () => {
    expect(formSubmission?.fallback).toBe('confirm');
  });

  test('a fenced-off install says so', () => {
    expect([overridden.fence.enabled, overridden.fence.overridden]).toEqual([false, true]);
  });

  test('an unattended override says so', () => {
    expect([overridden.unattended.effect, overridden.unattended.overridden]).toEqual(['allow', true]);
  });

  test('an override the panel renders matches what decide() does', () => {
    const scope = scopeFor({ url: 'https://example.com/', tabId: 3, pinTab: true });
    expect(decide({ action: 'page.submitForm', input: {}, caller: 'agent', scope }, policyFrom({ rules: { 'form-submission': 'allow' } })).effect).toBe('allow');
  });
});

// `form-submission` takes its default from the legacy key, so the row has to as well or the
// screen would claim a default the policy does not use.
describe('the legacy requireApproval key', () => {
  const formRow = (requireApproval: string[]) =>
    guardrailSettings({}, requireApproval, '/tmp/c.json').rules.find((rule) => rule.id === 'form-submission');

  test('the legacy key moves the fallback', () => {
    expect(formRow([])?.fallback).toBe('allow');
  });

  test('and leaves it alone when set', () => {
    expect(formRow(['page.submitForm'])?.fallback).toBe('confirm');
  });
});
