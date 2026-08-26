import type { ToolDescriptor } from './manifest';
import type { AgentKind, AgentState } from '@/lib/agents/catalog';
import type { MonitorSample } from '@/lib/monitor/events';
import type { RecordedEvent } from '@/lib/recordings/events';
import type { RecordingWorkflow } from '@/lib/recordings/workflow';
import type { GuardrailSettings, GuardrailValue } from '@/lib/settings/guardrails';
import type { SkillDraft } from '@/lib/skills/format';
import type { SiteMapDraft } from '@/lib/skills/site-map';

export const ACTION_CHANNEL = 'browsentic/action';
export const BRIDGE_CHANNEL = 'browsentic/bridge';

export const SOCKET_PROTOCOL_VERSION = 12;

export const EXTERNAL_RUN_ID = 'external';

export const DAEMON_PORTS = [8765, 8766, 8767] as const;

export interface ActionInvocation {
  channel: typeof ACTION_CHANNEL;
  action: string;
  input?: unknown;
}

export type BridgeRequest =
  | { channel: typeof BRIDGE_CHANNEL; op: 'describe' }
  | { channel: typeof BRIDGE_CHANNEL; op: 'invoke'; action: string; input?: unknown }
  | { channel: typeof BRIDGE_CHANNEL; op: 'pair'; token: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'disconnect' }
  | { channel: typeof BRIDGE_CHANNEL; op: 'panelOpened' }
  | { channel: typeof BRIDGE_CHANNEL; op: 'analyzeFile'; fileId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'saveSkill'; skillId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'removeSkill'; skillId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'nameSession'; sessionId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'recordEvents'; events: RecordedEvent[] }
  | { channel: typeof BRIDGE_CHANNEL; op: 'recordingState' }
  | { channel: typeof BRIDGE_CHANNEL; op: 'analyzeRecording'; recordingId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'monitorSample'; monitorId: string; sample: MonitorSample }
  | { channel: typeof BRIDGE_CHANNEL; op: 'monitorState' }
  | { channel: typeof BRIDGE_CHANNEL; op: 'agentState'; refresh?: boolean }
  | { channel: typeof BRIDGE_CHANNEL; op: 'setAgent'; agent: AgentKind }
  | { channel: typeof BRIDGE_CHANNEL; op: 'grantAgent'; agent: AgentKind }
  | { channel: typeof BRIDGE_CHANNEL; op: 'guardrails' }
  | { channel: typeof BRIDGE_CHANNEL; op: 'setGuardrail'; setting: string; value: GuardrailValue };

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type RunEvent =
  | { kind: 'started'; skill: string; overlays?: string[] }
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; toolId: string; action: string; input: unknown; source?: 'local' | 'external' }
  | { kind: 'approval'; toolId: string; action: string; input: unknown; site?: string }
  | { kind: 'toolResult'; toolId: string; ok: boolean; summary: string }
  | { kind: 'session'; agent: AgentKind; agentSessionId: string | null }
  | { kind: 'done'; stopReason: string }
  | { kind: 'error'; code: string; message: string };

/** Which secret the extension is about to prove it holds. The secret itself never crosses the wire. */
export type SocketAuth = { kind: 'pair' } | { kind: 'session' };

export interface AttachedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  status: 'pending' | 'ready' | 'error';
  summary?: string;
  digest?: string;
}

export interface SavedRecording {
  id: string;
  name: string;
  host: string;
  goal?: string;
  steps?: number;
  capturedValues: boolean;
  durationMs: number;
}

export interface RecordingPayload {
  id: string;
  name: string;
  host: string;
  startUrl: string;
  captureValues: boolean;
  durationMs: number;
  events: RecordedEvent[];
}

export interface RunContext {
  url?: string;
  tabId?: number;
  /** The tab-bound conversation this run belongs to. Scopes one-at-a-time and the held conversation. */
  sessionId?: string;
  files?: AttachedFile[];
  recordings?: SavedRecording[];
  /** The agent that issued `agentSessionId`; a different agent cannot resume it. */
  agent?: AgentKind;
  agentSessionId?: string;
}

