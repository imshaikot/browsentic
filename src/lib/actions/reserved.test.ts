import { describe, expect, test } from 'vitest';
import { RESERVED_ACTIONS, RESERVED_PREFIX } from './reserved';

describe('reserved actions', () => {
  test('reserved prefix ends with a dot', () => {
    expect(RESERVED_PREFIX.endsWith('.')).toBe(true);
  });

  test('reserved prefix has no underscore', () => {
    expect(RESERVED_PREFIX).not.toContain('_');
  });

  for (const name of RESERVED_ACTIONS) {
    test(`${name} carries the reserved prefix`, () => {
      expect(name.startsWith(RESERVED_PREFIX)).toBe(true);
    });
  }
});
