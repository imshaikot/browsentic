import type { RunEvent } from '@/lib/actions/protocol';
import { routeIntent } from '@/lib/intent';
import { invokeForHarness } from './invoke';

/**
 * Try to carry out an instruction here in the browser, without waking the agent.
 *
 * Most of what people say to a voice assistant on a page is one unambiguous action — back,
 * reload, scroll down, open github.com, click Sign in. Sending those out to the daemon to be
 * spawned as a Claude Code run costs a socket round trip and several seconds of thinking to
 * reach a tool call the extension could have made in milliseconds. `routeIntent` scores the
 * utterance against a fixed grammar; only a confident, single-step, non-consequential match
 * runs here. Everything else — questions, multi-step asks, anything the grammar is unsure of
 * — returns false and takes the normal path.
 *
 * Returns true when the instruction is fully dealt with. A *failed* local action returns
 * false on purpose: "click Sign in" that finds no such control is exactly the case where the
 * agent, which can look at the page first, does better. The failed step stays on the
 * timeline so the handover is visible rather than mysterious.
 */
export async function tryFastPath(text: string, emit: (event: RunEvent) => void): Promise<boolean> {
  const routing = routeIntent(text);
  if (routing.decision !== 'act') return false;

  const { action, input, label, ruleId, score } = routing.intent;
  // A uuid rather than a counter: the worker is torn down and restarted routinely, and a
  // panel that outlives it must never see a fresh step reuse an old row's id.
  const toolId = `local-${crypto.randomUUID()}`;
  emit({ kind: 'tool', toolId, action, input, source: 'local' });

  const startedAt = Date.now();
  const result = await invokeForHarness(action, input);
  const elapsed = Date.now() - startedAt;
  emit({
    kind: 'toolResult',
    toolId,
    ok: result.ok,
    // The timing is the point of this path — show it, so a slow one is obvious.
    summary: result.ok ? `${label} · ${elapsed} ms` : `${result.error.code}: ${result.error.message}`,
  });

  if (!result.ok) {
    console.debug(`[voicelink] fast path ${ruleId} (${score}) failed, escalating:`, result.error.code);
    return false;
  }
  return true;
}