export type SocketFrame =
  | {
      t: 'hello';
      protocolVersion: number;
      extensionVersion: string;
      manifestHash: string;
      auth: SocketAuth;
      nonce: string;
    }
  | { t: 'challenge'; nonce: string }
  | { t: 'prove'; proof: string }
  | {
      t: 'welcome';
      daemonVersion: string;
      manifestHash: string;
      manifestInSync: boolean;
      /** Proves the daemon holds the same secret, so a port squatter cannot pose as one. */
      proof: string;
      sealedSessionKey?: string;
    }
  | { t: 'unauthorized'; reason: string; retryable: boolean }
  | { t: 'describe'; id: string }
  | { t: 'manifest'; id: string; tools: ToolDescriptor[] }
  | { t: 'invoke'; id: string; action: string; input?: unknown; tabId?: number; runId?: string }
  | { t: 'result'; id: string; result: ActionResult }
  | { t: 'ping'; id: string }
  | { t: 'pong'; id: string }
  | { t: 'instruct'; id: string; text: string; context?: RunContext }
  | { t: 'cancel'; id: string }
  | { t: 'decision'; id: string; toolId: string; allow: boolean; remember?: boolean }
  | { t: 'reset'; sessionId?: string }
  | { t: 'run'; id: string; event: RunEvent }
  | { t: 'analyzeFile'; id: string; name: string; mime: string; size: number; content: string }
  | { t: 'fileSummary'; id: string; result: ActionResult<{ summary: string; digest?: string }> }
  | { t: 'saveSkill'; id: string; skill: SkillDraft }
  | { t: 'deleteSkill'; id: string; name: string }
  | { t: 'deleteSiteMap'; id: string; name: string }
  | { t: 'skillResult'; id: string; result: ActionResult<SavedSkill> }
  | { t: 'siteMapDraft'; id: string; draft: SiteMapDraft }
  | { t: 'activateSiteMap'; id: string; stagingId: string; exactHost?: boolean }
  | { t: 'discardSiteMap'; id: string; stagingId: string }
  | { t: 'nameSession'; id: string; host?: string; messages: string[] }
  | { t: 'sessionName'; id: string; result: ActionResult<{ title: string }> }
  | { t: 'analyzeRecording'; id: string; recording: RecordingPayload }
  | { t: 'recordingWorkflow'; id: string; result: ActionResult<RecordingAnalysis> }
  | { t: 'agentState'; id: string; refresh?: boolean }
  | { t: 'setAgent'; id: string; agent: AgentKind }
  | { t: 'grantAgent'; id: string; agent: AgentKind }
  | { t: 'agentInfo'; id: string; result: ActionResult<AgentState> }
  | { t: 'guardrails'; id: string }
  | { t: 'setGuardrail'; id: string; setting: string; value: GuardrailValue }
  | { t: 'guardrailInfo'; id: string; result: ActionResult<GuardrailSettings> };

export interface RecordingAnalysis {
  workflow: RecordingWorkflow;
  warnings: string[];
}

export interface SavedSkill {
  name: string;
  path?: string;
  replaced?: boolean;
}

export const EXTENSION_REQUEST_FRAMES = [
  'instruct',
  'cancel',
  'decision',
  'reset',
  'analyzeFile',
  'saveSkill',
  'deleteSkill',
  'deleteSiteMap',
  'activateSiteMap',
  'discardSiteMap',
  'nameSession',
  'analyzeRecording',
  'agentState',
  'setAgent',
  'grantAgent',
  'guardrails',
  'setGuardrail',
] as const;

export type ExtensionRequest = Extract<SocketFrame, { t: (typeof EXTENSION_REQUEST_FRAMES)[number] }>;

export function isExtensionRequest(frame: SocketFrame): frame is ExtensionRequest {
  return (EXTENSION_REQUEST_FRAMES as readonly string[]).includes(frame.t);
}

export function parseFrame(raw: string): SocketFrame | null {
  try {
    const frame = JSON.parse(raw);
    return typeof frame?.t === 'string' ? (frame as SocketFrame) : null;
  } catch {
    return null;
  }
}

export const success = <T>(data: T): ActionResult<T> => ({ ok: true, data });

export const failure = (code: string, message: string): ActionResult<never> => ({
  ok: false,
  error: { code, message },
});

export function isActionInvocation(message: unknown): message is ActionInvocation {
  return isOnChannel(message, ACTION_CHANNEL) && typeof (message as ActionInvocation).action === 'string';
}

export function isBridgeRequest(message: unknown): message is BridgeRequest {
  return isOnChannel(message, BRIDGE_CHANNEL);
}

function isOnChannel(message: unknown, channel: string): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { channel?: unknown }).channel === channel
  );
}
