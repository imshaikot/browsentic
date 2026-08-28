import { browser, type Browser } from 'wxt/browser';
import {
  EXTERNAL_RUN_ID,
  type AttachedFile,
  type FocusedElement,
  type RunEvent,
  type SavedRecording,
} from '@/lib/actions/protocol';
import type { MonitorState } from '@/lib/monitor/events';
import type { RecordingState } from '@/lib/recordings/events';
import type { SiteMapDraft } from '@/lib/skills/site-map';
import { navigate } from '@/lib/actions/page/navigate';
import { tryFastPath } from './fast-path';
import { listMeta } from './file-store';
import { invokeForHarness } from './invoke';
import {
  acknowledgeCompleted,
  activeMonitorStates,
  completedMonitorStates,
  onMonitorState,
  stopTabMonitor,
} from './monitor';
import { currentRecording, onRecordingState, startActiveTabRecording, stopRecording } from './recorder';
import { asSavedRecording, listRecordings } from './recording-store';
import { forgetTab, syncRunIndicator } from './run-indicator';
import { attachPreview, monitorNotice, notice, patchTool, reduce, type RunItem } from './run-items';
import { onScreenshotPreview, type ScreenshotPreview } from './screenshot-preview';
import {
  listSessions,
  nameStoredSession,
  putSession,
  readTranscript,
  titleDueAt,
  type StoredSessionMeta,
} from './session-store';
import { recordGeneratedSkill } from './skill-store';
import { dropTimersForSession, onTimerFire, type TimerHandoff } from './timer';
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
import {
  bindStoredSession,
  dropSession,
  ensureSessionForTab,
  hostOf,
  patchSession,
  readTabSessions,
  releaseTab,
  remapTab,
  sessionForRun,
  sessionForTab,
  type TabAnchor,
  type TabSession,
} from './tab-sessions';

export const RUN_PORT = 'browsentic/run';

const LOCAL_RUN = 'local';

const CANCEL_CONFIRM_MS = 4_000;

const PERSIST_DEBOUNCE_MS = 800;

const MAX_EXTERNAL_ITEMS = 100;

export type RunCommand =
  | { op: 'instruct'; text: string; tab: TabAnchor; agentSkillId?: string; focus?: FocusedElement }
  | { op: 'cancel'; sessionId: string }
  | { op: 'decision'; sessionId: string; toolId: string; allow: boolean; remember?: boolean }
  | { op: 'endSession'; sessionId: string }
  | { op: 'replay'; sessionId: string }
  | { op: 'restore'; sessionId: string; tab: TabAnchor }
  | { op: 'activateMap'; stagingId: string; exactHost?: boolean }
  | { op: 'discardMap'; stagingId: string }
  | { op: 'startRecording'; captureValues: boolean }
  | { op: 'stopRecording' }
  | { op: 'stopMonitor'; monitorId: string };

export type RunMessage =
  | { op: 'event'; sessionId?: string; runId: string; event: RunEvent }
  | { op: 'item'; sessionId?: string; item: RunItem }
  | { op: 'items'; sessionId?: string; items: RunItem[] }
  | { op: 'mapDraft'; draft: SiteMapDraft }
  | { op: 'mapSettled'; stagingId: string; ok: boolean; message?: string }
  | { op: 'recording'; state: RecordingState | null }
  | { op: 'preview'; sessionId?: string; preview: ScreenshotPreview }
  | { op: 'monitor'; state: MonitorState };

