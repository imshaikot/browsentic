import type { ActionResult } from '@/lib/actions/protocol';
import type { ToolDescriptor } from '@/lib/actions/manifest';
import type { AgentKind, AgentState } from '@/lib/agents/catalog';

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
  extensionVersion: string;
  pairedAt: string;
  lastSeenAt: string;
  connected: boolean;
}

export type ControlRequest =
  | { id: string; op: 'describe'; runId?: string }
  | { id: string; op: 'status' }
  | { id: string; op: 'invoke'; action: string; input?: unknown; runId?: string }
  | { id: string; op: 'pair' }
  | { id: string; op: 'sessions' }
  | { id: string; op: 'revoke'; session?: string; origin?: string }
  | { id: string; op: 'agent'; set?: AgentKind; grant?: AgentKind };

export type ControlMessage =
  | { id: string; op: 'describe'; tools: ToolDescriptor[]; reserved?: string[] }
  | { id: string; op: 'status'; status: BridgeStatus }
  | { id: string; op: 'invoke'; result: ActionResult }
  | { id: string; op: 'pair'; code: string; expiresAt: number }
  | { id: string; op: 'sessions'; sessions: SessionSummary[] }
  | { id: string; op: 'revoke'; revoked: number }
  | { id: string; op: 'agent'; state: AgentState }
  | { event: 'manifest-changed' };

export interface Described {
  tools: ToolDescriptor[];
  /** Reserved actions this caller may be offered. Absent when the daemon predates the field. */
  reserved?: string[];
}

export interface Bridge {
  describe(): Promise<Described>;
  invoke(action: string, input?: unknown): Promise<ActionResult>;
  status(): Promise<BridgeStatus>;
  onManifestChanged(listener: () => void): void;
  close(): Promise<void>;
}
