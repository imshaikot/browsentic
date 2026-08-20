import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { cssPath, describeElement, resolveTarget, targetSchema } from './dom';
import {
  APPROACH_STEPS,
  approachPoint,
  assertUncovered,
  elementAt,
  elementPoint,
  hoverSequence,
  pathBetween,
  pointSchema,
  viewportPoint,
  type Point,
} from './pointer';

const FRAME_MS = 16;

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DragPath {
  approach: Point;
  grip: Point;
  drop: Point;
  steps: number;
  holdMs: number;
  settleMs: number;
}

function mouseInit(at: Point, buttons: number) {
  return {
    clientX: at.x,
    clientY: at.y,
    button: 0,
    buttons,
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
}

function firePointer(el: Element | null, pointerType: string, mouseType: string, at: Point, buttons: number): void {
  const init = mouseInit(at, buttons);
  el?.dispatchEvent(new PointerEvent(pointerType, init));
  el?.dispatchEvent(new MouseEvent(mouseType, init));
}

function fireDrag(el: Element | null, type: string, at: Point, dataTransfer: DataTransfer): boolean {
  return el?.dispatchEvent(new DragEvent(type, { ...mouseInit(at, 1), dataTransfer })) ?? false;
}

function dropPoint(el: HTMLElement): Point {
  try {
    return elementPoint(el);
  } catch {
    throw new ActionError(
      'The drop target is not inside the viewport — both ends of a drag have to be on screen at once, because nothing scrolls mid-drag. Scroll until both are visible, then retry',
      'INVALID_TARGET',
    );
  }
}

async function travel(from: Point, to: Point, steps: number, buttons: number, onStep?: (at: Point) => void) {
  for (const at of pathBetween(from, to, steps)) {
    await settle(FRAME_MS);
    if (onStep) onStep(at);
    else firePointer(elementAt(at), 'pointermove', 'mousemove', at, buttons);
  }
}

async function approachFrom(start: Point, grip: Point, over: Element | null) {
  await travel(start, grip, APPROACH_STEPS, 0);
  hoverSequence(over ?? document.body, grip);
}

async function pointerDrag(source: Element | null, plan: DragPath) {
  const { approach: start, grip, drop, steps, holdMs, settleMs } = plan;
  const held = source ?? elementAt(grip);
  await approachFrom(start, grip, held);
  firePointer(held, 'pointerdown', 'mousedown', grip, 1);
  await settle(holdMs);
  await travel(grip, drop, steps, 1);
  await settle(settleMs);
  const landing = elementAt(drop);
  firePointer(landing ?? held, 'pointerup', 'mouseup', drop, 0);
  return { landedOn: landing ? cssPath(landing) : undefined };
}

async function nativeDrag(source: HTMLElement, plan: DragPath) {
  const { approach: start, grip, drop, steps, holdMs, settleMs } = plan;
  const dataTransfer = new DataTransfer();
  await approachFrom(start, grip, source);
  firePointer(source, 'pointerdown', 'mousedown', grip, 1);
  await settle(holdMs);
  const started = fireDrag(source, 'dragstart', grip, dataTransfer);

  let accepted = false;
  let entered: Element | null = null;
  await travel(grip, drop, steps, 1, (at) => {
    const over = elementAt(at);
    if (over !== entered) {
      fireDrag(entered, 'dragleave', at, dataTransfer);
      fireDrag(over, 'dragenter', at, dataTransfer);
      entered = over;
    }
    if (over && !fireDrag(over, 'dragover', at, dataTransfer)) accepted = true;
  });

  await settle(settleMs);
  const landing = elementAt(drop);
  fireDrag(landing, 'drop', drop, dataTransfer);
  fireDrag(source, 'dragend', drop, dataTransfer);
  return { landedOn: landing ? cssPath(landing) : undefined, started, accepted };
}

export const dragElement = defineAction({
  name: 'page.dragElement',
  description:
    'Drag one thing onto another — reorder a list, move a card between columns, pull a slider handle, draw on a canvas. Give a "from" element (or "fromPoint") to pick up and a "to" element (or "toPoint") to drop on. Both ends must be on screen at the same moment, because nothing auto-scrolls mid-drag. The web has two unrelated drag mechanisms and "auto" chooses between them by reading the grabbed element: "pointer" presses, moves and releases a pointer, which is what dnd-kit, react-beautiful-dnd, sliders and canvases listen for; "native" fires the HTML5 dragstart/dragover/drop sequence with a DataTransfer, which is what an element carrying draggable="true" expects. The drop point is measured before the drag starts, so a list that reflows as you pass over it can land a slot out — raise "steps" and "settleMs", then read the result back. Set "trusted" when the page ignores synthetic events; that path is pointer-only, Chrome-only, and shows the “Browsentic is debugging this browser” bar. If nothing moved, check "accepted" and try the other mode.',
  input: z.object({
    from: targetSchema
      .optional()
      .describe('Element to pick up — the card, row, or drag handle. Give this or "fromPoint", never both.'),
    fromPoint: pointSchema
      .optional()
      .describe('Viewport coordinates to grab from, in CSS pixels. Use it when the grip is not an element, such as a spot on a <canvas>.'),
    to: targetSchema
      .optional()
      .describe('Element to drop onto — the destination column, list slot, or drop zone. Give this or "toPoint", never both.'),
    toPoint: pointSchema
      .optional()
      .describe('Viewport coordinates to drop at, in CSS pixels. Use it to reach empty space, a slider position, or a spot on a <canvas>.'),
    mode: z
      .enum(['auto', 'pointer', 'native'])
      .default('auto')
      .describe('Which drag mechanism to use. "auto" picks "native" when the grabbed element declares draggable="true", "pointer" otherwise.'),
    steps: z
      .number()
      .int()
      .min(2)
      .max(60)
      .default(16)
      .describe('Moves dispatched along the way to the drop point. Raise it for lists that reorder as the pointer passes over them.'),
    holdMs: z
      .number()
      .int()
      .min(0)
      .max(5000)
      .default(120)
      .describe('How long the button stays down before the drag starts moving. Raise it past a library’s press-and-hold delay.'),
    settleMs: z
      .number()
      .int()
      .min(0)
      .max(5000)
      .default(120)
      .describe('Pause on the drop point before releasing, letting the page settle on where the item would land.'),
    trusted: z
      .boolean()
      .default(false)
      .describe('Dispatch real browser-level mouse events, so isTrusted is true. Pointer mode only, Chrome only.'),
    scrollIntoView: z.boolean().default(true).describe('Bring the grabbed element into view first. Ignored with "fromPoint".'),
  }),
  async execute({ from, fromPoint, to, toPoint, mode, steps, holdMs, settleMs, trusted, scrollIntoView }) {
    if (!from === !fromPoint) {
      throw new ActionError('Give either a "from" target to pick up or a "fromPoint" to grab at — not both, not neither', 'INVALID_INPUT');
    }
    if (!to === !toPoint) {
      throw new ActionError('Give either a "to" target to drop onto or a "toPoint" to drop at — not both, not neither', 'INVALID_INPUT');
    }

    const source = from ? resolveTarget(from) : null;
    const destination = to ? resolveTarget(to) : null;
    if (source && scrollIntoView) source.scrollIntoView({ block: 'center', behavior: 'instant' });

    const grip = source ? elementPoint(source) : viewportPoint(fromPoint!);
    if (source) assertUncovered(source, grip);
    const drop = destination ? dropPoint(destination) : viewportPoint(toPoint!);

    const declared = source?.closest<HTMLElement>('[draggable="true"]') ?? null;
    const mechanism = mode === 'auto' ? (declared ? 'native' : 'pointer') : mode;

    if (mechanism === 'native' && trusted) {
      throw new ActionError(
        'A trusted drag sends real mouse events, which cannot drive HTML5 drag-and-drop — drop "trusted", or set mode to "pointer" if the page also listens for pointer drags',
        'INVALID_INPUT',
      );
    }
    if (mechanism === 'native' && !source) {
      throw new ActionError(
        'HTML5 drag-and-drop starts on an element, so coordinates cannot fire dragstart — give a "from" target, or set mode to "pointer"',
        'INVALID_INPUT',
      );
    }

    const path: DragPath = { approach: approachPoint(grip), grip, drop, steps, holdMs, settleMs };
    const plan = {
      from: source ? describeElement(source) : undefined,
      to: destination ? describeElement(destination) : undefined,
      mechanism,
      ...path,
    };
    if (trusted) return plan;

    const outcome = mechanism === 'native' ? await nativeDrag(declared ?? source!, path) : await pointerDrag(source, path);
    return { ...plan, ...outcome, trusted: false };
  },
});
