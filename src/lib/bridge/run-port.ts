import { browser, type Browser } from 'wxt/browser';
import {
  EXTERNAL_RUN_ID,
  failure,
  success,
  type ActionResult,
  type AttachedFile,
  type FocusedElement,
  type RunEvent,
  type SavedRecording,
} from '@/lib/actions/protocol';
import { isDelivered } from '@/lib/files/report';
import type { MonitorState } from '@/lib/monitor/events';
import type { RecordingState } from '@/lib/recordings/events';
import { planReplay, type ReplayCall } from '@/lib/recordings/replay';
import type { TaskContext, TaskJob, TaskOrder, TaskResult } from '@/lib/schedules/task';
import type { SiteMapDraft } from '@/lib/skills/site-map';
import { navigate } from '@/lib/actions/page/navigate';
import { onToolOffer, runSavedTool, toolkitCode, type ToolOffer } from './code-toolkit';
import { CONTEXT_COMMAND, isContextCommand, type ContextBreakdown } from './commands';
import { listSavedTools, withoutCode, type SavedToolMeta } from './saved-tools';
import { dropTool, keepTool } from './tool-registry';
import { tryFastPath } from './fast-path';
import { dropDiagnosticsForSession } from './diagnostics';
import {
  cancelAnalysesFor,
  discardFile,
  filesFor,
  indexFile,
  removeFile,
  requestAnalysis,
  sweepOrphanFiles,
  updateMeta,
  type NewFile,
} from './file-store';
import { invokeForHarness } from './invoke';
import {
  acknowledgeCompleted,
  activeMonitorStates,
  completedMonitorStates,
  onMonitorState,
  stopTabMonitor,
} from './monitor';
import { currentRecording, onRecordingState, startActiveTabRecording, stopRecording } from './recorder';
import { asSavedRecording, listRecordings, readRecordingBody } from './recording-store';
import { redactInput } from './redact';
import { forgetTab, syncRunIndicator } from './run-indicator';
import { attachPreview, monitorNotice, nextId, notice, patchTool, reduce, type RunItem } from './run-items';
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
import { announceTask, askTaskApproval, dropTaskApproval, takeApprovalAnswer } from './task-notices';
import { handOverPrompt, replayVerdict, verdictOf, type TaskVerdict } from './task-outcome';
import { putTaskTranscript } from './task-run-store';
import { onToastAnswer } from './toast';
import {
  activateSiteMap,
  cancelRun,
  discardSiteMap,
  onRunEvent,
  onSiteMapDraft,
  onTaskOrder,
  onWelcome,
  reportTaskDone,
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
  type TaskTag,
} from './tab-sessions';

export const RUN_PORT = 'browsentic/run';

const LOCAL_RUN = 'local';

const CANCEL_CONFIRM_MS = 4_000;

const PERSIST_DEBOUNCE_MS = 800;

const MAX_EXTERNAL_ITEMS = 100;

const TAB_LOAD_WAIT_MS = 15_000;

export type RunCommand =
  | { op: 'instruct'; text: string; tab: TabAnchor; agentSkillId?: string; focus?: FocusedElement; liveTools?: boolean }
  | { op: 'cancel'; sessionId: string }
  | { op: 'decision'; sessionId: string; toolId: string; allow: boolean; remember?: boolean }
  | { op: 'endSession'; sessionId: string }
  | { op: 'replay'; sessionId: string }
  | { op: 'restore'; sessionId: string; tab: TabAnchor }
  | { op: 'activateMap'; stagingId: string; exactHost?: boolean }
  | { op: 'discardMap'; stagingId: string }
  | { op: 'startRecording'; captureValues: boolean }
  | { op: 'stopRecording' }
  | { op: 'stopMonitor'; monitorId: string }
  | { op: 'keepTool'; toolkitId: string; tabId: number; slug?: string }
  | { op: 'dismissTool'; toolkitId: string }
  | { op: 'forgetTool'; id: string }
  | { op: 'runTool'; id: string; tab: TabAnchor }
  | { op: 'listTools' }
  | { op: 'attach'; file: NewFile; tab: TabAnchor }
  | { op: 'detach'; fileId: string }
  | { op: 'reanalyze'; fileId: string };