const ports = new Set<Browser.runtime.Port>();
const buffers = new Map<string, RunItem[]>();
const busy = new Set<string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cancelTimers = new Map<string, ReturnType<typeof setTimeout>>();
let externalItems: RunItem[] = [];
let pendingDraft: SiteMapDraft | null = null;
let queue: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export function serveRunPorts(): void {
  onRunEvent((runId, event) => {
    void serialized(() => absorb(runId, event));
  });

  onScreenshotPreview((preview, runId) => {
    void serialized(async () => {
      const session = runId ? await sessionForRun(runId) : null;
      if (session) {
        const items = attachPreview(await bufferFor(session.sessionId), preview);
        buffers.set(session.sessionId, items);
      }
      broadcast({ op: 'preview', sessionId: session?.sessionId, preview });
    });
  });

  onMonitorState((state) => {
    broadcast({ op: 'monitor', state });
    if (state.phase !== 'watching') {
      void serialized(async () => {
        const session = state.tabId != null ? await sessionForTab(state.tabId) : null;
        if (session) await append(session.sessionId, notice(...noticeOf(state)));
      });
      if (ports.size > 0) void acknowledgeCompleted(state.monitorId);
    }
  });

  onTimerFire((sessionId, prompt, label) =>
    serialized<TimerHandoff>(async () => {
      const session = (await readTabSessions())[sessionId];
      if (!session) return 'gone';
      if (session.runId || busy.has(sessionId)) return 'busy';
      await append(sessionId, notice('info', `Timer “${label}” fired.`));
      await startTurn(session, prompt, { fastPath: false });
      return 'delivered';
    }),
  );

  onSiteMapDraft((_runId, draft) => {
    pendingDraft = draft;
    broadcast({ op: 'mapDraft', draft });
  });

  onWelcome(() => {
    void serialized(async () => {
      for (const session of Object.values(await readTabSessions())) {
        if (!session.runId) continue;
        await endRun(session.sessionId, 'The connection to the daemon dropped, so that run is over.');
      }
    });
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
    if (pendingDraft) post(port, { op: 'mapDraft', draft: pendingDraft });
    void currentRecording().then((state) => post(port, { op: 'recording', state }));
    void activeMonitorStates().then((states) => {
      for (const state of states) post(port, { op: 'monitor', state });
    });
    void completedMonitorStates().then((states) => {
      if (!states.length) return;
      for (const state of states) post(port, { op: 'monitor', state });
      void acknowledgeCompleted();
    });

    port.onMessage.addListener((message) => handle(message as RunCommand));
    port.onDisconnect.addListener(() => ports.delete(port));
  });
}

function handle(command: RunCommand): void {
  switch (command.op) {
    case 'instruct':
      void serialized(() => instruct(command.text, command.tab, command.agentSkillId, command.focus));
      return;
    case 'cancel':
      void serialized(() => stopRun(command.sessionId));
      return;
    case 'decision':
      void serialized(async () => {
        const session = (await readTabSessions())[command.sessionId];
        if (!session?.runId) return;
        buffers.set(command.sessionId, patchTool(await bufferFor(command.sessionId), command.toolId, { awaiting: false }));
        await patchSession(command.sessionId, { pendingApproval: undefined });
        sendDecision(session.runId, command.toolId, command.allow, command.remember);
      });
      return;
    case 'endSession':
      void serialized(() => endSession(command.sessionId));
      return;
    case 'replay':
      void serialized(async () => {
        broadcast({ op: 'items', sessionId: command.sessionId, items: await bufferFor(command.sessionId) });
      });
      return;
    case 'restore':
      void serialized(() => restore(command.sessionId, command.tab));
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
    case 'stopMonitor':
      void stopTabMonitor(command.monitorId);
      return;
  }
}

async function absorb(runId: string, event: RunEvent): Promise<void> {
  if (runId === EXTERNAL_RUN_ID) {
    externalItems = reduce(externalItems, event).slice(-MAX_EXTERNAL_ITEMS);
    broadcast({ op: 'event', runId, event });
    return;
  }

  const session = await sessionForRun(runId);
  if (!session) return;
  const { sessionId } = session;

  buffers.set(sessionId, reduce(await bufferFor(sessionId), event));
  broadcast({ op: 'event', sessionId, runId, event });

  if (event.kind === 'session') {
    await patchSession(sessionId, { agent: event.agent, agentSessionId: event.agentSessionId ?? undefined });
  } else if (event.kind === 'approval') {
    await patchSession(sessionId, {
      pendingApproval: { toolId: event.toolId, action: event.action, input: event.input, site: event.site },
    });
  } else if (event.kind === 'toolResult') {
    await patchSession(sessionId, { pendingApproval: undefined });
  }

  if (event.kind === 'done' || event.kind === 'error') await settle(sessionId);
  else schedulePersist(sessionId);
}

async function settle(sessionId: string): Promise<void> {
  clearTimeout(cancelTimers.get(sessionId));
  cancelTimers.delete(sessionId);
  await patchSession(sessionId, { runId: null, pendingApproval: undefined });
  await syncRunIndicator();

  const session = (await readTabSessions())[sessionId];
  if (session) {
    const tab = await browser.tabs.get(session.currentTabId).catch(() => null);
    if (tab?.url) await patchSession(sessionId, { url: tab.url, host: hostOf(tab.url) });
  }
  await persist(sessionId);

  const stored = (await listSessions()).find((s) => s.id === sessionId);
  if (!stored || titleDueAt(stored.turns, stored.titledAtTurn) === null) return;
  await nameStoredSession(sessionId).catch(() => undefined);
}

