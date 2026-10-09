import type { ActionResult } from '@/lib/actions/protocol';
import type { ToolDescriptor } from '@/lib/actions/manifest';
import type { AgentKind, AgentState } from '@/lib/agents/catalog';
import type { AndroidState } from '@/lib/phone/types';
import type { Preferences } from '@/lib/settings/preferences';
import type { Source } from '@/lib/stores';

export interface BridgeStatus {
  connected: boolean;
  daemonVersion: string;
  protocolVersion: number;
  port: number;
  manifestInSync: boolean;
  extensionVersion?: string;
  /** The connected browser this caller's tools reach, when more than one could answer. */
  browser?: string;
  connectedBrowsers: number;
  pairedBrowsers: number;
  pairingPending: boolean;
}

export interface SessionSummary {
  id: string;
  browser?: string;
  origin: string;
  /** Absent from a daemon before 0.8, which knew only the unpacked copy. */
  source?: Source;
  extensionVersion: string;
  pairedAt: string;
  lastSeenAt: string;
  connected: boolean;
}

/**
 * An invoke can be held far longer than the caller's own timeout: an approval waits on the user.
 * A caller that sends `keepAlive` hears `working` this often until the result, and restarts its
 * timeout on each; one that doesn't — an older client — is never sent a frame it cannot read.
 */
export const INVOKE_KEEPALIVE_MS = 2_000;

export type ControlRequest =
  | { id: string; op: 'describe'; runId?: string }
  | { id: string; op: 'status' }
  | { id: string; op: 'invoke'; action: string; input?: unknown; runId?: string; keepAlive?: boolean }
  /** The caller stopped waiting for the invoke it sent as `id`: an approval it was waiting on is withdrawn. Never answered. */
  | { id: string; op: 'cancel' }
  | { id: string; op: 'pair' }
  | { id: string; op: 'sessions' }
  | { id: string; op: 'revoke'; session?: string; origin?: string }
  | { id: string; op: 'agent'; set?: AgentKind; grant?: AgentKind; models?: AgentKind }
  /** `watch` also subscribes this caller to `settings-changed`, which no other caller is sent. */
  | { id: string; op: 'preferences'; watch?: boolean }
  | { id: string; op: 'setPreference'; change: unknown }
  /**
   * `launch` opens Chrome on that phone, at `url` when one is given. `watch` subscribes this caller to
   * `android-changed` and `watch: false` lets go, so the Bridge stops looking once nobody shows phones.
   * `peek` answers only what is already known, NOT_CHECKED while nobody watches.
   */
  | { id: string; op: 'android'; launch?: string; url?: string; watch?: boolean; peek?: boolean };

export type ControlMessage =
  | { id: string; op: 'describe'; tools: ToolDescriptor[]; reserved?: string[]; withheld?: ToolDescriptor[] }
  | { id: string; op: 'status'; status: BridgeStatus }
  | { id: string; op: 'invoke'; result: ActionResult }
  | { id: string; op: 'working' }
  | { id: string; op: 'pair'; code: string; expiresAt: number }
  | { id: string; op: 'sessions'; sessions: SessionSummary[] }
  | { id: string; op: 'revoke'; revoked: number }
  | { id: string; op: 'agent'; state: AgentState }
  | { id: string; op: 'preferences'; result: ActionResult<Preferences> }
  | { id: string; op: 'android'; result: ActionResult<AndroidState> }
  | { event: 'manifest-changed' }
  /** config.json changed, from any side: read the preferences and the agent state again. */
  | { event: 'settings-changed' }
  | { event: 'android-changed'; state: AndroidState };

export interface Described {
  tools: ToolDescriptor[];
  /** Reserved actions this caller may be offered. Absent when the daemon predates the field. */
  reserved?: string[];
  /**
   * Tools a run is not offered right now but may be later in its conversation — the page-code tools,
   * until the user turns Live tool on. A CLI whose tool list is fixed when its session begins lists
   * them out of sight up front; a call to one while it is withheld is refused.
   */
  withheld?: ToolDescriptor[];
}

export interface Bridge {
  describe(): Promise<Described>;
  /** `signal` aborts when whoever asked stops waiting, which the daemon is then told. */
  invoke(action: string, input?: unknown, signal?: AbortSignal): Promise<ActionResult>;
  status(): Promise<BridgeStatus>;
  onManifestChanged(listener: () => void): void;
  close(): Promise<void>;
}
