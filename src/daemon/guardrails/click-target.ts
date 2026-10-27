/**
 * Reading what a click would land on, so the policy can judge it.
 *
 * `decide()` is pure and sees only the request, and a click names its target by selector or
 * text. The caller probes the page first, with an action that touches nothing, and hands the
 * answer to `decide()`. A probe that fails leaves the target unread, and an unread target
 * counts as one that commits: a click nobody could look at is not one to wave through.
 */

import type { ActionResult } from '@/lib/actions/protocol';
import { CLICK_ACTIONS, type ClickTarget } from './policy';

export const PROBE_ACTION = 'page.probeClick';

export type Probe = (action: string, input: unknown) => Promise<ActionResult>;

/** The target of a click action, or undefined for any other action. */
export async function readClickTarget(probe: Probe, action: string, input: unknown): Promise<ClickTarget | undefined> {
  if (!CLICK_ACTIONS.has(action)) return undefined;
  const { target, point } = (input ?? {}) as { target?: unknown; point?: unknown };
  try {
    const result = await probe(PROBE_ACTION, { target, point });
    if (!result.ok) return UNREAD;
    const { submits, text, href, pageUrl } = (result.data ?? {}) as Record<string, unknown>;
    if (typeof submits !== 'boolean' || typeof pageUrl !== 'string') return UNREAD;
    return {
      submits,
      pageUrl,
      ...(typeof text === 'string' ? { text } : {}),
      ...(typeof href === 'string' ? { href } : {}),
    };
  } catch {
    return UNREAD;
  }
}

export const UNREAD: ClickTarget = { submits: false, unread: true };
