import { describe, expect, test } from 'vitest';
import { brandFrom } from './identity';

const chromium = { brand: 'Chromium' };
const placeholder = { brand: 'Not/A)Brand' };

describe("naming the browser from the brands it reports", () => {
  test('the product wins over the engine and over the placeholder Chromium shuffles in', () => {
    const named = [
      brandFrom([placeholder, chromium, { brand: 'Google Chrome' }]),
      brandFrom([{ brand: 'Brave' }, chromium, { brand: 'Not;A=Brand' }]),
      brandFrom([chromium, { brand: 'Microsoft Edge' }, { brand: 'Not_A Brand' }]),
    ];
    expect(named).toEqual(['Google Chrome', 'Brave', 'Microsoft Edge']);
  });

  test('a build that reports only the engine is called Chromium', () => {
    expect(brandFrom([placeholder, chromium])).toBe('Chromium');
  });

  test('a browser that reports nothing is left unnamed', () => {
    expect(brandFrom([])).toBeUndefined();
  });
});
