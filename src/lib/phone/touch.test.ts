import { describe, expect, test } from 'vitest';
import { drag, keyPress, onScreen, tap, typing, wheel } from './touch';

const VIEWPORT = { offsetX: 0, offsetY: 0, width: 411, height: 675 };

describe('where a touch lands', () => {
  test('a page point less the visual viewport’s offset, unscaled by the zoom', () => {
    expect(onScreen({ x: 250, y: 400 }, { ...VIEWPORT, offsetX: 50, offsetY: 100, width: 205, height: 337 })).toEqual({ x: 200, y: 300 });
  });

  test('a point off the visible screen is no touch at all', () => {
    expect(onScreen({ x: 100, y: 700 }, VIEWPORT)).toBeNull();
    expect(onScreen({ x: -1, y: 10 }, VIEWPORT)).toBeNull();
  });
});

describe('gestures', () => {
  test('a tap is a touch held 50 ms, then lifted', () => {
    expect(tap({ x: 10, y: 20 })).toEqual([
      { method: 'Input.dispatchTouchEvent', params: { type: 'touchStart', touchPoints: [{ x: 10, y: 20 }] }, waitMs: 50 },
      { method: 'Input.dispatchTouchEvent', params: { type: 'touchEnd', touchPoints: [] }, waitMs: undefined },
    ]);
  });

  test('a drag moves in steps and holds 120 ms at the drop before lifting, so nothing flings on', () => {
    const steps = drag({ x: 0, y: 0 }, { x: 0, y: 300 }, 3);
    expect(steps.map(({ params }) => [params.type, (params.touchPoints as { y: number }[])[0]?.y])).toEqual([
      ['touchStart', 0],
      ['touchMove', 100],
      ['touchMove', 200],
      ['touchMove', 300],
      ['touchEnd', undefined],
    ]);
    expect(steps.at(-2)?.waitMs).toBe(120);
  });

  test('scrolling by an amount is wheel steps of 120 that add up exactly', () => {
    const steps = wheel({ x: 200, y: 300 }, 600);
    expect(steps).toHaveLength(5);
    expect(steps.every(({ params }) => params.type === 'mouseWheel' && params.deltaY === 120)).toBe(true);
    expect(wheel({ x: 0, y: 0 }, -250).reduce((sum, { params }) => sum + Number(params.deltaY), 0)).toBe(-250);
  });
});

describe('keys and text', () => {
  test('Enter submits as keyDown with its text', () => {
    expect(keyPress('Enter')[0].params).toMatchObject({ type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  });

  test('Backspace carries its virtual key code, without which nothing is deleted', () => {
    expect(keyPress('Backspace')[0].params).toMatchObject({ type: 'rawKeyDown', code: 'Backspace', windowsVirtualKeyCode: 8 });
    expect(keyPress('Backspace')[0].params.text).toBeUndefined();
  });

  test('a printable key types itself, and a shortcut types nothing', () => {
    expect(keyPress('a')[0].params).toMatchObject({ type: 'keyDown', text: 'a', code: 'KeyA', modifiers: 0 });
    expect(keyPress('a', ['ctrl'])[0].params).toMatchObject({ type: 'rawKeyDown', modifiers: 2 });
    expect(keyPress('A', ['shift'])[0].params).toMatchObject({ type: 'keyDown', text: 'A', modifiers: 8 });
  });

  test('typing inserts text in chunks, and a newline is an Enter press', () => {
    const steps = typing('héllo 👋\nsecond line');
    expect(steps.map(({ method, params }) => (method === 'Input.insertText' ? params.text : params.type))).toEqual(['héllo 👋', 'keyDown', 'keyUp', 'second line']);
    expect(typing('x'.repeat(150)).map(({ params }) => String(params.text).length)).toEqual([64, 64, 22]);
  });
});
