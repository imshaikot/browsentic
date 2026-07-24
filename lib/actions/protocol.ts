import type { ToolDescriptor } from './manifest';

export const ACTION_CHANNEL = 'voicelink/action';
export const BRIDGE_CHANNEL = 'voicelink/bridge';

/** Bumped whenever the socket frames below change shape incompatibly. */
export const SOCKET_PROTOCOL_VERSION = 3;

/** Loopback ports the daemon binds, in order; the extension probes the same list. */
export const DAEMON_PORTS = [8765, 8766, 8767] as const;

/** Sent to a tab's content script to run one action there. */
export interface ActionInvocation {
  channel: typeof ACTION_CHANNEL;
  action: string;
  input?: unknown;
}

/** Sent to the background worker by extension pages. */
export type BridgeRequest =
  | { channel: typeof BRIDGE_CHANNEL; op: 'describe' }
  | { channel: typeof BRIDGE_CHANNEL; op: 'invoke'; action: string; input?: unknown }
  | { channel: typeof BRIDGE_CHANNEL; op: 'pair'; token: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'disconnect' }
  // Summarize a stored file: the worker reads its bytes from storage, runs the daemon
  // round-trip, and writes the summary back to the file index. Only the id crosses here.
  | { channel: typeof BRIDGE_CHANNEL; op: 'analyzeFile'; fileId: string };

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * One step of an agent run, streamed from the daemon to whichever extension page is watching.
 * Lives here rather than in `mcp/` because both ends render it — the daemon emits, the side
 * panel draws — and a second copy would drift.
 */
export type RunEvent =
  /** The router picked a skill; the loop is about to start. */
  | { kind: 'started'; skill: string }
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; toolId: string; action: string; input: unknown }
  /** The action needs the user's blessing before it runs; answer with a `decision` frame. */
  | { kind: 'approval'; toolId: string; action: string; input: unknown }
  | { kind: 'toolResult'; toolId: string; ok: boolean; summary: string }
  | { kind: 'done'; stopReason: string }
  | { kind: 'error'; code: string; message: string };

/**
 * How the extension proves it may drive the browser. A `pairingToken` is the one-time code
 * from `voicelink-mcp pair`, exchanged for a long-lived `sessionKey` that later connects reuse.
 *
 * This travels in the `hello` frame rather than an `Authorization` header because the browser
 * WebSocket API cannot set request headers — and a frame keeps the credential out of the URL,
 * so it never reaches a log or a process list.
 */
export type SocketAuth = { pairingToken: string } | { sessionKey: string };

/**
 * Frames on the daemon socket. The extension dials out because an MV3 service worker
 * cannot listen, so the daemon is the server and drives every invocation.
 */
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
      /** Present only on the connect that redeemed a pairing token — store it and reuse it. */
      sessionKey?: string;
    }
  | { t: 'unauthorized'; reason: string; retryable: boolean }
  | { t: 'describe'; id: string }
  | { t: 'manifest'; id: string; tools: ToolDescriptor[] }
  | { t: 'invoke'; id: string; action: string; input?: unknown }
  | { t: 'result'; id: string; result: ActionResult }
  | { t: 'ping'; id: string }
  | { t: 'pong'; id: string }
  // The agent harness. These four run the other way: the extension asks the daemon to think,
  // and the daemon answers by invoking actions back down the same socket.
  | { t: 'instruct'; id: string; text: string }
  | { t: 'cancel'; id: string }
  | { t: 'decision'; id: string; toolId: string; allow: boolean }
  | { t: 'reset' }
  | { t: 'run'; id: string; event: RunEvent }
  // A file the user attached in the extension, sent for one-shot summarization; the daemon
  // answers with a `fileSummary` carrying the same `id`. `content` is base64. This runs
  // outside the agent conversation — no skill, no browser tools, no single-run lock.
  | { t: 'analyzeFile'; id: string; name: string; mime: string; size: number; content: string }
  | { t: 'fileSummary'; id: string; result: ActionResult<{ summary: string }> };

/** Frames the extension sends unprompted, rather than as a reply to a daemon request. */
export const EXTENSION_REQUEST_FRAMES = ['instruct', 'cancel', 'decision', 'reset', 'analyzeFile'] as const;

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