async function instruct(
  text: string,
  anchor: TabAnchor,
  agentSkillId?: string,
  focus?: FocusedElement,
): Promise<void> {
  const ensured = await ensureSessionForTab(anchor);
  if (!ensured.ok) {
    broadcast({
      op: 'event',
      runId: LOCAL_RUN,
      event: { kind: 'error', code: 'SESSION_LIMIT', message: ensured.message },
    });
    return;
  }

  const outcome = await startTurn(ensured.session, text, { agentSkillId, focus, fastPath: true });
  if (outcome !== 'busy') return;
  await append(
    ensured.session.sessionId,
    notice('error', 'RUN_IN_PROGRESS: This conversation is still running — stop it before sending another instruction.'),
  );
}

type TurnOutcome = 'started' | 'local' | 'busy' | 'offline';

async function startTurn(
  session: TabSession,
  text: string,
  options: { agentSkillId?: string; focus?: FocusedElement; fastPath: boolean },
): Promise<TurnOutcome> {
  const { agentSkillId, focus, fastPath } = options;
  const { sessionId } = session;
  if (session.runId || busy.has(sessionId)) return 'busy';

  await append(sessionId, { kind: 'user', id: crypto.randomUUID(), text, focus: focus && focusLabel(focus) });
  await patchSession(sessionId, { turns: session.turns + 1 });

  busy.add(sessionId);
  try {
    // An attached agent skill, an element the user pointed at, or a job a timer is handing
    // back only mean something to a spawned agent, so none of them may take the fast path.
    if (fastPath && !agentSkillId && !focus && (await handledLocally(text, session))) {
      await persist(sessionId);
      return 'local';
    }

    const runId = sendInstruction(text, {
      url: session.url,
      tabId: session.currentTabId,
      sessionId,
      agent: session.agent,
      agentSessionId: session.agentSessionId,
      agentSkillId,
      focus,
      files: await attachedFiles(),
      recordings: await attachedRecordings(),
    });
    if (!runId) {
      await append(
        sessionId,
        notice(
          'error',
          'EXTENSION_OFFLINE: No Browsentic daemon is attached, so only quick browser commands work. Pair the browser to do more.',
        ),
      );
      await persist(sessionId);
      return 'offline';
    }
    await patchSession(sessionId, { runId });
    await syncRunIndicator();
    return 'started';
  } finally {
    busy.delete(sessionId);
  }
}

async function handledLocally(text: string, session: TabSession): Promise<boolean> {
  try {
    return await tryFastPath(
      text,
      (event) => {
        buffers.set(session.sessionId, reduce(buffers.get(session.sessionId) ?? [], event));
        broadcast({ op: 'event', sessionId: session.sessionId, runId: LOCAL_RUN, event });
      },
      session.currentTabId,
    );
  } catch (error) {
    console.warn('[browsentic] fast path threw, escalating:', error);
    return false;
  }
}

async function stopRun(sessionId: string): Promise<void> {
  const session = (await readTabSessions())[sessionId];
  const runId = session?.runId;
  if (!runId) return;
  if (!cancelRun(runId)) {
    await endRun(sessionId, 'The daemon is not connected, so there was nothing left to stop.');
    return;
  }
  clearTimeout(cancelTimers.get(sessionId));
  cancelTimers.set(
    sessionId,
    setTimeout(() => {
      void serialized(async () => {
        const still = (await readTabSessions())[sessionId];
        if (still?.runId !== runId) return;
        await endRun(sessionId, 'Stopped. The daemon never confirmed it, so check for a run still finishing there.');
      });
    }, CANCEL_CONFIRM_MS),
  );
}

async function endRun(sessionId: string, message: string): Promise<void> {
  await append(sessionId, notice('error', `CANCELLED: ${message}`));
  await settle(sessionId);
}

async function endSession(sessionId: string): Promise<void> {
  const session = (await readTabSessions())[sessionId];
  if (session?.runId) cancelRun(session.runId);
  await dropTimersForSession(sessionId);
  clearTimeout(cancelTimers.get(sessionId));
  cancelTimers.delete(sessionId);
  await persist(sessionId);
  await dropSession(sessionId);
  buffers.delete(sessionId);
  busy.delete(sessionId);
  resetConversation(sessionId);
  await syncRunIndicator();
}

