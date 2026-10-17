import { describe, expect, it } from 'vitest';
import { greeting } from './greeting';

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(greeting(3)).toBe('Hello');
    expect(greeting(5)).toBe('Good morning');
    expect(greeting(11)).toBe('Good morning');
    expect(greeting(12)).toBe('Good afternoon');
    expect(greeting(18)).toBe('Good evening');
    expect(greeting(23)).toBe('Good evening');
  });

  it('uses the first name from the profile when there is one', () => {
    expect(greeting(9, 'Ada')).toBe('Good morning, Ada');
    expect(greeting(9, '  ')).toBe('Good morning');
  });
});
