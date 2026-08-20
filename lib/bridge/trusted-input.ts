import { invokeInTab } from '@/lib/actions/client';
import { trustedClick } from '@/lib/actions/page/trusted-click';
import { success, type ActionResult } from '@/lib/actions/protocol';
import { send, settle, withDebugger, type DebuggerSession } from './cdp';

const MODIFIER_BIT: Record<string, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const BUTTON_BIT: Record<string, number> = { left: 1, right: 2, middle: 4 };

const MOVE_INTERVAL_MS = 12;
const MAX_DRIFT_PX = 6;

export interface Point {
  x: number;
  y: number;
}

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

const FIREFOX_HINT =
  'A trusted click needs Chrome’s debugger, which Firefox does not expose — use page.clickElement instead.';

export function trustedClickInTab(tabId: number, input: unknown): Promise<ActionResult> {
  return withDebugger(tabId, FIREFOX_HINT, async (session) => {
    const planned = await invokeInTab(tabId, trustedClick.name, input);
    if (!planned.ok) return planned;
    await dispatchClick(session, planned.data as ClickPlan);
    return success({ ...(planned.data as object), trusted: true });
  });
}

const easeOut = (progress: number) => 1 - (1 - progress) ** 3;

function pathBetween(from: Point, to: Point, steps: number): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy) || 1;
  const drift = Math.min(MAX_DRIFT_PX, span / 8);
  return Array.from({ length: steps }, (_, index) => {
    const progress = easeOut((index + 1) / steps);
    const wobble = Math.sin(progress * Math.PI) * drift * (index % 2 ? -1 : 1);
    return {
      x: Math.round(from.x + dx * progress - (dy / span) * wobble),
      y: Math.round(from.y + dy * progress + (dx / span) * wobble),
    };
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