export type RunMessage =
  | { op: 'event'; sessionId?: string; runId: string; event: RunEvent }
  | { op: 'item'; sessionId?: string; item: RunItem }
  | { op: 'items'; sessionId?: string; items: RunItem[] }
  | { op: 'mapDraft'; sessionId?: string; draft: SiteMapDraft }
  | { op: 'mapSettled'; sessionId?: string; stagingId: string; ok: boolean; message?: string }
  | { op: 'recording'; state: RecordingState | null }
  | { op: 'preview'; sessionId?: string; preview: ScreenshotPreview }
  | { op: 'monitor'; state: MonitorState }
  | { op: 'toolOffer'; offer: ToolOffer }
  | { op: 'toolOfferSettled'; toolkitId: string }
  | { op: 'tools'; tools: SavedToolMeta[] }
  | { op: 'close' };

const ports = new Set<Browser.runtime.Port>();
const panelPorts = new Set<Browser.runtime.Port>();
const panelWatchers = new Set<(open: boolean) => void>();
const buffers = new Map<string, RunItem[]>();
const busy = new Set<string>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cancelTimers = new Map<string, ReturnType<typeof setTimeout>>();
let externalItems: RunItem[] = [];
const pendingDrafts = new Map<string, { sessionId?: string; draft: SiteMapDraft }>();
/** Offers raised but not yet answered, so a stale panel cannot save a toolkit twice. */
const pendingOffers = new Map<string, ToolOffer>();
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

  onToolOffer((offer) => {
    pendingOffers.set(offer.toolkitId, offer);
    broadcast({ op: 'toolOffer', offer });
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
      const outcome = await startTurn(session, prompt, { fastPath: false });
      return outcome === 'busy' || outcome === 'offline' ? outcome : 'delivered';
    }),
  );

  onTaskOrder((order) => startTaskRun(order));

  onToastAnswer((toastId, allow, remember, fromTabId) => {
    const answer = takeApprovalAnswer(toastId, fromTabId);
    if (answer) void serialized(() => answerApproval(answer.sessionId, answer.toolId, allow, remember));
  });

  onSiteMapDraft((runId, draft) => {
    void serialized(async () => {
      const session = await sessionForRun(runId);
      if (session) {
        for (const [stagingId, held] of pendingDrafts) {
          if (held.sessionId === session.sessionId) pendingDrafts.delete(stagingId);
        }
      }
      pendingDrafts.set(draft.stagingId, { sessionId: session?.sessionId, draft });
      broadcast({ op: 'mapDraft', sessionId: session?.sessionId, draft });
    });
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
    if (port.sender?.url?.includes('sidepanel.html')) {
      panelPorts.add(port);
      if (panelPorts.size === 1) for (const watch of panelWatchers) watch(true);
    }
    for (const held of pendingDrafts.values()) {
      post(port, { op: 'mapDraft', sessionId: held.sessionId, draft: held.draft });
    }
    void currentRecording().then((state) => post(port, { op: 'recording', state }));
    void listSavedTools().then((tools) => post(port, { op: 'tools', tools: tools.map(withoutCode) }));
    void activeMonitorStates().then((states) => {
      for (const state of states) post(port, { op: 'monitor', state });
    });
    void completedMonitorStates().then((states) => {
      if (!states.length) return;
      for (const state of states) post(port, { op: 'monitor', state });
      void acknowledgeCompleted();
    });

    port.onMessage.addListener((message) => handle(message as RunCommand));
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      if (panelPorts.delete(port) && panelPorts.size === 0) for (const watch of panelWatchers) watch(false);
    });
  });
}

