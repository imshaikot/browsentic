import { invokeInTab } from '@/lib/actions/client';
import { dragElement } from '@/lib/actions/page/drag-element';
import { APPROACH_STEPS, pathBetween, type Point } from '@/lib/actions/page/pointer';
import { trustedClick } from '@/lib/actions/page/trusted-click';
import { success, type ActionResult } from '@/lib/actions/protocol';
import { send, settle, withDebugger, type DebuggerSession } from './cdp';

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
    await dispatchClick(session, planned.data as ClickPlan);
    return success({ ...(planned.data as object), trusted: true });
  });
}

export function dragInTab(tabId: number, input: unknown): Promise<ActionResult> {
  return withDebugger(tabId, FIREFOX_DRAG_HINT, async (session) => {
    const planned = await invokeInTab(tabId, dragElement.name, input);
    if (!planned.ok) return planned;
    await dispatchDrag(session, planned.data as DragPlan);
    return success({ ...(planned.data as object), trusted: true });
  });
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
