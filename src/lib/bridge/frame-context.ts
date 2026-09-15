import { FRAME_MARK_ATTRIBUTE } from '@/lib/frames/events';
import { frameSessions, onDebuggerEvent, send, settle, type DebuggerSession } from './cdp';
import { focusedFrame, markFrame, TOP_FRAME, unmarkFrame } from './frame-focus';

export interface FrameContext {
  session: DebuggerSession;
  contextId?: number;
}

interface ContextCreated {
  context?: { id: number; auxData?: { isDefault?: boolean } };
}

interface ValueReply {
  result?: { value?: unknown };
}

const CONTEXTS_SETTLE_MS = 50;

/**
 * The main world of the frame in focus, addressed for `Runtime.evaluate`. The top frame is
 * the session itself. A child frame is found by marking its document from the isolated
 * world and reading the mark back from each candidate context: same-process frames share
 * the root session, out-of-process ones arrive as auto-attached child sessions.
 */
export async function mainWorldOf(session: DebuggerSession): Promise<FrameContext | null> {
  const frameId = await focusedFrame(session.tabId);
  if (frameId === TOP_FRAME) return { session };

  const token = crypto.randomUUID();
  if (!(await markFrame(session.tabId, frameId, token))) return null;
  try {
    const children = (await frameSessions(session)).map(({ sessionId }) => ({ tabId: session.tabId, sessionId }));
    for (const candidate of [session, ...children]) {
      for (const contextId of await defaultContexts(candidate)) {
        if ((await markIn(candidate, contextId)) === token) return { session: candidate, contextId };
      }
    }
    return null;
  } finally {
    void unmarkFrame(session.tabId, frameId);
  }
}

async function defaultContexts(session: DebuggerSession): Promise<number[]> {
  const found: number[] = [];
  const stop = onDebuggerEvent((source, method, params) => {
    if (method !== 'Runtime.executionContextCreated') return;
    if (source.tabId !== session.tabId || source.sessionId !== session.sessionId) return;
    const context = (params as ContextCreated).context;
    if (context?.auxData?.isDefault) found.push(context.id);
  });
  try {
    await send(session, 'Runtime.enable');
    await settle(CONTEXTS_SETTLE_MS);
  } catch {
    return [];
  } finally {
    stop();
    await send(session, 'Runtime.disable').catch(() => {});
  }
  return found;
}

async function markIn(session: DebuggerSession, contextId: number): Promise<unknown> {
  const reply = await send<ValueReply>(session, 'Runtime.evaluate', {
    expression: `document.documentElement.getAttribute(${JSON.stringify(FRAME_MARK_ATTRIBUTE)})`,
    returnByValue: true,
    contextId,
  }).catch(() => null);
  return reply?.result?.value;
}
