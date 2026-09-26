import { describe, expect, it } from 'vitest';
import { isHandsFreeCommand } from './commands';

describe('isHandsFreeCommand', () => {
  it('takes the command and the spellings people reach for', () => {
    for (const typed of ['/hands-free', '/hand-free', '/handsfree', '  /Hands-Free ']) {
      expect(isHandsFreeCommand(typed)).toBe(true);
    }
  });

  it('leaves an instruction that merely mentions it alone', () => {
    expect(isHandsFreeCommand('/hands-free please')).toBe(false);
    expect(isHandsFreeCommand('hands-free')).toBe(false);
  });
});
