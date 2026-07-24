import { browser, type Browser } from 'wxt/browser';
import type { RunEvent } from '@/lib/actions/protocol';
import { cancelRun, onRunEvent, resetConversation, sendDecision, sendInstruction } from './socket';

export const RUN_PORT = 'voicelink/run';

/**
 * How long a run keeps going after the last extension page stops watching. Long enough for the
 * popup to hand off to the side panel it just opened, short enough that nothing drives the
 * browser unobserved for meaningfully longer than that.
 */
const UNWATCHED_GRACE_MS = 10_000;

/** Extension page → background worker. */
export type RunCommand =
  | { op: 'instruct'; text: string }
  | { op: 'cancel' }
  | { op: 'decision'; toolId: string; allow: boolean }
  | { op: 'reset' };

/** Background worker → extension pages. */
export type RunMessage =
  | { op: 'event'; runId: string; event: RunEvent }
  /** Sent on connect, and whenever a run starts or ends, so a late page knows where it stands. */
  | { op: 'active'; runId: string | null };

const ports = new Set<Browser.runtime.Port>();
let activeRunId: string | null = null;
let unwatchedTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Bridge the daemon's run events to whichever extension pages are open. A one-shot
 * `sendMessage` would be wrong here — text arrives token by token, so the panel holds a port.
 */
export function serveRunPorts(): void {
  onRunEvent((runId, event) => {
    if (event.kind === 'done' || event.kind === 'error') setActiveRun(null);
    broadcast({ op: 'event', runId, event });
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== RUN_PORT) return;
    ports.add(port);
    clearTimeout(unwatchedTimer);
    post(port, { op: 'active', runId: activeRunId });

    port.onMessage.addListener((message) => handle(message as RunCommand));
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      if (ports.size === 0 && activeRunId) scheduleUnwatchedCancel();
    });
  });
}

function handle(command: RunCommand): void {
  switch (command.op) {
    case 'instruct':
      // One run at a time: the daemon rejects a second, but not starting it is clearer.
      if (activeRunId) return;
      setActiveRun(sendInstruction(command.text));
      return;
    case 'cancel':
      if (activeRunId) cancelRun(activeRunId);
      return;
    case 'decision':
      if (activeRunId) sendDecision(activeRunId, command.toolId, command.allow);
      return;
    case 'reset':
      resetConversation();
      return;
  }
}

function setActiveRun(runId: string | null): void {
  activeRunId = runId;
  if (runId) clearTimeout(unwatchedTimer);
  broadcast({ op: 'active', runId });
}

function scheduleUnwatchedCancel(): void {
  clearTimeout(unwatchedTimer);
  unwatchedTimer = setTimeout(() => {
    if (ports.size > 0 || !activeRunId) return;
    cancelRun(activeRunId);
    setActiveRun(null);
  }, UNWATCHED_GRACE_MS);
}

function broadcast(message: RunMessage): void {
  for (const port of ports) post(port, message);
}

function post(port: Browser.runtime.Port, message: RunMessage): void {
  try {
    port.postMessage(message);
  } catch {
    // The page went away between the disconnect event and this send.
    ports.delete(port);
  }
}
