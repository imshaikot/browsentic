import { browser } from 'wxt/browser';
import { invokeInTab } from '@/lib/actions/client';
import { dragElement } from '@/lib/actions/page/drag-element';
import { APPROACH_STEPS, pathBetween, type Point } from '@/lib/actions/page/pointer';
import { trustedClick } from '@/lib/actions/page/trusted-click';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { OVERLAY_ATTRIBUTE } from '@/lib/overlay';
import { send, settle, withDebugger, type DebuggerSession } from './cdp';
import { FRAME_GONE_HINT, frameOffset } from './frame-focus';

const MODIFIER_BIT: Record<string, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const BUTTON_BIT: Record<string, number> = { left: 1, right: 2, middle: 4 };

const MOVE_INTERVAL_MS = 12;

export interface ClickPlan {
  point: Point;
  from: Point;
  button: 'left' | 'right' | 'middle';
  clickCount: number;
  modifiers: string[];
  moveSteps: number;
  hoverMs: number;
  holdMs: number;
}

export interface DragPlan {
  approach: Point;
  grip: Point;
  drop: Point;
  steps: number;
  holdMs: number;
  settleMs: number;
}

const FIREFOX_HINT =
  'A trusted click needs Chrome’s debugger, which Firefox does not expose — use page.clickElement instead.';

const FIREFOX_DRAG_HINT =
  'A trusted drag needs Chrome’s debugger, which Firefox does not expose — drop "trusted" to drag with synthetic events instead.';

export function trustedClickInTab(tabId: number, input: unknown): Promise<ActionResult> {
  return withDebugger(tabId, FIREFOX_HINT, async (session) => {
    const planned = await invokeInTab(tabId, trustedClick.name, input);
    if (!planned.ok) return planned;
    const offset = await frameOffset(tabId);
    if (!offset) return failure('TAB_UNREACHABLE', `The click could not be placed — ${FRAME_GONE_HINT}`);
    const plan = planned.data as ClickPlan;
    await throughOverlays(tabId, () =>
      dispatchClick(session, { ...plan, point: shifted(plan.point, offset), from: shifted(plan.from, offset) }),
    );
    return success({ ...(planned.data as object), trusted: true });
  });
}

export function dragInTab(tabId: number, input: unknown): Promise<ActionResult> {
  return withDebugger(tabId, FIREFOX_DRAG_HINT, async (session) => {
    const planned = await invokeInTab(tabId, dragElement.name, input);
    if (!planned.ok) return planned;
    const offset = await frameOffset(tabId);
    if (!offset) return failure('TAB_UNREACHABLE', `The drag could not be placed — ${FRAME_GONE_HINT}`);
    const plan = planned.data as DragPlan;
    await throughOverlays(tabId, () =>
      dispatchDrag(session, {
        ...plan,
        approach: shifted(plan.approach, offset),
        grip: shifted(plan.grip, offset),
        drop: shifted(plan.drop, offset),
      }),
    );
    return success({ ...(planned.data as object), trusted: true });
  });
}

const shifted = (at: Point, by: Point): Point => ({ x: at.x + by.x, y: at.y + by.y });

/**
 * A real pointer lands on whatever is on top, and the hands-free mic, the rail or a toast may be
 * over the target. Inert for the length of the gesture, they let it through to the page, and an
 * agent's click can never press the mic's own stop.
 */
async function throughOverlays(tabId: number, gesture: () => Promise<void>): Promise<void> {
  await markOverlaysInert(tabId, true);
  try {
    await gesture();
  } finally {
    await markOverlaysInert(tabId, false);
  }
}

async function markOverlaysInert(tabId: number, inert: boolean): Promise<void> {
  await browser.scripting
    .executeScript({
      target: { tabId },
      func: (attribute: string, on: boolean) => {
        for (const host of document.querySelectorAll(`[${attribute}]`)) host.toggleAttribute('inert', on);
      },
      args: [OVERLAY_ATTRIBUTE, inert],
    })
    .catch(() => undefined);
}

export async function dispatchClick(session: DebuggerSession, plan: ClickPlan): Promise<void> {
  const { point, from, button, clickCount, modifiers, moveSteps, hoverMs, holdMs } = plan;
  const held = modifiers.reduce((mask, name) => mask | (MODIFIER_BIT[name] ?? 0), 0);
  const base = { modifiers: held, pointerType: 'mouse' };
  const dispatch = (params: Record<string, unknown>) => send(session, 'Input.dispatchMouseEvent', params);
  const moveTo = (at: Point) => dispatch({ ...base, ...at, type: 'mouseMoved', button: 'none', buttons: 0 });

  await moveTo(from);
  for (const at of pathBetween(from, point, moveSteps)) {
    await settle(MOVE_INTERVAL_MS);
    await moveTo(at);
  }
  await settle(hoverMs);

  for (let count = 1; count <= clickCount; count += 1) {
    await dispatch({ ...base, ...point, type: 'mousePressed', button, buttons: BUTTON_BIT[button], clickCount: count });
    await settle(holdMs);
    await dispatch({ ...base, ...point, type: 'mouseReleased', button, buttons: 0, clickCount: count });
  }
}

export async function dispatchDrag(session: DebuggerSession, plan: DragPlan): Promise<void> {
  const { approach, grip, drop, steps, holdMs, settleMs } = plan;
  const base = { modifiers: 0, pointerType: 'mouse' };
  const dispatch = (params: Record<string, unknown>) => send(session, 'Input.dispatchMouseEvent', params);
  const moveTo = (at: Point, buttons: number) =>
    dispatch({ ...base, ...at, type: 'mouseMoved', button: buttons ? 'left' : 'none', buttons });

  for (const at of pathBetween(approach, grip, APPROACH_STEPS)) {
    await settle(MOVE_INTERVAL_MS);
    await moveTo(at, 0);
  }
  await dispatch({ ...base, ...grip, type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 });
  await settle(holdMs);

  for (const at of pathBetween(grip, drop, steps)) {
    await settle(MOVE_INTERVAL_MS);
    await moveTo(at, 1);
  }
  await settle(settleMs);
  await dispatch({ ...base, ...drop, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 });
}
