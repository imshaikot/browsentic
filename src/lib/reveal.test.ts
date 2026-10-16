import { describe, expect, it } from 'vitest';

import { paced, wordEnd } from './reveal';

describe('paced', () => {
  it('reveals a short reply at the floor rate', () => {
    expect(paced('x'.repeat(100), 0, 0.1)).toBeCloseTo(30);
  });

  it('drains a large backlog within about a second', () => {
    const text = 'x'.repeat(5_000);
    let progress = 0;
    let seconds = 0;
    while (progress < text.length) {
      progress = paced(text, progress, 1 / 60);
      seconds += 1 / 60;
    }
    expect(seconds).toBeLessThan(4);
    expect(paced(text, 0, 1 / 60)).toBeGreaterThan(5_000 / 0.9 / 60 - 1);
  });

  it('never runs past the text, even when it shrinks', () => {
    expect(paced('abc', 2, 10)).toBe(3);
    expect(paced('abc', 9, 0.1)).toBe(3);
  });
});

describe('wordEnd', () => {
  it('rounds a cut up to the end of the word it lands in', () => {
    expect(wordEnd('hello brave world', 0)).toBe(5);
    expect(wordEnd('hello brave world', 6.2)).toBe(11);
  });

  it('stops at whitespace and reaches the end of an unfinished last word', () => {
    expect(wordEnd('hello world', 5)).toBe(5);
    expect(wordEnd('hello wor', 7)).toBe(9);
    expect(wordEnd('hi', 5)).toBe(2);
  });
});
