/**
 * Pairs this browser with Browsentic Bridge by itself, through the native host. Every attempt launches
 * a process on the computer, so attempts are spaced by what the last one found, and nothing here ever
 * replaces a session key except a new one the Bridge proved it issued.
 */

import { browser } from 'wxt/browser';
import { MAX_PAIR_WAIT_MS, type PairReason } from '@/lib/pairing';
import { askHost, type BridgeReach, type PairAttempt } from './native-pair';
import { onStaleKey, onWelcome, pairingNow, redeemGrant, reportPairing, sessionKeyUsable, type PairingState } from './socket';

/** Set when the user pressed Disconnect here; only Connect lifts it. */
const MANUAL_KEY = 'browsentic/pairManual';
const LAST_KEY = 'browsentic/pairLast';

const MINUTE = 60_000;
/** However it is asked for, an attempt waits this long after the last one, unless someone clicked. */
const FLOOR_MS = 5_000;
const MISSING_EARLY_MS = 10 * MINUTE;
/** The browser starting, or this extension arriving, begins the frequent looks for a missing Bridge again. */
const FRESH_STARTS: ReadonlySet<PairReason> = new Set(['install', 'update', 'startup']);

interface LastAttempt {
  at: number;
  outcome: BridgeReach | 'wait' | 'revoked' | 'denied';
  /** When the current run of "Bridge missing" began, which decides how often to look again. */
  missingSince?: number;
  failures: number;
  /** What the surfaces were shown, shown again when no attempt is due. */
  reach?: BridgeReach;
  pairing?: PairingState;
}

/** How long an alarm waits after an attempt that ended this way; Infinity leaves it to a person. */
function alarmGap(last: LastAttempt, now: number): number {
  switch (last.outcome) {
    case 'missing':
      return now - (last.missingSince ?? last.at) < MISSING_EARLY_MS ? MINUTE : 15 * MINUTE;
    case 'old':
    case 'forbidden':
    case 'policy':
      return 60 * MINUTE;
    case 'stopped':
      return 10 * MINUTE;
    case 'failed':
      return Math.min(30, 2 ** Math.max(0, last.failures - 1)) * MINUTE;
    case 'wait':
    case 'ready':
      return MINUTE;
    default:
      return Infinity;
  }
}

/** A revoke or a deny is never tried again unasked; a page opening, an install or a restart may try anything else, since the mode may have changed. */
export function isDue(reason: PairReason, last: LastAttempt | undefined, gesture: boolean, now = Date.now()): boolean {
  if (gesture || !last) return true;
  if (now - last.at < FLOOR_MS || last.outcome === 'revoked' || last.outcome === 'denied') return false;
  return reason !== 'alarm' || now - last.at >= alarmGap(last, now);
}

export interface PairOptions {
  gesture?: boolean;
  /** Hold the ask open while someone decides; only while a page is open to show it. */
  wait?: boolean;
}

let inflight: Promise<void> | null = null;

/** One attempt at a time; anything but the alarm that arrives during one is answered by another right after it. */
export function autoPair(reason: PairReason, options: PairOptions = {}): Promise<void> {
  if (inflight) return options.gesture || reason !== 'alarm' ? inflight.then(() => autoPair(reason, options)) : inflight;
  inflight = attempt(reason, options).finally(() => (inflight = null));
  return inflight;
}

async function attempt(reason: PairReason, { gesture = false, wait = false }: PairOptions): Promise<void> {
  if (await sessionKeyUsable()) return;
  if (gesture) await browser.storage.local.remove(MANUAL_KEY);
  else if ((await browser.storage.local.get(MANUAL_KEY))[MANUAL_KEY]) return reportPairing(undefined, { manual: true });
  else if ((await pairingNow())?.blocked) return;

  const last = (await browser.storage.local.get(LAST_KEY))[LAST_KEY] as LastAttempt | undefined;
  if (!isDue(reason, last, gesture)) return last?.pairing ? reportPairing(last.reach, last.pairing) : undefined;

  const answer = await askHost(reason, { gesture, waitMs: wait ? MAX_PAIR_WAIT_MS : 0 });
  if (answer.kind === 'grant') {
    if (await sessionKeyUsable()) return;
    await reportPairing('ready', { mode: answer.mode });
    const redeemed = await redeemGrant(answer.grant.code, answer.grant.port);
    if (redeemed.ok) return;
    const failed: PairingState = { mode: answer.mode, error: GRANT_REFUSED };
    await remember(last, 'failed', 'ready', failed, reason);
    return reportPairing('ready', failed);
  }
  const [reach, pairing, outcome] = settled(answer);
  await remember(last, outcome, reach, pairing, reason);
  await reportPairing(reach, pairing);
}

const GRANT_REFUSED = 'Browsentic Bridge didn’t let this browser in. Try again.';

function settled(answer: Exclude<PairAttempt, { kind: 'grant' }>): [BridgeReach, PairingState, LastAttempt['outcome']] {
  if (answer.kind === 'wait') return ['ready', { mode: answer.mode, wait: { approver: answer.approver } }, 'wait'];
  if (answer.kind === 'unreachable') return [answer.reach, { error: answer.message }, answer.reach];
  const { refusal, message, mode } = answer;
  if (refusal === 'revoked' || refusal === 'denied') return ['ready', { mode, blocked: refusal, error: message }, refusal];
  if (refusal === 'off') return ['off', { mode: 'code', error: message }, 'off'];
  if (refusal === 'stopped') return ['stopped', { mode, error: message }, 'stopped'];
  return ['ready', { mode, error: message }, 'failed'];
}

async function remember(
  last: LastAttempt | undefined,
  outcome: LastAttempt['outcome'],
  reach: BridgeReach,
  pairing: PairingState,
  reason: PairReason,
): Promise<void> {
  const now = Date.now();
  const stillMissing = last?.outcome === 'missing' && !FRESH_STARTS.has(reason);
  const next: LastAttempt = {
    at: now,
    outcome,
    missingSince: outcome === 'missing' ? (stillMissing ? last.missingSince ?? last.at : now) : undefined,
    failures: outcome === 'failed' ? (last?.outcome === 'failed' ? last.failures + 1 : 1) : 0,
    reach,
    pairing,
  };
  await browser.storage.local.set({ [LAST_KEY]: next });
}

/** The user pressed Disconnect here: this browser stays unpaired until they press Connect. */
export async function holdAutoPair(): Promise<void> {
  await browser.storage.local.set({ [MANUAL_KEY]: true });
  await reportPairing(undefined, { manual: true });
}

/** A browser coming back after a restart, an update or a Bridge that forgot it starts over, not where an old failure left it. */
async function forgetLast(): Promise<void> {
  await browser.storage.local.remove(LAST_KEY);
}

/** A typed code connected it again after a Disconnect, which is as deliberate as pressing Connect. */
export async function releaseAutoPair(): Promise<void> {
  await browser.storage.local.remove(MANUAL_KEY);
}

export function serveAutoPair(): void {
  onWelcome(() => void forgetLast());
  onStaleKey(() => void forgetLast().then(() => autoPair('unknown-session')));
}
