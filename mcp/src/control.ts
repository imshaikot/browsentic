import type { ActionResult } from '@/lib/actions/protocol';
import type { ToolDescriptor } from '@/lib/actions/manifest';

export interface BridgeStatus {
  connected: boolean;
  daemonVersion: string;
  protocolVersion: number;
  port: number;
  manifestInSync: boolean;
  extensionVersion?: string;
  pairedBrowsers: number;
  pairingPending: boolean;
}

export interface SessionSummary {
  origin: string;
  extensionVersion: string;
  pairedAt: string;
  lastSeenAt: string;
  connected: boolean;
}

export type ControlRequest =
  | { id: string; op: 'describe' }
  | { id: string; op: 'status' }
  | { id: string; op: 'invoke'; action: string; input?: unknown; runId?: string }
  | { id: string; op: 'pair' }
  | { id: string; op: 'sessions' }
  | { id: string; op: 'revoke'; origin?: string };

export type ControlMessage =
  | { id: string; op: 'describe'; tools: ToolDescriptor[] }
  | { id: string; op: 'status'; status: BridgeStatus }
  | { id: string; op: 'invoke'; result: ActionResult }
  | { id: string; op: 'pair'; code: string; expiresAt: number }
  | { id: string; op: 'sessions'; sessions: SessionSummary[] }
  | { id: string; op: 'revoke'; revoked: number }
  | { event: 'manifest-changed' };

export interface Bridge {
  describe(): Promise<ToolDescriptor[]>;
  invoke(action: string, input?: unknown): Promise<ActionResult>;
  status(): Promise<BridgeStatus>;
  onManifestChanged(listener: () => void): void;
  close(): Promise<void>;
}
