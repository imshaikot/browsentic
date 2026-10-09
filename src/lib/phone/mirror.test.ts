import { describe, expect, test } from 'vitest';
import { addressOf, isMirrorKey, keyEvents, touchPoint } from './mirror';

describe('a click on the mirror', () => {
  test('lands where spike Q8 measured it: the frame is the visual viewport, scaled by the zoom', () => {
    const image = { width: 720, height: 1182 };
    expect(touchPoint({ x: 0.5, y: 0.5 }, { deviceWidth: 411, pageScaleFactor: 1 }, image)).toEqual({ x: 205.5, y: (411 * 1182) / 720 / 2 });
    expect(touchPoint({ x: 1, y: 0 }, { deviceWidth: 411, pageScaleFactor: 2 }, image)).toEqual({ x: 205.5, y: 0 });
  });

  test('a frame squeezed by the soft keyboard keeps the x scale and shortens the y range', () => {
    const point = touchPoint({ x: 0.25, y: 1 }, { deviceWidth: 411, pageScaleFactor: 1 }, { width: 720, height: 531 });
    expect(point.x).toBeCloseTo(102.75);
    expect(point.y).toBeCloseTo(303.1, 1);
  });
});

describe('keys on the mirror', () => {
  test('Enter submits as keyDown with its text', () => {
    expect(keyEvents('Enter')).toEqual([
      { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' },
      { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
    ]);
  });

  test('Backspace and the arrows carry their virtual key code, without which nothing edits', () => {
    expect(keyEvents('Backspace')[0]).toMatchObject({ type: 'rawKeyDown', windowsVirtualKeyCode: 8 });
    expect(keyEvents('ArrowDown')[0]).toMatchObject({ type: 'rawKeyDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  });

  test('only the named keys are keys; everything printable is text', () => {
    expect(isMirrorKey('Tab')).toBe(true);
    expect(isMirrorKey('a')).toBe(false);
    expect(isMirrorKey('F5')).toBe(false);
  });
});

describe('the address bar', () => {
  test.each([
    ['https://example.com/a', 'https://example.com/a'],
    ['example.com', 'https://example.com'],
    ['news.ycombinator.com/item?id=1', 'https://news.ycombinator.com/item?id=1'],
    ['localhost:8080/x', 'https://localhost:8080/x'],
    ['about:blank', 'about:blank'],
    ['cheap flights to lisbon', 'https://www.google.com/search?q=cheap%20flights%20to%20lisbon'],
  ])('%s', (typed, url) => {
    expect(addressOf(typed)).toBe(url);
  });
});
