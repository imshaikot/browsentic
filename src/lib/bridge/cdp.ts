import { browser } from 'wxt/browser';
import { failure, type ActionResult } from '@/lib/actions/protocol';

export interface DebuggerSession {
  tabId: number;
  sessionId?: string;
}

interface AttachedTarget {
  sessionId: string;
  targetInfo: { url: string; type: string };
}

interface SessionDebugger {
  attach: (target: DebuggerSession, version: string) => Promise<void>;
  detach: (target: DebuggerSession) => Promise<void>;
  sendCommand: (target: DebuggerSession, method: string, params?: object) => Promise<object | undefined>;
  onEvent: {
    addListener: (listener: (source: DebuggerSession, method: string, params?: object) => void) => void;
  };
  onDetach: {
    addListener: (listener: (source: DebuggerSession, reason: string) => void) => void;
  };
}

type EventListener = (source: DebuggerSession, method: string, params?: object) => void;

const cdp = browser.debugger as unknown as SessionDebugger;

const PROTOCOL_VERSION = '1.3';
const INFOBAR_SETTLE_MS = 250;
const ATTACH_SETTLE_MS = 150;
const MAX_FRAME_DEPTH = 4;

export const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const listeners = new Set<EventListener>();

export function serveDebuggerEvents(): void {
  if (import.meta.env.FIREFOX) return;
  cdp.onEvent.addListener((source, method, params) => {
    for (const listener of listeners) listener(source, method, params);
  });
}

export function onDebuggerEvent(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Attaching for longer than one action. `withDebugger` is right for a click and wrong
 * for a diagnostic: `Runtime.consoleAPICalled` and `Network.responseReceived` only
 * arrive while attached, so anything that reads them has to hold the session open and
 * own the detach itself — including the paths where nobody asks for it, which is what
 * `serveDetachEvents` and the caller's own timeout are for.
 */
export async function attachToTab(tabId: number): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await cdp.attach({ tabId }, PROTOCOL_VERSION);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: attachHint(error) };
  }
}

export async function detachFromTab(tabId: number): Promise<void> {
  const session: DebuggerSession = { tabId };
  await send(session, 'Target.setAutoAttach', AUTO_ATTACH_OFF).catch(() => {});
  await cdp.detach(session).catch(() => {});
}

export function serveDetachEvents(listener: (tabId: number, reason: string) => void): void {
  if (import.meta.env.FIREFOX) return;
  cdp.onDetach.addListener((source, reason) => {
    if (source.tabId != null) listener(source.tabId, reason);
  });
}

export function send<T = unknown>(
  session: DebuggerSession,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return cdp.sendCommand(session, method, params) as Promise<T>;
}

export async function withDebugger(
  tabId: number,
  firefoxHint: string,
  run: (session: DebuggerSession) => Promise<ActionResult>,
): Promise<ActionResult> {
  if (import.meta.env.FIREFOX) return failure('UNSUPPORTED', firefoxHint);

  const session: DebuggerSession = { tabId };
  try {
    await cdp.attach(session, PROTOCOL_VERSION);
  } catch (error) {
    return failure('DEBUGGER_UNAVAILABLE', attachHint(error));
  }
  try {
    await settle(INFOBAR_SETTLE_MS);
    return await run(session);
  } catch (error) {
    return failure('ACTION_FAILED', error instanceof Error ? error.message : String(error));
  } finally {
    await send(session, 'Target.setAutoAttach', AUTO_ATTACH_OFF).catch(() => {});
    await cdp.detach(session).catch(() => {});
  }
}

export interface FrameSession {
  sessionId: string;
  url: string;
  parent?: string;
}

const AUTO_ATTACH = {
  autoAttach: true,
  flatten: true,
  waitForDebuggerOnStart: false,
  filter: [{ type: 'iframe' }],
};

// Auto-attached child sessions outlive the root detach, and Chrome then stalls the next
// attach on that tab instead of refusing it — a 30 s TIMEOUT rather than an error.
const AUTO_ATTACH_OFF = { autoAttach: false, flatten: true, waitForDebuggerOnStart: false };

export async function frameSessions(session: DebuggerSession): Promise<FrameSession[]> {
  const found: FrameSession[] = [];
  const stop = onDebuggerEvent((source, method, params) => {
    if (method !== 'Target.attachedToTarget') return;
    const attached = params as AttachedTarget;
    if (attached?.targetInfo?.type !== 'iframe') return;
    found.push({ sessionId: attached.sessionId, url: attached.targetInfo.url, parent: source.sessionId });
  });

  try {
    let frontier = [session];
    for (let depth = 0; depth < MAX_FRAME_DEPTH && frontier.length; depth += 1) {
      const known = found.length;
      for (const target of frontier) await send(target, 'Target.setAutoAttach', AUTO_ATTACH).catch(() => {});
      await settle(ATTACH_SETTLE_MS);
      frontier = found.slice(known).map(({ sessionId }) => ({ tabId: session.tabId, sessionId }));
    }
  } finally {
    stop();
  }
  return found;
}

function attachHint(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return /already attached|another debugger/i.test(detail)
    ? `${detail} — close DevTools for this tab, then retry.`
    : `${detail} — Chrome’s debugger could not attach to this tab.`;
}
