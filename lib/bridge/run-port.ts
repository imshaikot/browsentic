import { browser, type Browser } from 'wxt/browser';
import {
  EXTERNAL_RUN_ID,
  type AttachedFile,
  type RunContext,
  type RunEvent,
  type SavedRecording,
} from '@/lib/actions/protocol';
import type { RecordingState } from '@/lib/recordings/events';
import type { SiteMapDraft } from '@/lib/skills/site-map';
import { tryFastPath } from './fast-path';
import { listMeta } from './file-store';
import { currentRecording, onRecordingState, startActiveTabRecording, stopRecording } from './recorder';
import { asSavedRecording, listRecordings } from './recording-store';
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

export const RUN_PORT = 'browsentic/run';

const LOCAL_RUN = 'local';

const UNWATCHED_GRACE_MS = 10_000;

const CANCEL_CONFIRM_MS = 4_000;

export type RunCommand =
  | { op: 'instruct'; text: string; context?: RunContext }
  | { op: 'cancel' }
  | { op: 'decision'; toolId: string; allow: boolean }
  | { op: 'reset' }
  | { op: 'activateMap'; stagingId: string; exactHost?: boolean }
  | { op: 'discardMap'; stagingId: string }
  | { op: 'startRecording'; captureValues: boolean }
  | { op: 'stopRecording' };

export type RunMessage =
  | { op: 'event'; runId: string; event: RunEvent }
  | { op: 'active'; runId: string | null }
  | { op: 'mapDraft'; draft: SiteMapDraft }
  | { op: 'mapSettled'; stagingId: string; ok: boolean; message?: string }
  | { op: 'recording'; state: RecordingState | null };

const ports = new Set<Browser.runtime.Port>();
let activeRunId: string | null = null;
let actingLocally = false;
let unwatchedTimer: ReturnType<typeof setTimeout> | undefined;
let cancelTimer: ReturnType<typeof setTimeout> | undefined;
let pendingDraft: SiteMapDraft | null = null;

export function serveRunPorts(): void {
  onRunEvent((runId, event) => {
    if (runId === EXTERNAL_RUN_ID) return broadcast({ op: 'event', runId, event });
    const ends = event.kind === 'done' || event.kind === 'error';
    if (ends && (activeRunId === null || activeRunId === runId)) setActiveRun(null);
    broadcast({ op: 'event', runId, event });
  });

  onSiteMapDraft((_runId, draft) => {
    pendingDraft = draft;
    broadcast({ op: 'mapDraft', draft });
  });

  onWelcome(() => {
    if (activeRunId) endRun('The connection to the daemon dropped, so that run is over.');
  });

  onRecordingState((state) => {
    if (state?.warning) {
      broadcast({
        op: 'event',
        runId: LOCAL_RUN,
        event: { kind: 'error', code: 'RECORDING_LIMIT', message: state.warning },
      });
    }
    broadcast({ op: 'recording', state });
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== RUN_PORT) return;
    ports.add(port);
    clearTimeout(unwatchedTimer);
    post(port, { op: 'active', runId: activeRunId });
    if (pendingDraft) post(port, { op: 'mapDraft', draft: pendingDraft });
    void currentRecording().then((state) => post(port, { op: 'recording', state }));

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
    case 'startRecording':
      void beginRecording(command.captureValues);
      return;
    case 'stopRecording':
      void stopRecording('user');
      return;
    case 'reset':
      resetConversation();
      return;
  }
}

async function beginRecording(captureValues: boolean): Promise<void> {
  const result = await startActiveTabRecording(captureValues);
  if (result.ok) return;
  broadcast({
    op: 'event',
    runId: LOCAL_RUN,
    event: { kind: 'error', code: result.error.code, message: result.error.message },
  });
}

async function instruct(text: string, context?: RunContext): Promise<void> {
  actingLocally = true;
  try {
    if (await handledLocally(text)) {
      setActiveRun(null);
      return;
    }

    const runId = sendInstruction(text, {
      ...context,
      files: await attachedFiles(),
      recordings: await attachedRecordings(),
    });
    if (!runId) {
      broadcast({
        op: 'event',
        runId: LOCAL_RUN,
        event: {
          kind: 'error',
          code: 'EXTENSION_OFFLINE',
          message:
            'No Browsentic daemon is attached, so only quick browser commands work. Pair the browser to do more.',
        },
      });
    }
    setActiveRun(runId);
  } finally {
    actingLocally = false;
  }
}

async function handledLocally(text: string): Promise<boolean> {
  try {
    return await tryFastPath(text, (event) => broadcast({ op: 'event', runId: LOCAL_RUN, event }));
  } catch (error) {
    console.warn('[browsentic] fast path threw, escalating:', error);
    return false;
  }
}

function stopRun(): void {
  const runId = activeRunId;
  if (!runId) {
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

function endRun(message: string): void {
  broadcast({ op: 'event', runId: LOCAL_RUN, event: { kind: 'error', code: 'CANCELLED', message } });
  setActiveRun(null);
}

const MAX_CONTEXT_FILES = 6;
const MAX_DIGEST_CHARS = 2_000;

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
    return [];
  }
}

const MAX_CONTEXT_RECORDINGS = 8;

async function attachedRecordings(): Promise<SavedRecording[]> {
  try {
    return (await listRecordings())
      .filter((recording) => recording.status === 'ready')
      .slice(0, MAX_CONTEXT_RECORDINGS)
      .map(asSavedRecording);
  } catch {
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
    ports.delete(port);
  }
}
