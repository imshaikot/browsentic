import { browser } from 'wxt/browser';
import type { ActionResult } from '@/lib/actions/protocol';
import { CUE_CHANNEL, CUE_FADE_MS, CUE_LINGER_MS, type CueCommand, type CuePlan } from '@/lib/cues/events';
import { focusedFrame, TOP_FRAME } from './frame-focus';
import { readTheme } from './theme';

export const ACTION_CUES_KEY = 'browsentic/actionCues';

export const CUE_LEAD_MS = 120;

const QUENCH_WAIT_MS = 300;

const THROTTLED_TIMER_SLACK_MS = 5_000;

const LIT_FOR_MS = CUE_LINGER_MS + CUE_FADE_MS + THROTTLED_TIMER_SLACK_MS;

type Unsent<T> = T extends unknown ? Omit<T, 'channel'> : never;

type Timer = ReturnType<typeof setTimeout>;

const lit = new Map<number, Map<number, Timer | undefined>>();

export const actionCuesOn = (value: unknown): boolean => value === true;

export async function readActionCues(): Promise<boolean> {
  const stored = await browser.storage.local.get(ACTION_CUES_KEY);
  return actionCuesOn(stored[ACTION_CUES_KEY]);
}

/**
 * Shows where an action lands while it runs. The ring is asked for first and given a few
 * frames to paint, never longer: a tab that cannot answer — frozen, or held by an alert —
 * costs the action at most CUE_LEAD_MS, and a failed cue never fails the action.
 */
export async function cued(tabId: number, plan: CuePlan, perform: () => Promise<ActionResult>): Promise<ActionResult> {
  if (plan.quench) await quenchCues(tabId);
  if (plan.kind === 'none') return perform();
  const [enabled, theme, frameId] = await Promise.all([
    readActionCues(),
    readTheme(),
    plan.kind === 'page' ? TOP_FRAME : focusedFrame(tabId),
  ]);
  if (!enabled) return perform();

  const id = crypto.randomUUID();
  await within(CUE_LEAD_MS, post(tabId, frameId, { op: 'show', id, plan, theme }));
  light(tabId, frameId, false);

  let ok = false;
  try {
    const result = await perform();
    ok = result.ok;
    return result;
  } finally {
    void post(tabId, frameId, { op: 'settle', id, ok });
    light(tabId, frameId, true);
  }
}

/** Takes every ring off the tab before its pixels are read, so a capture never shows the agent its own cue. */
export async function quenchCues(tabId: number): Promise<void> {
  const frames = lit.get(tabId);
  if (!frames) return;
  lit.delete(tabId);
  for (const timer of frames.values()) clearTimeout(timer);
  await within(
    QUENCH_WAIT_MS,
    Promise.all([...frames.keys()].map((frameId) => post(tabId, frameId, { op: 'quench' }))),
  );
}

function light(tabId: number, frameId: number, settling: boolean): void {
  const frames = lit.get(tabId) ?? new Map<number, Timer | undefined>();
  clearTimeout(frames.get(frameId));
  const out = () => {
    frames.delete(frameId);
    if (!frames.size && lit.get(tabId) === frames) lit.delete(tabId);
  };
  frames.set(frameId, settling ? setTimeout(out, LIT_FOR_MS) : undefined);
  lit.set(tabId, frames);
}

function post(tabId: number, frameId: number, command: Unsent<CueCommand>): Promise<unknown> {
  return browser.tabs.sendMessage(tabId, { channel: CUE_CHANNEL, ...command }, { frameId }).catch(() => undefined);
}

function within(ms: number, work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([work.then(() => undefined), late]).finally(() => clearTimeout(timer));
}