async function restore(sessionId: string, anchor: TabAnchor): Promise<void> {
  const live = Object.values(await readTabSessions()).find((s) => s.sessionId === sessionId);
  if (live) return;

  const owner = await sessionForTab(anchor.tabId);
  if (owner?.runId) {
    await append(
      owner.sessionId,
      notice('error', 'RUN_IN_PROGRESS: This tab is still running — stop it before opening another conversation here.'),
    );
    return;
  }
  if (owner) {
    await persist(owner.sessionId);
    await dropSession(owner.sessionId);
    buffers.delete(owner.sessionId);
  }

  const meta = (await listSessions()).find((s) => s.id === sessionId);
  if (!meta) return;
  const transcript = await readTranscript(sessionId);
  buffers.set(
    sessionId,
    transcript?.items ?? [notice('error', 'That conversation’s messages are no longer stored.')],
  );

  const session = await bindStoredSession(
    {
      sessionId,
      turns: meta.turns,
      agent: meta.agent,
      agentSessionId: meta.agentSessionId,
      url: meta.url,
      title: titleOf(meta) ?? anchor.title,
    },
    anchor,
  );
  broadcast({ op: 'items', sessionId, items: buffers.get(sessionId) ?? [] });

  if (meta.url && /^https?:$/.test(safeProtocol(meta.url))) {
    await invokeForHarness(navigate.name, { url: meta.url }, session.currentTabId).catch(() => undefined);
  }
}

async function bufferFor(sessionId: string): Promise<RunItem[]> {
  const held = buffers.get(sessionId);
  if (held) return held;
  const transcript = await readTranscript(sessionId);
  const items = transcript?.items ?? [];
  buffers.set(sessionId, items);
  return items;
}

async function append(sessionId: string, item: RunItem): Promise<void> {
  buffers.set(sessionId, [...(await bufferFor(sessionId)), item]);
  broadcast({ op: 'item', sessionId, item });
  schedulePersist(sessionId);
}

function schedulePersist(sessionId: string): void {
  clearTimeout(persistTimers.get(sessionId));
  persistTimers.set(
    sessionId,
    setTimeout(() => void serialized(() => persist(sessionId)), PERSIST_DEBOUNCE_MS),
  );
}

async function persist(sessionId: string): Promise<void> {
  clearTimeout(persistTimers.get(sessionId));
  persistTimers.delete(sessionId);
  const items = buffers.get(sessionId);
  if (!items?.length) return;
  const session = (await readTabSessions())[sessionId];
  const stored = session ? null : (await listSessions()).find((s) => s.id === sessionId);
  const now = Date.now();
  await putSession(
    {
      id: sessionId,
      turns: session?.turns ?? stored?.turns ?? 0,
      url: session?.url ?? stored?.url,
      host: session?.host ?? stored?.host,
      agent: session?.agent ?? stored?.agent,
      agentSessionId: session?.agentSessionId ?? stored?.agentSessionId,
      createdAt: session?.createdAt ?? stored?.createdAt ?? now,
      updatedAt: now,
    },
    items,
  );
}

export function serveTabSessions(): void {
  browser.tabs.onRemoved.addListener((tabId) => {
    forgetTab(tabId);
    void serialized(async () => {
      const { closed } = await releaseTab(tabId);
      if (!closed) return await syncRunIndicator();
      if (closed.runId) {
        cancelRun(closed.runId);
        await append(closed.sessionId, notice('error', 'CANCELLED: The tab was closed, so that run is over.'));
      }
      clearTimeout(cancelTimers.get(closed.sessionId));
      cancelTimers.delete(closed.sessionId);
      await dropTimersForSession(closed.sessionId);
      await persist(closed.sessionId);
      buffers.delete(closed.sessionId);
      busy.delete(closed.sessionId);
      if (closed.runId) resetConversation(closed.sessionId);
      await syncRunIndicator();
    });
  });

  browser.tabs.onReplaced.addListener((added, removed) => {
    void serialized(() => remapTab(removed, added));
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.title === undefined && changeInfo.url === undefined) return;
    void serialized(async () => {
      const session = await sessionForTab(tabId);
      if (!session) return;
      const patch: Partial<TabSession> = {};
      if (tabId === session.mainTabId && tab.title && tab.title !== session.title) patch.title = tab.title;
      if (tabId === session.currentTabId && changeInfo.url) {
        patch.url = changeInfo.url;
        patch.host = hostOf(changeInfo.url);
      }
      if (Object.keys(patch).length) await patchSession(session.sessionId, patch);
    });
  });
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

const focusLabel = (focus: FocusedElement): string =>
  [focus.role ?? focus.tag, focus.label].filter(Boolean).join(' · ');

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

const noticeOf = (state: MonitorState): ['info' | 'error', string] => {
  const { tone, text } = monitorNotice(state);
  return [tone, text];
};

const titleOf = (meta: StoredSessionMeta): string | undefined => meta.title ?? undefined;

function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
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
