import { beforeEach, describe, expect, test } from 'vitest';
import { screenshot } from './screenshot';

const longSide = (input: Record<string, unknown> = {}) =>
  (screenshot.execute(screenshot.input.parse(input)) as { maxLongSide: number }).maxLongSide;

beforeEach(() => {
  Object.assign(window, { innerWidth: 1084, innerHeight: 738, devicePixelRatio: 2 });
});

describe('how large a capture comes back when nobody says', () => {
  test('a viewport capture to look at is one image pixel per page pixel; a kept, full-page or oversized one is capped at 1600', () => {
    expect([longSide(), longSide({ save: true }), longSide({ fullPage: true })]).toEqual([1084, 1600, 1600]);
    Object.assign(window, { innerWidth: 2560, innerHeight: 1300 });
    expect(longSide()).toBe(1600);
  });

  test('an explicit size wins', () => {
    expect([longSide({ maxLongSide: 800 }), longSide({ maxLongSide: 3000, save: true })]).toEqual([800, 3000]);
  });
});