/** Fires with `true` when the first side panel connects and `false` when the last one is gone. */
export function onPanelPresence(watch: (open: boolean) => void): void {
  panelWatchers.add(watch);
}

/** Chromium has no menu-side close, so each panel is told to shut itself. */
export function closePanels(): void {
  for (const panel of panelPorts) post(panel, { op: 'close' });
}

function handle(command: RunCommand): void {
  switch (command.op) {
    case 'instruct':
      void serialized(() => instruct(command.text, command.tab, command.agentSkillId, command.focus, command.liveTools));
      return;
    case 'cancel':
      void serialized(() => stopRun(command.sessionId));
      return;
    case 'decision':
      void serialized(() => answerApproval(command.sessionId, command.toolId, command.allow, command.remember));
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
      const held = pendingDrafts.get(command.stagingId);
      const settle =
        command.op === 'activateMap'
          ? activateSiteMap(command.stagingId, command.exactHost)
          : discardSiteMap(command.stagingId);
      void settle.then((result) => {
        if (result.ok && command.op === 'activateMap' && held) {
          const { draft } = held;
          void recordGeneratedSkill({
            name: draft.name,
            domain: command.exactHost ? draft.host : draft.domain,
            directory: draft.directory,
            pages: draft.pages,
            generatedAt: draft.generatedAt,
          });
        }
        pendingDrafts.delete(command.stagingId);
        broadcast({
          op: 'mapSettled',
          sessionId: held?.sessionId,
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
    case 'keepTool':
      void serialized(async () => {
        const offer = pendingOffers.get(command.toolkitId);
        const code = offer ? await toolkitCode(command.tabId, command.toolkitId) : null;
        if (offer && code) await keepTool({ offer, code, slug: command.slug }).catch(() => undefined);
        pendingOffers.delete(command.toolkitId);
        broadcast({ op: 'toolOfferSettled', toolkitId: command.toolkitId });
        await publishTools();
      });
      return;
    case 'dismissTool':
      pendingOffers.delete(command.toolkitId);
      broadcast({ op: 'toolOfferSettled', toolkitId: command.toolkitId });
      return;
    case 'forgetTool':
      void serialized(async () => {
        await dropTool(command.id);
        await publishTools();
      });
      return;
    case 'runTool':
      void serialized(async () => {
        const result = await runSavedTool(command.tab.tabId, command.tab.url, command.id);
        broadcast({ op: 'item', item: toolRunItem(command.id, result) });
      });
      return;
    case 'listTools':
      void publishTools();
      return;
    case 'attach':
      void serialized(() => attach(command.file, command.tab));
      return;
    case 'detach':
      void discardFile(command.fileId);
      return;
    case 'reanalyze':
      void serialized(async () => {
        await requestAnalysis(command.fileId);
      });
      return;
  }
}

async function answerApproval(sessionId: string, toolId: string, allow: boolean, remember?: boolean): Promise<void> {
  const session = (await readTabSessions())[sessionId];
  if (!session?.runId) return;
  buffers.set(sessionId, patchTool(await bufferFor(sessionId), toolId, { awaiting: false }));
  await patchSession(sessionId, { pendingApproval: undefined });
  sendDecision(session.runId, toolId, allow, remember);
  dropTaskApproval(toolId);
}

/** A file belongs to the conversation of the tab it was dropped on, which is started here if need be. */
async function attach(file: NewFile, anchor: TabAnchor): Promise<void> {
  const ensured = await ensureSessionForTab(anchor);
  if (!ensured.ok) {
    await removeFile(file.id);
    broadcast({ op: 'event', runId: LOCAL_RUN, event: { kind: 'error', code: 'SESSION_LIMIT', message: ensured.message } });
    return;
  }
  await indexFile(file, ensured.session.sessionId);
  await requestAnalysis(file.id);
}

/** Clears out files whose conversation has left both the open tabs and history. */
export async function sweepFiles(): Promise<void> {
  const open = Object.keys(await readTabSessions());
  const stored = (await listSessions().catch(() => [])).map((meta) => meta.id);
  await sweepOrphanFiles([...open, ...stored]);
}

/** A saved-tool run shows on the timeline like any other step, marked local since it was. */
function toolRunItem(id: string, result: { ok: boolean; error?: { code: string; message: string } }): RunItem {
  return result.ok
    ? { kind: 'tool', id: nextId(), action: 'savedTool', input: { tool: id }, ok: true, source: 'local' }
    : notice('error', `${result.error?.code}: ${result.error?.message}`);
}

async function publishTools(): Promise<void> {
  broadcast({ op: 'tools', tools: (await listSavedTools()).map(withoutCode) });
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
  } else if (event.kind === 'attachments') {
    await patchSession(sessionId, { handing: event.files.map((file) => file.id) });
  } else if (event.kind === 'done' && event.stopReason !== 'cancelled') {
    await markHandedOver(sessionId);
  } else if (event.kind === 'approval') {
    await patchSession(sessionId, {
      pendingApproval: { toolId: event.toolId, action: event.action, input: event.input, site: event.site },
    });
    if (session.task) {
      void askTaskApproval({
        sessionId,
        toolId: event.toolId,
        taskName: session.task.name,
        action: event.action,
        input: event.input,
        site: event.site,
        tabId: session.currentTabId,
      });
    }
  } else if (event.kind === 'toolResult') {
    await patchSession(sessionId, { pendingApproval: undefined });
    if (session.task) dropTaskApproval(event.toolId);
  } else if (event.kind === 'usage') {
    await patchSession(sessionId, { usage: event.usage });
  }

  if (event.kind === 'done' || event.kind === 'error') await settle(sessionId);
  else schedulePersist(sessionId);
}

/** A finished turn put its reports in the agent's own session, so the next turn need not carry them. */
async function markHandedOver(sessionId: string): Promise<void> {
  const session = (await readTabSessions())[sessionId];
  if (!session?.handing?.length) return;
  if (session.agentSessionId) {
    for (const fileId of session.handing) await updateMeta(fileId, { deliveredTo: session.agentSessionId });
  }
  await patchSession(sessionId, { handing: undefined });
}

async function settle(sessionId: string): Promise<void> {
  clearTimeout(cancelTimers.get(sessionId));
  cancelTimers.delete(sessionId);
  await dropDiagnosticsForSession(sessionId);
  await patchSession(sessionId, { runId: null, pendingApproval: undefined, handing: undefined });
  await syncRunIndicator();

  const session = (await readTabSessions())[sessionId];
  if (session) {
    const tab = await browser.tabs.get(session.currentTabId).catch(() => null);
    if (tab?.url) await patchSession(sessionId, { url: tab.url, host: hostOf(tab.url) });
  }
  await persist(sessionId);

  const settled = (await readTabSessions())[sessionId];
  if (settled?.task && !settled.task.done) return finishTask(settled, verdictOf(await bufferFor(sessionId)));

  const stored = (await listSessions()).find((s) => s.id === sessionId);
  if (!stored || titleDueAt(stored.turns, stored.titledAtTurn) === null) return;
  await nameStoredSession(sessionId).catch(() => undefined);
}

async function instruct(
  text: string,
  anchor: TabAnchor,
  agentSkillId?: string,
  focus?: FocusedElement,
  liveTools?: boolean,
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

  if (isContextCommand(text)) {
    const { sessionId } = ensured.session;
    const breakdown = await contextBreakdown(ensured.session, await bufferFor(sessionId));
    await append(sessionId, { kind: 'user', id: nextId(), text: CONTEXT_COMMAND });
    await append(sessionId, { kind: 'context', id: nextId(), breakdown });
    return;
  }

  const outcome = await startTurn(ensured.session, text, { agentSkillId, focus, liveTools, fastPath: true });
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
  options: { agentSkillId?: string; focus?: FocusedElement; liveTools?: boolean; fastPath: boolean; task?: TaskContext },
): Promise<TurnOutcome> {
  const { agentSkillId, focus, liveTools, fastPath, task } = options;
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
      liveTools,
      files: await attachedFiles(session),
      recordings: await attachedRecordings(),
      task,
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

function orphanDrafts(sessionId: string): void {
  for (const held of pendingDrafts.values()) {
    if (held.sessionId !== sessionId) continue;
    held.sessionId = undefined;
    broadcast({ op: 'mapDraft', draft: held.draft });
  }
}

async function endSession(sessionId: string): Promise<void> {
  const session = (await readTabSessions())[sessionId];
  if (session?.runId) cancelRun(session.runId);
  if (session) reportAbandoned(session, 'The conversation was ended before the run finished.');
  cancelAnalysesFor(await filesFor(sessionId));
  await dropDiagnosticsForSession(sessionId);
  await dropTimersForSession(sessionId);
  clearTimeout(cancelTimers.get(sessionId));
  cancelTimers.delete(sessionId);
  await persist(sessionId);
  await dropSession(sessionId);
  buffers.delete(sessionId);
  busy.delete(sessionId);
  orphanDrafts(sessionId);
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
    orphanDrafts(owner.sessionId);
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
      usage: meta.usage,
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

async function persist(sessionId: string, known?: TabSession): Promise<void> {
  clearTimeout(persistTimers.get(sessionId));
  persistTimers.delete(sessionId);
  const items = buffers.get(sessionId);
  if (!items?.length) return;
  const session = known ?? (await readTabSessions())[sessionId];
  if (session?.task) {
    const { id: taskId, name: taskName, startedAt } = session.task;
    await putTaskTranscript({ sessionId, taskId, taskName, startedAt, updatedAt: Date.now() }, items);
    return;
  }
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
      usage: session?.usage ?? stored?.usage,
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
      cancelAnalysesFor(await filesFor(closed.sessionId));
      if (closed.runId) {
        cancelRun(closed.runId);
        await append(closed.sessionId, notice('error', 'CANCELLED: The tab was closed, so that run is over.'));
      }
      clearTimeout(cancelTimers.get(closed.sessionId));
      cancelTimers.delete(closed.sessionId);
      await dropTimersForSession(closed.sessionId);
      reportAbandoned(closed, 'The task’s tab was closed before the run finished.');
      if (closed.pendingApproval) dropTaskApproval(closed.pendingApproval.toolId);
      await persist(closed.sessionId, closed);
      buffers.delete(closed.sessionId);
      busy.delete(closed.sessionId);
      orphanDrafts(closed.sessionId);
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

async function startTaskRun(order: TaskOrder): Promise<ActionResult> {
  const opened = await serialized(() => openTaskSession(order));
  if (!opened.ok) return opened;
  await loaded(opened.data.tabId);
  return serialized(() => beginTask(opened.data.sessionId, order));
}

async function openTaskSession(order: TaskOrder): Promise<ActionResult<{ sessionId: string; tabId: number }>> {
  const tab = await openBackgroundTab(order.url);
  if (tab?.id == null) return failure('TAB_UNREACHABLE', 'The browser would not open a tab for the task.');
  const ensured = await ensureSessionForTab({ tabId: tab.id, url: order.url, windowId: tab.windowId, title: order.name });
  if (!ensured.ok) {
    await browser.tabs.remove(tab.id).catch(() => undefined);
    return failure('SESSION_LIMIT', ensured.message);
  }
  const task: TaskTag = {
    id: order.id,
    name: order.name,
    keepTab: order.keepTab,
    notify: order.notify,
    startedAt: Date.now(),
    ...(order.previous ? { previous: order.previous } : {}),
  };
  await patchSession(ensured.session.sessionId, { task });
  return success({ sessionId: ensured.session.sessionId, tabId: tab.id });
}

async function openBackgroundTab(url: string): Promise<{ id?: number; windowId?: number } | null> {
  const window = await browser.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (window?.id != null) return browser.tabs.create({ url, active: false, windowId: window.id }).catch(() => null);
  const created = await browser.windows
    .create({ url, ...(import.meta.env.FIREFOX ? {} : { focused: false }) })
    .catch(() => null);
  return created?.tabs?.[0] ?? null;
}

function loaded(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(watch);
      resolve();
    };
    const watch: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (id, change) => {
      if (id === tabId && change.status === 'complete') finish();
    };
    const timer = setTimeout(finish, TAB_LOAD_WAIT_MS);
    browser.tabs.onUpdated.addListener(watch);
    void browser.tabs
      .get(tabId)
      .then((tab) => tab.status === 'complete' && finish())
      .catch(finish);
  });
}

const contextOf = (order: TaskOrder): TaskContext => ({
  id: order.id,
  name: order.name,
  ...(order.previous ? { previous: order.previous } : {}),
});

async function beginTask(sessionId: string, order: TaskOrder): Promise<ActionResult> {
  const session = (await readTabSessions())[sessionId];
  if (!session) return failure('TAB_UNREACHABLE', 'The task’s tab was closed before it could start.');
  await append(sessionId, notice('info', `Scheduled task “${order.name}” started.`));
  if (order.job.kind === 'recording') return beginReplay(session, order, order.job);

  const outcome = await startTurn(session, order.job.text, { fastPath: false, task: contextOf(order) });
  if (outcome === 'started') return success({ sessionId });
  await abandonTask(session);
  return outcome === 'offline'
    ? failure('EXTENSION_OFFLINE', 'The link to the daemon dropped before the run could start.')
    : failure('RUN_IN_PROGRESS', 'The task’s conversation was already busy.');
}

async function beginReplay(
  session: TabSession,
  order: TaskOrder,
  job: Extract<TaskJob, { kind: 'recording' }>,
): Promise<ActionResult> {
  const workflow = (await readRecordingBody(job.recordingId))?.workflow;
  const plan = workflow
    ? planReplay(workflow, job.variables)
    : { ok: false as const, message: `The recording “${job.name}” is gone, or was never turned into steps.` };
  if (!plan.ok) {
    await abandonTask(session);
    return failure('REPLAY_UNAVAILABLE', plan.message);
  }
  void replay(session.sessionId, order, { name: job.name, goal: workflow!.goal }, plan.calls);
  return success({ sessionId: session.sessionId });
}

async function replay(
  sessionId: string,
  order: TaskOrder,
  recording: { name: string; goal: string },
  calls: ReplayCall[],
): Promise<void> {
  await serialized(() => append(sessionId, { kind: 'user', id: nextId(), text: `Replay the recording “${recording.name}”.` }));
  let extracted: string | undefined;
  for (const call of calls) {
    const tabId = (await readTabSessions())[sessionId]?.currentTabId;
    if (tabId === undefined) return;
    const result = await invokeForHarness(call.action, call.input, tabId).catch((error) =>
      failure('BRIDGE_ERROR', String(error)),
    );
    await serialized(() =>
      append(sessionId, {
        kind: 'tool',
        id: nextId(),
        action: call.action,
        input: redactInput(call.action, call.input),
        summary: call.intent,
        ok: result.ok,
        source: 'local',
      }),
    );
    if (!result.ok) {
      const error = `${result.error.code}: ${result.error.message}`;
      return handOver(sessionId, order, handOverPrompt({ ...recording, ...call, total: calls.length, error }), {
        outcome: 'failed',
        reason: `Step ${call.ordinal} (${call.intent}) failed — ${error}`,
      });
    }
    if (call.action === 'page.extractText') extracted = (result.data as { content?: string } | null)?.content;
  }
  await serialized(async () => {
    const session = (await readTabSessions())[sessionId];
    if (session) await finishTask(session, replayVerdict(calls.length, extracted));
  });
}

function handOver(sessionId: string, order: TaskOrder, prompt: string, fallback: TaskVerdict): Promise<void> {
  return serialized(async () => {
    const session = (await readTabSessions())[sessionId];
    if (!session) return;
    await append(sessionId, notice('info', 'The replay stopped, so the agent is taking over from there.'));
    const outcome = await startTurn(session, prompt, { fastPath: false, task: contextOf(order) });
    if (outcome !== 'started') await finishTask(session, fallback);
  });
}

async function finishTask(session: TabSession, verdict: TaskVerdict): Promise<void> {
  const { task } = session;
  if (!task || task.done) return;
  const result: TaskResult = {
    ...verdict,
    sessionId: session.sessionId,
    durationMs: Date.now() - task.startedAt,
    ...(session.usage ? { usage: session.usage } : {}),
  };
  await patchSession(session.sessionId, { task: { ...task, done: true } });
  reportTaskDone(task.id, result);
  await persist(session.sessionId);
  void announceTask(task, result, session.currentTabId);
  if (task.keepTab) await patchSession(session.sessionId, { task: undefined });
  else await browser.tabs.remove(session.tabIds).catch(() => undefined);
}

async function abandonTask(session: TabSession): Promise<void> {
  if (session.task) await patchSession(session.sessionId, { task: { ...session.task, done: true } });
  await browser.tabs.remove(session.tabIds).catch(() => undefined);
}

function reportAbandoned(session: TabSession, reason: string): void {
  if (!session.task || session.task.done) return;
  reportTaskDone(session.task.id, {
    outcome: 'cancelled',
    reason,
    sessionId: session.sessionId,
    durationMs: Date.now() - session.task.startedAt,
  });
}

const focusLabel = (focus: FocusedElement): string =>
  [focus.role ?? focus.tag, focus.label].filter(Boolean).join(' · ');

const MAX_CONTEXT_FILES = 12;

async function attachedFiles(session: TabSession): Promise<AttachedFile[]> {
  try {
    return (await filesFor(session.sessionId)).slice(0, MAX_CONTEXT_FILES).map((file) => ({
      id: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
      report: file.report,
      delivered: isDelivered(file.deliveredTo, session.agentSessionId),
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

async function contextBreakdown(session: TabSession, items: RunItem[]): Promise<ContextBreakdown> {
  const messages = { user: 0, assistant: 0, tools: 0, notices: 0, chars: 0 };
  for (const item of items) {
    if (item.kind === 'user') {
      messages.user += 1;
      messages.chars += item.text.length;
    } else if (item.kind === 'assistant') {
      messages.assistant += 1;
      messages.chars += item.text.length;
    } else if (item.kind === 'tool') messages.tools += 1;
    else if (item.kind === 'notice') messages.notices += 1;
  }
  const files = await filesFor(session.sessionId).catch(() => []);
  const ready = (await listRecordings().catch(() => [])).filter((recording) => recording.status === 'ready');
  return {
    agent: session.agent,
    resumes: session.agentSessionId !== undefined,
    usage: session.usage,
    turns: session.turns,
    tabCount: session.tabIds.length,
    host: session.host,
    messages,
    files: files.slice(0, MAX_CONTEXT_FILES).map((file) => ({ name: file.name, size: file.size, status: file.status })),
    filesOmitted: Math.max(0, files.length - MAX_CONTEXT_FILES),
    recordings: ready
      .slice(0, MAX_CONTEXT_RECORDINGS)
      .map((recording) => ({ name: recording.name, steps: recording.steps })),
    recordingsOmitted: Math.max(0, ready.length - MAX_CONTEXT_RECORDINGS),
    capturedAt: Date.now(),
  };
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
