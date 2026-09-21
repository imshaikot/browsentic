import { describe, expect, test } from 'vitest';
import { redactInput } from './redact';

type Redacted = Record<string, any>;
const redact = (action: string, input: object) => redactInput(action, input) as Redacted;
const TAG = 'a1b2c3d4';

describe('redactInput', () => {
  test('fillInput value redacted', () => {
    expect(redact('page.fillInput', { value: 'hunter2' }).value).toBe('[redacted]');
  });

  test('password key redacted', () => {
    expect(redact('page.x', { password: 'p' }).password).toBe('[redacted]');
  });

  test('card number redacted', () => {
    expect(redact('page.x', { note: '4242424242424242' }).note).toBe('[redacted]');
  });

  // The approval asks someone to read this, so it cannot arrive truncated.
  test('injected code survives redaction whole', () => {
    const longCode = `tools.x = () => {${'\n  // padding'.repeat(60)}\n};`;
    expect(redact('page.injectCode', { purpose: 'p', code: longCode }).code).toBe(longCode);
  });

  test('a long value elsewhere is still capped', () => {
    expect(redact('page.x', { note: 'y'.repeat(400) }).note).toHaveLength(201);
  });

  test('benign value kept', () => {
    expect(redact('page.x', { target: { text: 'Sign in' } }).target.text).toBe('Sign in');
  });

  test('long string clipped', () => {
    expect(redact('page.x', { s: 'a'.repeat(500) }).s).toHaveLength(201);
  });

  test('array capped', () => {
    expect(redact('page.x', { a: new Array(100).fill('x') }).a).toHaveLength(21);
  });

  test('deep nest cut', () => {
    expect(redact('page.x', { a: { b: { c: { d: { e: 1 } } } } }).a.b.c.d).toBe('[…]');
  });

  // The panel renders a fillInput value as [redacted], but a handle is public by construction and
  // is the only thing telling someone which site's secret they are about to release.
  test('a sealed handle survives redaction, so the prompt names the site', () => {
    expect(redact('page.fillInput', { value: `x ⟦password:1@mail.example.com#${TAG}⟧ y` }).value).toBe(`⟦password:1@mail.example.com#${TAG}⟧`);
  });

  test('and only the handle survives', () => {
    expect(redact('page.fillInput', { value: `secret-prefix ⟦password:1@a.com#${TAG}⟧` }).value).not.toContain('secret-prefix');
  });
});
