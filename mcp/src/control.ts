import type { ActionResult } from '@/lib/actions/protocol';
import type { ToolDescriptor } from '@/lib/actions/manifest';

/** What the daemon knows about its own link to the browser. */
export interface BridgeStatus {
  connected: boolean;
  daemonVersion: string;
  protocolVersion: number;
  port: number;
  manifestInSync: boolean;
  extensionVersion?: string;
  /** How many browsers are paired, and whether a pairing code is currently outstanding. */
  pairedBrowsers: number;
  pairingPending: boolean;
}

/** A paired browser, as reported to the CLI. */
export interface SessionSummary {
  origin: string;
  extensionVersion: string;
  pairedAt: string;
  lastSeenAt: string;
  connected: boolean;
}

/** CLI → daemon, over the control WebSocket. */
export type ControlRequest =
  | { id: string; op: 'describe' }
  | { id: string; op: 'status' }
  /** `runId` marks an invocation made on an agent run's behalf — it gets gated and reported. */
  | { id: string; op: 'invoke'; action: string; input?: unknown; runId?: string }
  | { id: string; op: 'pair' }
  | { id: string; op: 'sessions' }
  | { id: string; op: 'revoke'; origin?: string };

/** daemon → CLI. `event` frames are unsolicited. */
export type ControlMessage =
  | { id: string; op: 'describe'; tools: ToolDescriptor[] }
  | { id: string; op: 'status'; status: BridgeStatus }
  | { id: string; op: 'invoke'; result: ActionResult }
  | { id: string; op: 'pair'; code: string; expiresAt: number }
  | { id: string; op: 'sessions'; sessions: SessionSummary[] }
  | { id: string; op: 'revoke'; revoked: number }
  | { event: 'manifest-changed' };

/** The daemon-side view of the browser, however it is reached. */
export interface Bridge {
  describe(): Promise<ToolDescriptor[]>;
  invoke(action: string, input?: unknown): Promise<ActionResult>;
  status(): Promise<BridgeStatus>;
  /** Fires when the connected extension's manifest differs from the bundled one. */
  onManifestChanged(listener: () => void): void;
  close(): Promise<void>;
}
