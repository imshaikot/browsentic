import { browser } from 'wxt/browser';
import { hashManifest } from '@/lib/actions/manifest';
import {
  DAEMON_PORTS,
  SOCKET_PROTOCOL_VERSION,
  failure,
  parseFrame,
  type ActionResult,
  type RunContext,
  type RunEvent,
  type SavedSkill,
  type SocketAuth,
  type SocketFrame,
} from '@/lib/actions/protocol';
import { describeActions } from '@/lib/actions/registry';
import type { SkillDraft } from '@/lib/skills/format';
import type { SiteMapDraft } from '@/lib/skills/site-map';
import { invokeForHarness } from './invoke';

export const DAEMON_STATE_KEY = 'voicelink/daemon';
export const RECONNECT_ALARM = 'voicelink/reconnect';
const SESSION_KEY_STORE = 'voicelink/sessionKey';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export interface DaemonState {
  connected: boolean;
  paired: boolean;
  port?: number;
  daemonVersion?: string;
  manifestInSync?: boolean;
  error?: string;
  lastChangeAt: number;
}

let socket: WebSocket | null = null;
let attempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let runListener: ((runId: string, event: RunEvent) => void) | null = null;
const welcomeListeners = new Set<() => void>();
let draftListener: ((runId: string, draft: SiteMapDraft) => void) | null = null;

export function onSiteMapDraft(listener: (runId: string, draft: SiteMapDraft) => void): void {
  draftListener = listener;
}

export function onRunEvent(listener: (runId: string, event: RunEvent) => void): void {
  runListener = listener;
}

export function onWelcome(listener: () => void): void {
  welcomeListeners.add(listener);
}

export function sendInstruction(text: string, context?: RunContext): string | null {
  const id = crypto.randomUUID();
  return post({ t: 'instruct', id, text, context }) ? id : null;
}

const ANALYZE_TIMEOUT_MS = 90_000;

type FileNotes = { summary: string; digest?: string };

const pendingAnalyses = new Map<string, (result: ActionResult<FileNotes>) => void>();

export function analyzeFile(file: {
  name: string;
  mime: string;
  size: number;
  content: string;
}): Promise<ActionResult<FileNotes>> {
  const id = crypto.randomUUID();
  if (!post({ t: 'analyzeFile', id, ...file })) {
    return Promise.resolve(failure('EXTENSION_OFFLINE', 'No VoiceLink daemon is attached — pair the browser first.'));
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAnalyses.delete(id);
      resolve(failure('TIMEOUT', 'The daemon did not return a summary in time.'));
    }, ANALYZE_TIMEOUT_MS);
    pendingAnalyses.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

const TITLE_TIMEOUT_MS = 20_000;

const pendingSessionNames = new Map<string, (result: ActionResult<{ title: string }>) => void>();

export function nameSession(session: { host?: string; messages: string[] }): Promise<ActionResult<{ title: string }>> {
  const id = crypto.randomUUID();
  if (!post({ t: 'nameSession', id, ...session })) {
    return Promise.resolve(failure('EXTENSION_OFFLINE', 'No VoiceLink daemon is attached — pair the browser first.'));
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingSessionNames.delete(id);
      resolve(failure('TIMEOUT', 'The daemon did not return a name in time.'));
    }, TITLE_TIMEOUT_MS);
    pendingSessionNames.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

const SKILL_TIMEOUT_MS = 15_000;

const pendingSkillOps = new Map<string, (result: ActionResult<SavedSkill>) => void>();

export function saveSkill(skill: SkillDraft): Promise<ActionResult<SavedSkill>> {
  return skillOp({ t: 'saveSkill', id: crypto.randomUUID(), skill });
}

export function deleteSkill(name: string): Promise<ActionResult<SavedSkill>> {
  return skillOp({ t: 'deleteSkill', id: crypto.randomUUID(), name });
}

export function deleteSiteMap(name: string): Promise<ActionResult<SavedSkill>> {
  return skillOp({ t: 'deleteSiteMap', id: crypto.randomUUID(), name });
}

export function activateSiteMap(stagingId: string, exactHost = false): Promise<ActionResult<SavedSkill>> {
  return skillOp({ t: 'activateSiteMap', id: crypto.randomUUID(), stagingId, exactHost });
}

export function discardSiteMap(stagingId: string): Promise<ActionResult<SavedSkill>> {
  return skillOp({ t: 'discardSiteMap', id: crypto.randomUUID(), stagingId });
}

function skillOp(
  frame: Extract<
    SocketFrame,
    { t: 'saveSkill' | 'deleteSkill' | 'deleteSiteMap' | 'activateSiteMap' | 'discardSiteMap' }
  >,
): Promise<ActionResult<SavedSkill>> {
  if (!post(frame)) {
    return Promise.resolve(failure('EXTENSION_OFFLINE', 'No VoiceLink daemon is attached — pair the browser first.'));
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingSkillOps.delete(frame.id);
      resolve(failure('TIMEOUT', 'The daemon did not answer in time.'));
    }, SKILL_TIMEOUT_MS);
    pendingSkillOps.set(frame.id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

export function cancelRun(id: string): boolean {
  return post({ t: 'cancel', id });
}

export function sendDecision(id: string, toolId: string, allow: boolean): void {
  post({ t: 'decision', id, toolId, allow });
}

export function resetConversation(): void {
  post({ t: 'reset' });
}

function post(frame: SocketFrame): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  send(socket, frame);
  return true;
}

