/**
 * Automatic pairing: the extension asks the native messaging host, which only our own extensions can
 * launch, for a one-time grant from Browsentic Bridge, and redeems it through the same handshake a
 * typed code uses. `mode` decides whether someone approves the browser first; `code` turns it off.
 */

export const PAIRING_MODES = ['auto', 'ask', 'code'] as const;
export type PairingMode = (typeof PAIRING_MODES)[number];
export const DEFAULT_PAIRING_MODE: PairingMode = 'auto';

export const isPairingMode = (value: unknown): value is PairingMode => PAIRING_MODES.includes(value as PairingMode);

export const PAIR_REASONS = ['install', 'update', 'startup', 'alarm', 'open', 'gesture', 'unknown-session'] as const;
export type PairReason = (typeof PAIR_REASONS)[number];

export const isPairReason = (value: unknown): value is PairReason => PAIR_REASONS.includes(value as PairReason);

/** A Firefox extension's socket origin is a random UUID per install, so its grant is bound to the scheme. */
export const FIREFOX_CALLER = 'moz-extension://';

/** The ops a host that pairs answers; one that answers only `ensure` predates automatic pairing. */
export const HOST_OPS = ['ensure', 'hello', 'pair'] as const;

/** Where someone allows a browser: the desktop app, or `browsentic approve` in a terminal. */
export type Approver = 'app' | 'terminal';

/** The longest a host holds a pair request open waiting for an approval, so an open page hears it at once. */
export const MAX_PAIR_WAIT_MS = 25_000;

export interface HostPairRequest {
  op: 'pair';
  installId: string;
  browser?: string;
  extensionVersion: string;
  protocolVersion: number;
  reason: PairReason;
  /** Set only when someone pressed Connect or Reconnect. */
  gesture?: boolean;
  waitMs?: number;
}

export interface Grant {
  code: string;
  port: number;
  expiresAt: number;
}

export type PairRefusal = 'off' | 'revoked' | 'denied' | 'stopped' | 'origin' | 'restart';

export interface PairWait {
  request: string;
  approver: Approver;
  retryAfterMs: number;
}

/** What the Bridge answers a host that asks for a grant. */
export type GrantOutcome =
  | { grant: Grant; approver: Approver }
  | { wait: PairWait }
  | { refused: Exclude<PairRefusal, 'stopped' | 'origin' | 'restart'>; error: string };

export type HostPairReply =
  | { ok: true; grant: Grant; mode: PairingMode; approver: Approver }
  | { ok: false; wait: PairWait; mode: PairingMode }
  | { ok: false; refused: PairRefusal; error: string; mode?: PairingMode }
  | { ok: false; error: string };

export interface HostHello {
  ok: true;
  host: 2;
  bridge: string;
  ops: string[];
  mode: PairingMode;
  held: boolean;
  app: { kind: 'mac' | 'windows'; present: boolean } | null;
}

/** Why a session or code was refused, for an extension that can act on it; the reason text stays as shipped. */
export type RefusalCode = 'bad-code' | 'unknown' | 'revoked';

export type PairedBy = 'code' | 'auto' | 'approved';

export interface PairRequestSummary {
  id: string;
  installId: string;
  browser?: string;
  source: string;
  extensionVersion: string;
  firstAt: number;
  lastAskAt: number;
  /** Proves a `browsentic://` link came from the notification the app itself posted. */
  nonce: string;
}

export interface BlockedBrowser {
  installId: string;
  browser?: string;
  origin: string;
  at: string;
  reason: 'revoked' | 'denied';
}
