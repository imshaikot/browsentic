import { keyboardInit, type Modifier } from '@/lib/actions/page/keyboard';

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  /** The visual viewport's offset into the layout viewport, as `Page.getLayoutMetrics` gives it. */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** One CDP input event, and how long to wait before the next. */
export interface InputStep {
  method: 'Input.dispatchTouchEvent' | 'Input.dispatchMouseEvent' | 'Input.dispatchKeyEvent' | 'Input.insertText';
  params: Record<string, unknown>;
  waitMs?: number;
}

const TAP_HOLD_MS = 50;
const DRAG_STEP_MS = 16;
/** A drag that ends without a pause flings on: 500 px dragged scrolled 587 (spike Q6). */
const DRAG_HOLD_MS = 120;
const WHEEL_STEP = 120;
const TEXT_CHUNK = 64;

/**
 * Where a page point lands for a touch: CSS px from the visual viewport's corner, never scaled by
 * the zoom (spike Q5). Null when it is off the visible part of the screen, where Chrome would still
 * deliver it without complaint.
 */
export function onScreen(point: Point, viewport: Viewport): Point | null {
  const x = point.x - viewport.offsetX;
  const y = point.y - viewport.offsetY;
  return x >= 0 && y >= 0 && x <= viewport.width && y <= viewport.height ? { x, y } : null;
}

const touch = (type: string, at?: Point, waitMs?: number): InputStep => ({
  method: 'Input.dispatchTouchEvent',
  params: { type, touchPoints: at ? [{ x: at.x, y: at.y }] : [] },
  waitMs,
});

export const tap = (at: Point): InputStep[] => [touch('touchStart', at, TAP_HOLD_MS), touch('touchEnd')];

export function drag(from: Point, to: Point, steps: number): InputStep[] {
  const moves = Array.from({ length: Math.max(1, steps) }, (_, index) => {
    const t = (index + 1) / Math.max(1, steps);
    return touch('touchMove', { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, DRAG_STEP_MS);
  });
  const hold = moves[moves.length - 1];
  return [touch('touchStart', from, DRAG_STEP_MS), ...moves.slice(0, -1), { ...hold, waitMs: DRAG_HOLD_MS }, touch('touchEnd')];
}

/** Scrolling by an amount is mouse wheels: exact, and later taps keep their pointer events, which a synthesized scroll gesture takes away once the page is zoomed (spike Q6). */
export function wheel(at: Point, deltaY: number): InputStep[] {
  const count = Math.max(1, Math.ceil(Math.abs(deltaY) / WHEEL_STEP));
  const step = deltaY / count;
  return Array.from({ length: count }, () => ({
    method: 'Input.dispatchMouseEvent' as const,
    params: { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: step },
    waitMs: DRAG_STEP_MS,
  }));
}

const MODIFIER_BITS: Record<Modifier, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/** Enter submits only as `keyDown` with its text, Backspace edits only with its virtual key code, printable keys are `keyDown` with text (spike Q7). */
export function keyPress(key: string, modifiers: Modifier[] = []): InputStep[] {
  const { code, keyCode } = keyboardInit(key, modifiers);
  const mask = modifiers.reduce((bits, modifier) => bits | MODIFIER_BITS[modifier], 0);
  const plain = mask === 0 || mask === MODIFIER_BITS.shift;
  const text = key === 'Enter' ? '\r' : key.length === 1 && plain ? key : undefined;
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: mask };
  return [
    { method: 'Input.dispatchKeyEvent', params: { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text, unmodifiedText: text } : {}) } },
    { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...base } },
  ];
}

/** Text goes in as `Input.insertText`, which types accents and emoji; a newline is an Enter press. */
export function typing(text: string): InputStep[] {
  return text.split('\n').flatMap((line, index) => [
    ...(index ? keyPress('Enter') : []),
    ...(line.match(new RegExp(`[\\s\\S]{1,${TEXT_CHUNK}}`, 'gu')) ?? []).map((chunk): InputStep => ({ method: 'Input.insertText', params: { text: chunk } })),
  ]);
}