export async function connectDaemon(): Promise<void> {
  if (isLive()) return;
  const sessionKey = await storedSessionKey();
  if (!sessionKey) {
    await setState({ connected: false, paired: false, lastChangeAt: Date.now() });
    return;
  }
  clearTimeout(reconnectTimer);
  dial({ sessionKey }, 0);
}

export async function pairDaemon(pairingToken: string): Promise<{ ok: boolean; error?: string }> {
  const code = pairingToken.replace(/[\s-]/g, '').toUpperCase();
  if (!code) return { ok: false, error: 'Enter the pairing code from "voicelink-mcp pair".' };

  disconnectSocket();
  clearTimeout(reconnectTimer);
  attempts = 0;
  return new Promise((resolve) => {
    pairingResult = resolve;
    dial({ pairingToken: code }, 0);
    setTimeout(() => settlePairing({ ok: false, error: 'No VoiceLink daemon is running. Start one with "voicelink-mcp pair".' }), 8_000);
  });
}

export async function disconnectDaemon(): Promise<void> {
  clearTimeout(reconnectTimer);
  disconnectSocket();
  await browser.storage.local.remove(SESSION_KEY_STORE);
  await setState({ connected: false, paired: false, lastChangeAt: Date.now() });
}

let pairingResult: ((result: { ok: boolean; error?: string }) => void) | null = null;

function settlePairing(result: { ok: boolean; error?: string }): void {
  pairingResult?.(result);
  pairingResult = null;
}

function isLive(): boolean {
  return !!socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);
}

function disconnectSocket(): void {
  const closing = socket;
  socket = null;
  try {
    closing?.close(1000, 'client disconnecting');
  } catch {
  }
}

function dial(auth: SocketAuth, portIndex: number): void {
  if (portIndex >= DAEMON_PORTS.length) {
    settlePairing({ ok: false, error: 'No VoiceLink daemon is running.' });
    if ('sessionKey' in auth) scheduleRetry(auth);
    return;
  }

  const port = DAEMON_PORTS[portIndex];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
  socket = ws;
  let opened = false;

  ws.onopen = () => {
    opened = true;
    attempts = 0;
    send(ws, {
      t: 'hello',
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      extensionVersion: browser.runtime.getManifest().version,
      manifestHash: hashManifest(describeActions()),
      auth,
    });
  };

  ws.onmessage = (event) => {
    void handle(ws, String(event.data), port, auth);
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (!opened) return dial(auth, portIndex + 1);
    void setState({ connected: false, paired: true, lastChangeAt: Date.now() });
    if ('sessionKey' in auth) scheduleRetry(auth);
  };
}

async function handle(ws: WebSocket, raw: string, port: number, auth: SocketAuth): Promise<void> {
  const frame = parseFrame(raw);
  if (!frame) return;
  switch (frame.t) {
    case 'ping':
      return send(ws, { t: 'pong', id: frame.id });

    case 'unauthorized': {
      if (!frame.retryable) await browser.storage.local.remove(SESSION_KEY_STORE);
      clearTimeout(reconnectTimer);
      settlePairing({ ok: false, error: frame.reason });
      await setState({
        connected: false,
        paired: frame.retryable && !('pairingToken' in auth),
        error: frame.reason,
        lastChangeAt: Date.now(),
      });
      return;
    }

    case 'welcome':
      if (frame.sessionKey) await browser.storage.local.set({ [SESSION_KEY_STORE]: frame.sessionKey });
      settlePairing({ ok: true });
      await setState({
        connected: true,
        paired: true,
        port,
        daemonVersion: frame.daemonVersion,
        manifestInSync: frame.manifestInSync,
        lastChangeAt: Date.now(),
      });
      for (const listener of welcomeListeners) listener();
      return;

    case 'describe':
      return send(ws, { t: 'manifest', id: frame.id, tools: describeActions() });

    case 'invoke':
      return send(ws, {
        t: 'result',
        id: frame.id,
        result: await invokeForHarness(frame.action, frame.input, frame.tabId),
      });

    case 'run':
      return runListener?.(frame.id, frame.event);

    case 'fileSummary': {
      pendingAnalyses.get(frame.id)?.(frame.result);
      pendingAnalyses.delete(frame.id);
      return;
    }

    case 'skillResult': {
      pendingSkillOps.get(frame.id)?.(frame.result);
      pendingSkillOps.delete(frame.id);
      return;
    }

    case 'sessionName': {
      pendingSessionNames.get(frame.id)?.(frame.result);
      pendingSessionNames.delete(frame.id);
      return;
    }

    case 'siteMapDraft':
      return draftListener?.(frame.id, frame.draft);

    default:
      return;
  }
}

function send(ws: WebSocket, frame: SocketFrame): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

function scheduleRetry(auth: SocketAuth): void {
  const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempts++);
  const delay = backoff * (0.5 + Math.random() / 2);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => dial(auth, 0), delay);
}

function setState(state: DaemonState): Promise<void> {
  return browser.storage.session.set({ [DAEMON_STATE_KEY]: state });
}

async function storedSessionKey(): Promise<string | null> {
  const stored = await browser.storage.local.get(SESSION_KEY_STORE);
  const key = stored[SESSION_KEY_STORE];
  return typeof key === 'string' && key ? key : null;
}
