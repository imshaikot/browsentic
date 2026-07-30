import type { ToolDescriptor } from './manifest';
import type { SkillDraft } from '@/lib/skills/format';
import type { SiteMapDraft } from '@/lib/skills/site-map';

export const ACTION_CHANNEL = 'voicelink/action';
export const BRIDGE_CHANNEL = 'voicelink/bridge';

/** Bumped whenever the socket frames below change shape incompatibly. */
export const SOCKET_PROTOCOL_VERSION = 6;

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
  | { channel: typeof BRIDGE_CHANNEL; op: 'analyzeFile'; fileId: string }
  // Push an uploaded skill to the daemon's skills directory, or take it back off. Same shape
  // as `analyzeFile`: the worker owns the socket, so it reads the body from storage itself.
  | { channel: typeof BRIDGE_CHANNEL; op: 'saveSkill'; skillId: string }
  | { channel: typeof BRIDGE_CHANNEL; op: 'removeSkill'; skillId: string }
  // Name a saved session. Same shape again: the worker reads the transcript from storage, runs the
  // daemon round-trip, and writes the title back to the session index — so the name still lands if
  // the panel that asked for it has since closed.
  | { channel: typeof BRIDGE_CHANNEL; op: 'nameSession'; sessionId: string };

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * One step of an agent run, streamed from the daemon to whichever extension page is watching.
 * Lives here rather than in `mcp/` because both ends render it — the daemon emits, the side
 * panel draws — and a second copy would drift.
 */
export type RunEvent =
  /**
   * The router picked a skill; the loop is about to start. `overlays` names the site-exploration
   * skills stacked on top of it, so the panel can show that an uploaded skill is in play.
   */
  | { kind: 'started'; skill: string; overlays?: string[] }
  | { kind: 'text'; delta: string }
  // `source` is never set by the daemon: it marks a step the extension took by itself,
  // through the local intent funnel, so the timeline can say the agent was not involved.
  | { kind: 'tool'; toolId: string; action: string; input: unknown; source?: 'local' }
  /** The action needs the user's blessing before it runs; answer with a `decision` frame. */
  | { kind: 'approval'; toolId: string; action: string; input: unknown }
  | { kind: 'toolResult'; toolId: string; ok: boolean; summary: string }
  /**
   * Which Claude Code session this run's conversation ended up in, so the saved session can be
   * resumed later. Not a row on the timeline — the panel records it and moves on.
   *
   * `null` means the id the extension supplied was refused: Claude Code no longer has that session,
   * so the stored one is stale and must be dropped rather than retried forever.
   */
  | { kind: 'session'; claudeSessionId: string | null }
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
 * A file the user attached in the extension, as the agent gets to hear about it. Metadata and
 * the notes VoiceLink made when the file was attached — never the bytes, which stay in extension
 * storage and only move when `page.attachFile` puts them into a form.
 *
 * `summary` and `digest` were written by a model reading the file, so they are the file's own
 * content restated: untrusted, and framed that way in the prompt.
 */
export interface AttachedFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  status: 'pending' | 'ready' | 'error';
  summary?: string;
  /** A longer extract of what is in the file, when one was produced. */
  digest?: string;
}

/**
 * What the extension knows about the instruction beyond its text. Nothing here may be something
 * a page can write — which is why the tab contributes its URL and not, say, its title.
 */
export interface RunContext {
  /** Absent when the instruction came from a surface with no tab to speak of. */
  url?: string;
  /**
   * The tab the instruction was typed against. A mapping run pins itself to this, because it is
   * autonomous for minutes and every action would otherwise re-resolve "the active tab" —
   * following the user into whatever they switched to.
   */
  tabId?: number;
  /**
   * The files the user has attached. They travel with the instruction because a run has no tool
   * that can read one: `page.listFiles` names them and `page.attachFile` uploads one, so without
   * this the agent is told nothing about a file the user just attached and asked about.
   */
  files?: AttachedFile[];
  /**
   * The Claude Code session this conversation lives in, so a saved session reopened days later
   * carries on rather than starting over. The extension owns it — it is read back from the session
   * record in `storage.local`, which is also why it survives a daemon restart, unlike the daemon's
   * own in-memory copy. Only ever an id the daemon confirmed via a `session` run event.
   */
  claudeSessionId?: string;
}

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
  // `tabId` pins the call to one tab. Only a mapping run sets it: an autonomous multi-minute
  // run must not follow the user into whatever tab they switch to mid-crawl.
  | { t: 'invoke'; id: string; action: string; input?: unknown; tabId?: number }
  | { t: 'result'; id: string; result: ActionResult }
  | { t: 'ping'; id: string }
  | { t: 'pong'; id: string }
  // The agent harness. These four run the other way: the extension asks the daemon to think,
  // and the daemon answers by invoking actions back down the same socket.
  | { t: 'instruct'; id: string; text: string; context?: RunContext }
  | { t: 'cancel'; id: string }
  | { t: 'decision'; id: string; toolId: string; allow: boolean }
  | { t: 'reset' }
  | { t: 'run'; id: string; event: RunEvent }
  // A file the user attached in the extension, sent for one-shot summarization; the daemon
  // answers with a `fileSummary` carrying the same `id`. `content` is base64. This runs
  // outside the agent conversation — no skill, no browser tools, no single-run lock.
  | { t: 'analyzeFile'; id: string; name: string; mime: string; size: number; content: string }
  // `digest` is the longer extract that later runs are given as context; `summary` is the line
  // the panel shows. Absent digest just means the summarizer only produced the short form.
  | { t: 'fileSummary'; id: string; result: ActionResult<{ summary: string; digest?: string }> }
  // An uploaded skill, on its way to the daemon's skills directory. Structured fields rather
  // than raw markdown: the daemon composes the front matter itself, so an upload can never
  // write a field it was not offered. Both answer with `skillResult` on the same `id`.
  | { t: 'saveSkill'; id: string; skill: SkillDraft }
  | { t: 'deleteSkill'; id: string; name: string }
  // Directory-form skills are removed by their own op: `deleteSkill` must never take a flat
  // upload and a generated map of the same name down together.
  | { t: 'deleteSiteMap'; id: string; name: string }
  | { t: 'skillResult'; id: string; result: ActionResult<SavedSkill> }
  // A mapping run finished and staged a skill the loader cannot yet see. The panel shows the
  // rendered markdown; one of the next two frames decides its fate.
  | { t: 'siteMapDraft'; id: string; draft: SiteMapDraft }
  // `exactHost` narrows `acme.com` to the exact host mapped. The domain list itself is never
  // sent: a caller-supplied array is a way to make a map fire on someone else's site.
  | { t: 'activateSiteMap'; id: string; stagingId: string; exactHost?: boolean }
  | { t: 'discardSiteMap'; id: string; stagingId: string }
  // Name a saved conversation, answered with `sessionName` on the same `id`. `messages` carries the
  // user's own words only — an assistant turn restates whatever page it was reading, so putting one
  // here would let a site choose the name of a session in the user's own history.
  | { t: 'nameSession'; id: string; host?: string; messages: string[] }
  | { t: 'sessionName'; id: string; result: ActionResult<{ title: string }> };

/** Where an uploaded skill landed on the daemon's disk. */
export interface SavedSkill {
  name: string;
  /** Absolute path, so the panel can say where to go looking. Absent on delete. */
  path?: string;
  /** True when the write replaced an upload of the same name. */
  replaced?: boolean;
}

/** Frames the extension sends unprompted, rather than as a reply to a daemon request. */
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
