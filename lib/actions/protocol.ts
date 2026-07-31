import type { ToolDescriptor } from './manifest';
import type { RecordedEvent } from '@/lib/recordings/events';
import type { RecordingWorkflow } from '@/lib/recordings/workflow';
import type { SkillDraft } from '@/lib/skills/format';
import type { SiteMapDraft } from '@/lib/skills/site-map';

export const ACTION_CHANNEL = 'voicelink/action';
export const BRIDGE_CHANNEL = 'voicelink/bridge';

export const SOCKET_PROTOCOL_VERSION = 7;

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
  | { channel: typeof BRIDGE_CHANNEL; op: 'analyzeFile'; fileId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'saveSkill'; skillId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'removeSkill'; skillId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'nameSession'; sessionId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'recordEvents'; events: RecordedEvent[] }
  | { channel: typeof BRIDGE_CHANNEL; op: 'recordingState' }
  | { channel: typeof BRIDGE_CHANNEL; op: 'analyzeRecording'; recordingId: string };

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type RunEvent =
  | { kind: 'started'; skill: string; overlays?: string[] }
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; toolId: string; action: string; input: unknown; source?: 'local' | 'external' }
  | { kind: 'approval'; toolId: string; action: string; input: unknown }
  | { kind: 'toolResult'; toolId: string; ok: boolean; summary: string }
  | { kind: 'session'; claudeSessionId: string | null }
  | { kind: 'done'; stopReason: string }
  | { kind: 'error'; code: string; message: string };

export type SocketAuth = { pairingToken: string } | { sessionKey: string };

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
  files?: AttachedFile[];
  recordings?: SavedRecording[];
  claudeSessionId?: string;
}

export type SocketFrame =
  | {
      t: 'hello';
      protocolVersion: number;
      extensionVersion: string;
      manifestHash: string;
      auth: SocketAuth;
    }
  | {
      t: 'welcome';
      daemonVersion: string;
      manifestHash: string;
      manifestInSync: boolean;
      sessionKey?: string;
    }
  | { t: 'unauthorized'; reason: string; retryable: boolean }
  | { t: 'describe'; id: string }
  | { t: 'manifest'; id: string; tools: ToolDescriptor[] }
  | { t: 'invoke'; id: string; action: string; input?: unknown; tabId?: number }
  | { t: 'result'; id: string; result: ActionResult }
  | { t: 'ping'; id: string }
  | { t: 'pong'; id: string }
  | { t: 'instruct'; id: string; text: string; context?: RunContext }
  | { t: 'cancel'; id: string }
  | { t: 'decision'; id: string; toolId: string; allow: boolean }
  | { t: 'reset' }
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
  | { t: 'recordingWorkflow'; id: string; result: ActionResult<RecordingAnalysis> };

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
