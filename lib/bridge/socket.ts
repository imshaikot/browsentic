import { browser } from 'wxt/browser';
import { hashManifest } from '@/lib/actions/manifest';
import {
  clientProof,
  isNonce,
  newNonce,
  openSessionKey,
  pairingSecret,
  sameProof,
  serverProof,
  type Transcript,
} from '@/lib/actions/handshake';
import {
  DAEMON_PORTS,
  SOCKET_PROTOCOL_VERSION,
  failure,
  parseFrame,
  type ActionResult,
  type RecordingAnalysis,
  type RecordingPayload,
  type RunContext,
  type RunEvent,
  type SavedSkill,
  type SocketFrame,
} from '@/lib/actions/protocol';
import { describeActions } from '@/lib/actions/registry';
import type { AgentKind, AgentState } from '@/lib/agents/catalog';
import type { SkillDraft } from '@/lib/skills/format';
import type { SiteMapDraft } from '@/lib/skills/site-map';
import { invokeForHarness } from './invoke';

export const DAEMON_STATE_KEY = 'browsentic/daemon';
export const RECONNECT_ALARM = 'browsentic/reconnect';
const SESSION_KEY_STORE = 'browsentic/sessionKey';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const PAIRING_TIMEOUT_MS = 20_000;

/** The secret itself stays here; only a proof derived from it ever reaches the socket. */
interface Credential {
  kind: 'pair' | 'session';
  secret: string;
}

interface Refusal {
  reason: string;
  retryable: boolean;
}

interface Attempt {
  credential: Credential;
  port: number;
  hello: { extensionVersion: string; manifestHash: string; nonce: string };
  serverNonce?: string;
  secret?: string;
  done(): void;
  /** Abandon this port and try the next one, because the peer never proved it is the daemon. */
  walk(refusal?: Refusal): void;
}

