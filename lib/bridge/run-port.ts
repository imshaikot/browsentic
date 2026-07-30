import { browser, type Browser } from 'wxt/browser';
import type { AttachedFile, RunContext, RunEvent } from '@/lib/actions/protocol';
import type { SiteMapDraft } from '@/lib/skills/site-map';
import { tryFastPath } from './fast-path';
import { listMeta } from './file-store';
import { recordGeneratedSkill } from './skill-store';
import {
  activateSiteMap,
  cancelRun,
  discardSiteMap,
  onRunEvent,
  onSiteMapDraft,
  onWelcome,
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

/**
 * How long a cancellation may go unanswered before the worker ends the run on its own account.
 *
 * A `cancel` frame is only a request: the daemon answers it by ending the run, which is what
 * clears `activeRunId` here. If the daemon has already forgotten the run — it was cancelled from
 * the other side, the socket was replaced, the run errored somewhere that never emitted — no
 * answer is coming, and without this the panel is stuck showing a Stop button that does nothing
 * for as long as the worker lives.
 */
const CANCEL_CONFIRM_MS = 4_000;

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
let cancelTimer: ReturnType<typeof setTimeout> | undefined;
/** The staged map nobody has decided on yet. Replayed to a page that connects late. */
let pendingDraft: SiteMapDraft | null = null;

/**
 * Bridge the daemon's run events to whichever extension pages are open. A one-shot
 * `sendMessage` would be wrong here — text arrives token by token, so the panel holds a port.
 */
export function serveRunPorts(): void {
  onRunEvent((runId, event) => {
    // Only the run we are actually tracking gets to end it. A daemon that refuses a second
    // instruction answers with an error carrying *that* instruction's id, and treating it as the
    // end of the run already in progress would hand the composer back mid-run.
    const ends = event.kind === 'done' || event.kind === 'error';
    if (ends && (activeRunId === null || activeRunId === runId)) setActiveRun(null);
    broadcast({ op: 'event', runId, event });
  });

  // A staged map outlives its run, so the worker keeps the last one and replays it to a page
  // that connects afterwards — closing the panel mid-crawl must not lose the review.
  onSiteMapDraft((_runId, draft) => {
    pendingDraft = draft;
    broadcast({ op: 'mapDraft', draft });
  });

  // A fresh `welcome` means the daemon accepted a new connection, and accepting one disposes the
  // agent session the previous connection was using. So any run this worker still believes in is
  // definitively over — the event that would have said so went to a socket that is already gone.
  onWelcome(() => {
    if (activeRunId) endRun('The connection to the daemon dropped, so that run is over.');
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
      // One run at a time: the daemon rejects a second, but not starting it is clearer. Say so
      // rather than dropping it — the page set itself "working" when it sent this, and silence
      // leaves it that way with nothing on the way to correct it.
      if (activeRunId || actingLocally) {
        broadcast({
          op: 'event',
          runId: LOCAL_RUN,
          event: {
            kind: 'error',
            code: 'RUN_IN_PROGRESS',
            message: 'Something is already running — stop it before sending another instruction.',
          },
        });
        broadcast({ op: 'active', runId: activeRunId ?? LOCAL_RUN });
        return;
      }
      void instruct(command.text, command.context);
      return;
    case 'cancel':
      stopRun();
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
  // Held for the whole funnel, not just the fast path: reading the file index below is another
  // await, and releasing the lock before it leaves a window where neither this nor `activeRunId`
  // is set — long enough for a second instruction to start a run alongside this one.
  actingLocally = true;
  try {
    if (await handledLocally(text)) {
      // Release the composer: the page set itself "working" the moment it sent this.
      setActiveRun(null);
      return;
    }

    // Read the file index here rather than in the page that typed this: the worker owns storage,
    // and the popup and the side panel then describe the same library without either doing it.
    const runId = sendInstruction(text, { ...context, files: await attachedFiles() });
    if (!runId) {
      broadcast({
        op: 'event',
        runId: LOCAL_RUN,
        event: {
          kind: 'error',
          code: 'EXTENSION_OFFLINE',
          message:
            'No VoiceLink daemon is attached, so only quick browser commands work. Pair the browser to do more.',
        },
      });
    }
    setActiveRun(runId);
  } finally {
    actingLocally = false;
  }
}

/** The local grammar's attempt. A fast path that throws must never swallow the instruction. */
async function handledLocally(text: string): Promise<boolean> {
  try {
    return await tryFastPath(text, (event) => broadcast({ op: 'event', runId: LOCAL_RUN, event }));
  } catch (error) {
    console.warn('[voicelink] fast path threw, escalating:', error);
    return false;
  }
}

/**
 * Stop whatever is running, and make sure the answer arrives either way.
 *
 * Ordinarily the daemon ends the run and the `done`/`error` event clears the state. The two cases
 * that used to wedge the panel are both handled here: nothing to send the frame on, and a frame
 * that goes out to a daemon which no longer has this run to cancel.
 */
function stopRun(): void {
  const runId = activeRunId;
  if (!runId) {
    // Nothing running here. Re-answer anyway: a page showing a Stop button disagrees with us.
    broadcast({ op: 'active', runId: null });
    return;
  }
  if (!cancelRun(runId)) {
    endRun('The daemon is not connected, so there was nothing left to stop.');
    return;
  }
  clearTimeout(cancelTimer);
  cancelTimer = setTimeout(() => {
    if (activeRunId !== runId) return;
    endRun('Stopped. The daemon never confirmed it, so check for a run still finishing there.');
  }, CANCEL_CONFIRM_MS);
}

/** End the run from this side, with a line on the timeline saying why it ended here. */
function endRun(message: string): void {
  broadcast({ op: 'event', runId: LOCAL_RUN, event: { kind: 'error', code: 'CANCELLED', message } });
  setActiveRun(null);
}

/** Newest first, and only this many: past a handful the prompt is mostly file notes. */
const MAX_CONTEXT_FILES = 6;
/** Per-file cap on the extract. The daemon caps the assembled block again on its own terms. */
const MAX_DIGEST_CHARS = 2_000;

/**
 * The attached-file library as run context. Metadata and notes only — the bytes never leave
 * storage except through `page.attachFile`, which reads them in the invoke path.
 */
async function attachedFiles(): Promise<AttachedFile[]> {
  try {
    return (await listMeta()).slice(0, MAX_CONTEXT_FILES).map((file) => ({
      id: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
      status: file.status,
      summary: file.summary,
      digest: file.digest?.slice(0, MAX_DIGEST_CHARS),
    }));
  } catch {
    // An unreadable index must not cost the user their instruction.
    return [];
  }
}

function setActiveRun(runId: string | null): void {
  activeRunId = runId;
  clearTimeout(cancelTimer);
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
