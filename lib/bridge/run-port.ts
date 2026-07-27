import { browser, type Browser } from 'wxt/browser';
import type { RunContext, RunEvent } from '@/lib/actions/protocol';
import type { SiteMapDraft } from '@/lib/skills/site-map';
import { tryFastPath } from './fast-path';
import { recordGeneratedSkill } from './skill-store';
import {
  activateSiteMap,
  cancelRun,
  discardSiteMap,
  onRunEvent,
  onSiteMapDraft,
  resetConversation,
  sendDecision,
  sendInstruction,
} from './socket';

export const RUN_PORT = 'voicelink/run';

/** Correlation id for events the extension produced itself, with no run behind them. */
const LOCAL_RUN = 'local';

/**
 * How long a run keeps going after the last extension page stops watching. Long enough for the
 * popup to hand off to the side panel it just opened, short enough that nothing drives the
 * browser unobserved for meaningfully longer than that.
 */
const UNWATCHED_GRACE_MS = 10_000;

/** Extension page → background worker. */
export type RunCommand =
  /** `context` names the tab the instruction was typed against; the daemon routes site skills on it. */
  | { op: 'instruct'; text: string; context?: RunContext }
  | { op: 'cancel' }
  | { op: 'decision'; toolId: string; allow: boolean }
  | { op: 'reset' }
  /** Arm or bin a staged site map. Both outlive the run that produced them. */
  | { op: 'activateMap'; stagingId: string; exactHost?: boolean }
  | { op: 'discardMap'; stagingId: string };

/** Background worker → extension pages. */
export type RunMessage =
  | { op: 'event'; runId: string; event: RunEvent }
  /** Sent on connect, and whenever a run starts or ends, so a late page knows where it stands. */
  | { op: 'active'; runId: string | null }
  /** A mapping run produced a map; the panel shows it for review. */
  | { op: 'mapDraft'; draft: SiteMapDraft }
  /** The staged map is gone — armed or binned — so the review sheet can close. */
  | { op: 'mapSettled'; stagingId: string; ok: boolean; message?: string };

const ports = new Set<Browser.runtime.Port>();
let activeRunId: string | null = null;
/** True while a local action is in flight — it holds the same one-at-a-time lock as a run. */
let actingLocally = false;
let unwatchedTimer: ReturnType<typeof setTimeout> | undefined;
/** The staged map nobody has decided on yet. Replayed to a page that connects late. */
let pendingDraft: SiteMapDraft | null = null;

/**
 * Bridge the daemon's run events to whichever extension pages are open. A one-shot
 * `sendMessage` would be wrong here — text arrives token by token, so the panel holds a port.
 */
export function serveRunPorts(): void {
  onRunEvent((runId, event) => {
    if (event.kind === 'done' || event.kind === 'error') setActiveRun(null);
    broadcast({ op: 'event', runId, event });
  });

  // A staged map outlives its run, so the worker keeps the last one and replays it to a page
  // that connects afterwards — closing the panel mid-crawl must not lose the review.
  onSiteMapDraft((_runId, draft) => {
    pendingDraft = draft;
    broadcast({ op: 'mapDraft', draft });
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== RUN_PORT) return;
    ports.add(port);
    clearTimeout(unwatchedTimer);
    post(port, { op: 'active', runId: activeRunId });
    if (pendingDraft) post(port, { op: 'mapDraft', draft: pendingDraft });

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
      if (activeRunId || actingLocally) return;
      void instruct(command.text, command.context);
      return;
    case 'cancel':
      if (activeRunId) cancelRun(activeRunId);
      return;
    case 'decision':
      if (activeRunId) sendDecision(activeRunId, command.toolId, command.allow);
      return;
    case 'activateMap':
    case 'discardMap': {
      const draft = pendingDraft;
      const settle =
        command.op === 'activateMap'
          ? activateSiteMap(command.stagingId, command.exactHost)
          : discardSiteMap(command.stagingId);
      void settle.then((result) => {
        // Note it in the extension's own index so it appears beside uploads. Metadata only: the
        // body stays on disk, so nothing here can ever re-push over the daemon's copy.
        if (result.ok && command.op === 'activateMap' && draft?.stagingId === command.stagingId) {
          void recordGeneratedSkill({
            name: draft.name,
            domain: command.exactHost ? draft.host : draft.domain,
            directory: draft.directory,
            pages: draft.pages,
            generatedAt: draft.generatedAt,
          });
        }
        if (pendingDraft?.stagingId === command.stagingId) pendingDraft = null;
        broadcast({
          op: 'mapSettled',
          stagingId: command.stagingId,
          ok: result.ok,
          message: result.ok ? undefined : `${result.error.code}: ${result.error.message}`,
        });
      });
      return;
    }
    case 'reset':
      resetConversation();
      return;
  }
}

/**
 * The single funnel every instruction passes through, spoken or typed, from either surface.
 * The local grammar gets first refusal; only what it declines — or attempts and fails —
 * becomes a daemon run. Callers see one `active` message either way, so a page cannot tell
 * the two apart except by the `source` marker on the steps.
 */
async function instruct(text: string, context?: RunContext): Promise<void> {
  actingLocally = true;
  try {
    if (await tryFastPath(text, (event) => broadcast({ op: 'event', runId: LOCAL_RUN, event }))) {
      // Release the composer: the page set itself "working" the moment it sent this.
      setActiveRun(null);
      return;
    }
  } catch (error) {
    // A broken fast path must never swallow the instruction — fall through to the agent.
    console.warn('[voicelink] fast path threw, escalating:', error);
  } finally {
    actingLocally = false;
  }

  const runId = sendInstruction(text, context);
  if (!runId) {
    broadcast({
      op: 'event',
      runId: LOCAL_RUN,
      event: {
        kind: 'error',
        code: 'EXTENSION_OFFLINE',
        message: 'No VoiceLink daemon is attached, so only quick browser commands work. Pair the browser to do more.',
      },
    });
  }
  setActiveRun(runId);
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