export interface DaemonState {
  connected: boolean;
  paired: boolean;
  port?: number;
  daemonVersion?: string;
  manifestInSync?: boolean;
  /** Which agent CLI the daemon runs, and what each one's state is. Pushed on connect. */
  agent?: AgentState;
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
    return Promise.resolve(failure('EXTENSION_OFFLINE', 'No Browsentic daemon is attached — pair the browser first.'));
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

const RECORDING_TIMEOUT_MS = 120_000;

const pendingRecordings = new Map<string, (result: ActionResult<RecordingAnalysis>) => void>();

export function analyzeRecording(recording: RecordingPayload): Promise<ActionResult<RecordingAnalysis>> {
  const id = crypto.randomUUID();
  if (!post({ t: 'analyzeRecording', id, recording })) {
    return Promise.resolve(failure('EXTENSION_OFFLINE', 'No Browsentic daemon is attached — pair the browser first.'));
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRecordings.delete(id);
      resolve(failure('TIMEOUT', 'The daemon did not return a workflow in time.'));
    }, RECORDING_TIMEOUT_MS);
    pendingRecordings.set(id, (result) => {
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
    return Promise.resolve(failure('EXTENSION_OFFLINE', 'No Browsentic daemon is attached — pair the browser first.'));
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
    return Promise.resolve(failure('EXTENSION_OFFLINE', 'No Browsentic daemon is attached — pair the browser first.'));
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

const AGENT_TIMEOUT_MS = 20_000;

const pendingAgentOps = new Map<string, (result: ActionResult<AgentState>) => void>();

export function readAgentState(refresh = false): Promise<ActionResult<AgentState>> {
  return agentOp({ t: 'agentState', id: crypto.randomUUID(), refresh });
}

export function chooseAgent(agent: AgentKind): Promise<ActionResult<AgentState>> {
  return agentOp({ t: 'setAgent', id: crypto.randomUUID(), agent });
}

export function setUpAgent(agent: AgentKind): Promise<ActionResult<AgentState>> {
  return agentOp({ t: 'grantAgent', id: crypto.randomUUID(), agent });
}

function agentOp(
  frame: Extract<SocketFrame, { t: 'agentState' | 'setAgent' | 'grantAgent' }>,
): Promise<ActionResult<AgentState>> {
  if (!post(frame)) {
    return Promise.resolve(failure('EXTENSION_OFFLINE', 'No Browsentic daemon is attached — pair the browser first.'));
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAgentOps.delete(frame.id);
      resolve(failure('TIMEOUT', 'The daemon did not answer in time.'));
    }, AGENT_TIMEOUT_MS);
    pendingAgentOps.set(frame.id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

export function cancelRun(id: string): boolean {
  return post({ t: 'cancel', id });
}

export function sendDecision(id: string, toolId: string, allow: boolean, remember?: boolean): void {
  post({ t: 'decision', id, toolId, allow, remember });
}

export function resetConversation(sessionId?: string): void {
  post({ t: 'reset', sessionId });
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
    await setState({ connected: false, paired: false, error: undefined, lastChangeAt: Date.now() });
    return;
  }
  // A daemon that proved itself and still refused this key will refuse it again. Wait for the user
  // to pair rather than discarding a credential on the word of a peer that never proved anything.
  const state = await readState();
  if (state && !state.paired && state.error) return;
  clearTimeout(reconnectTimer);
  dial({ kind: 'session', secret: sessionKey }, 0);
}

export async function pairDaemon(pairingToken: string): Promise<{ ok: boolean; error?: string }> {
  const code = pairingToken.replace(/[\s-]/g, '').toUpperCase();
  if (!code) return { ok: false, error: 'Enter the pairing code from "browsentic-mcp pair".' };

  disconnectSocket();
  clearTimeout(reconnectTimer);
  attempts = 0;
  return new Promise((resolve) => {
    pairingResult = resolve;
    dial({ kind: 'pair', secret: code }, 0);
    setTimeout(
      () => settlePairing({ ok: false, error: 'No Browsentic daemon is running. Start one with "browsentic-mcp pair".' }),
      PAIRING_TIMEOUT_MS,
    );
  });
}

export async function disconnectDaemon(): Promise<void> {
  clearTimeout(reconnectTimer);
  disconnectSocket();
  await browser.storage.local.remove(SESSION_KEY_STORE);
  await setState({ connected: false, paired: false, error: undefined, agent: undefined, lastChangeAt: Date.now() });
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
  if (!closing) return;
  closing.onopen = null;
  closing.onmessage = null;
  closing.onclose = null;
  try {
    closing.close(1000, 'client disconnecting');
  } catch {
  }
}

function dial(credential: Credential, portIndex: number, carried?: Refusal): void {
  if (portIndex >= DAEMON_PORTS.length) return giveUp(credential, carried);

  const port = DAEMON_PORTS[portIndex];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`);
  socket = ws;
  let settled = false;
  let welcomed = false;
  let refusal = carried;

  const attempt: Attempt = {
    credential,
    port,
    hello: {
      extensionVersion: browser.runtime.getManifest().version,
      manifestHash: hashManifest(describeActions()),
      nonce: newNonce(),
    },
    done() {
      settled = true;
      welcomed = true;
      clearTimeout(handshakeTimer);
    },
    walk(why) {
      if (settled) return;
      settled = true;
      refusal = why ?? carried;
      clearTimeout(handshakeTimer);
      try {
        ws.close(1000, 'unproven daemon');
      } catch {
      }
    },
  };

  const handshakeTimer = setTimeout(() => attempt.walk(), HANDSHAKE_TIMEOUT_MS);

  ws.onopen = () => {
    send(ws, {
      t: 'hello',
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      extensionVersion: attempt.hello.extensionVersion,
      manifestHash: attempt.hello.manifestHash,
      auth: { kind: credential.kind },
      nonce: attempt.hello.nonce,
    });
  };

  ws.onmessage = (event) => {
    void handle(ws, String(event.data), attempt);
  };

  ws.onclose = (event) => {
    clearTimeout(handshakeTimer);
    if (socket === ws) socket = null;
    // A daemon that refuses the handshake outright — a protocol mismatch above all — says why in
    // the close frame and never sends an `unauthorized`. Without this the walk ends on the generic
    // "no daemon is running", which sends the user hunting for a process that is running fine.
    refusal ??= closeRefusal(event);
    // Nothing on this port ever proved itself — a squatter, a stale daemon, an empty port — so the
    // walk continues instead of pinning the extension to whoever answered first.
    if (!welcomed) return dial(credential, portIndex + 1, refusal);
    void setState({ connected: false, paired: true, error: undefined, lastChangeAt: Date.now() });
    if (credential.kind === 'session') scheduleRetry(credential);
  };
}

const OWN_CLOSE = new Set(['unproven daemon', '']);

function closeRefusal(event: CloseEvent): Refusal | undefined {
  const reason = event.reason?.trim();
  if (!reason || OWN_CLOSE.has(reason)) return undefined;
  return /protocol version mismatch/i.test(reason)
    ? { reason: `${reason}. Rebuild and reload the extension — “yarn build”, then Reload at chrome://extensions.`, retryable: false }
    : { reason, retryable: true };
}

function giveUp(credential: Credential, refusal?: Refusal): void {
  if (refusal && !refusal.retryable) {
    settlePairing({ ok: false, error: refusal.reason });
    void setState({ connected: false, paired: false, error: refusal.reason, lastChangeAt: Date.now() });
    return;
  }
  settlePairing({ ok: false, error: refusal?.reason ?? 'No Browsentic daemon is running.' });
  if (credential.kind === 'session') scheduleRetry(credential);
}

function transcriptOf(attempt: Attempt): Transcript {
  return {
    protocolVersion: SOCKET_PROTOCOL_VERSION,
    extensionVersion: attempt.hello.extensionVersion,
    manifestHash: attempt.hello.manifestHash,
    clientNonce: attempt.hello.nonce,
    serverNonce: attempt.serverNonce ?? '',
  };
}

async function handle(ws: WebSocket, raw: string, attempt: Attempt): Promise<void> {
  const frame = parseFrame(raw);
  if (!frame) return;
  switch (frame.t) {
    case 'ping':
      return send(ws, { t: 'pong', id: frame.id });

    case 'challenge': {
      if (!isNonce(frame.nonce) || attempt.serverNonce) return attempt.walk();
      attempt.serverNonce = frame.nonce;
      const transcript = transcriptOf(attempt);
      attempt.secret =
        attempt.credential.kind === 'pair'
          ? await pairingSecret(attempt.credential.secret, transcript)
          : attempt.credential.secret;
      return send(ws, { t: 'prove', proof: await clientProof(attempt.secret, transcript) });
    }

    // Nothing has proved itself yet, so this is a claim, not a verdict: note it and try the next port.
    case 'unauthorized':
      return attempt.walk({ reason: frame.reason, retryable: frame.retryable !== false });

    case 'welcome': {
      const secret = attempt.secret;
      if (!secret) return attempt.walk();
      const transcript = transcriptOf(attempt);
      const sealed = frame.sealedSessionKey ?? '';
      if (!sameProof(frame.proof, await serverProof(secret, transcript, frame))) {
        return attempt.walk({
          reason: `Whatever is listening on port ${attempt.port} could not prove it is the Browsentic daemon.`,
          retryable: true,
        });
      }
      const sessionKey = sealed ? await openSessionKey(secret, transcript, sealed) : null;
      if (!sessionKey && (sealed || attempt.credential.kind === 'pair')) return attempt.walk();

      attempt.done();
      attempts = 0;
      if (sessionKey) await browser.storage.local.set({ [SESSION_KEY_STORE]: sessionKey });
      settlePairing({ ok: true });
      await setState({
        connected: true,
        paired: true,
        port: attempt.port,
        daemonVersion: frame.daemonVersion,
        manifestInSync: frame.manifestInSync,
        error: undefined,
        lastChangeAt: Date.now(),
      });
      for (const listener of welcomeListeners) listener();
      return;
    }

    case 'describe':
      return send(ws, { t: 'manifest', id: frame.id, tools: describeActions() });

    case 'invoke':
      return send(ws, {
        t: 'result',
        id: frame.id,
        result: await invokeForHarness(frame.action, frame.input, frame.tabId, frame.runId),
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

    case 'recordingWorkflow': {
      pendingRecordings.get(frame.id)?.(frame.result);
      pendingRecordings.delete(frame.id);
      return;
    }

    case 'agentInfo': {
      pendingAgentOps.get(frame.id)?.(frame.result);
      pendingAgentOps.delete(frame.id);
      if (frame.result.ok) await setState({ agent: frame.result.data, lastChangeAt: Date.now() });
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

function scheduleRetry(credential: Credential): void {
  const backoff = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempts++);
  const delay = backoff * (0.5 + Math.random() / 2);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => dial(credential, 0), delay);
}

async function readState(): Promise<DaemonState | undefined> {
  const stored = await browser.storage.session.get(DAEMON_STATE_KEY);
  return stored[DAEMON_STATE_KEY] as DaemonState | undefined;
}

async function setState(patch: Partial<DaemonState> & { lastChangeAt: number }): Promise<void> {
  const current = (await readState()) ?? { connected: false, paired: false, lastChangeAt: 0 };
  await browser.storage.session.set({ [DAEMON_STATE_KEY]: { ...current, ...patch } });
}

async function storedSessionKey(): Promise<string | null> {
  const stored = await browser.storage.local.get(SESSION_KEY_STORE);
  const key = stored[SESSION_KEY_STORE];
  return typeof key === 'string' && key ? key : null;
}
