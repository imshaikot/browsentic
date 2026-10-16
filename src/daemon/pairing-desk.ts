/**
 * Where the Bridge decides a native host's request for a grant. Grants and pending requests live in
 * memory only: a restart costs the extension one more ask, and nothing secret is left on disk.
 * Approvals and blocks are the user's decisions, so they persist in auth.json.
 */

import { randomBytes } from 'node:crypto';
import { FIREFOX_CALLER, type Approver, type Grant, type GrantOutcome, type PairRequestSummary, type PairWait, type PairedBy, type PairingMode } from '@/lib/pairing';
import { sourceOf } from '@/lib/stores';
import { approveInstall, blockInstall, blockOf, isApproved, mintGrantCode, unblockInstall } from './auth-store';
import { log } from './log';

const GRANT_TTL_MS = 120_000;
/** A grant with less left than this is replaced rather than handed out again. */
const GRANT_REUSE_MS = 30_000;
const REQUEST_TTL_MS = 10 * 60_000;
const RETRY_AFTER_MS = 3_000;
/** How soon after a deny a click in the browser may ask again. */
const REASK_AFTER_DENY_MS = 60_000;

/** Who is asking, as the native host vouches for it. */
export interface Asker {
  installId: string;
  /** `chrome-extension://<id>/` for Chromium, FIREFOX_CALLER for Firefox. */
  caller: string;
  browser?: string;
  extensionVersion: string;
  gesture: boolean;
}

interface HeldGrant {
  code: string;
  caller: string;
  expiresAt: number;
  pairedBy: PairedBy;
}

interface PendingRequest extends PairRequestSummary {
  caller: string;
}

export interface DeskOptions {
  port: () => number;
  mode: () => PairingMode;
  approver: () => Approver;
  /** True while the desktop app is listening for requests. */
  appWatching: () => boolean;
  /** Starts the desktop app in the background, if there is one. */
  launchApp: () => boolean;
  /** The pending list changed. */
  changed: () => void;
  now?: () => number;
}

export interface PairingDesk {
  ask(asker: Asker): GrantOutcome;
  /** Resolves when that browser's request is decided, or after `ms`. */
  settled(installId: string, ms: number): Promise<void>;
  decide(reference: string, allow: boolean, label?: string): boolean;
  pending(): PairRequestSummary[];
  /** The live grant that browser may redeem from that socket origin. */
  grantFor(installId: string, origin: string): HeldGrant | undefined;
  /** That browser paired, by its grant or a typed code: the grant is spent and its request answered. */
  consume(installId: string): void;
}

const asOrigin = (origin: string) => (origin.endsWith('/') ? origin : `${origin}/`);

export function callerMatches(caller: string, origin: string): boolean {
  return caller === FIREFOX_CALLER ? origin.startsWith(FIREFOX_CALLER) : asOrigin(origin) === caller;
}

const REFUSED_WORDS = {
  off: 'Automatic pairing is off on this computer. Pair with a code from "browsentic pair" or the app.',
  revoked: 'This computer unpaired this browser. Press Reconnect, or pair with a code.',
  denied: 'This computer turned this browser down. Press Reconnect to ask again, or pair with a code.',
} as const;

export function pairingDesk(options: DeskOptions): PairingDesk {
  const now = options.now ?? Date.now;
  const grants = new Map<string, HeldGrant>();
  const requests = new Map<string, PendingRequest>();
  const waiters = new Map<string, Set<() => void>>();

  const label = (asker: Pick<Asker, 'installId' | 'browser' | 'caller'>) => `${asker.browser ?? asker.caller} (${asker.installId.slice(0, 8)})`;

  function grantFor(asker: Asker, pairedBy: PairedBy): Grant {
    const held = grants.get(asker.installId);
    if (held && held.caller === asker.caller && held.pairedBy === pairedBy && held.expiresAt - now() > GRANT_REUSE_MS) {
      return { code: held.code, port: options.port(), expiresAt: held.expiresAt };
    }
    const fresh: HeldGrant = { code: mintGrantCode(), caller: asker.caller, expiresAt: now() + GRANT_TTL_MS, pairedBy };
    grants.set(asker.installId, fresh);
    log(`granted pairing to ${label(asker)} [${pairedBy}]`);
    return { code: fresh.code, port: options.port(), expiresAt: fresh.expiresAt };
  }

  function waitOn(request: PendingRequest): PairWait {
    return { request: request.id, approver: options.approver(), retryAfterMs: RETRY_AFTER_MS };
  }

  function request(asker: Asker): PairWait {
    const known = requests.get(asker.installId);
    if (known && now() - known.lastAskAt < REQUEST_TTL_MS) {
      known.lastAskAt = now();
      return waitOn(known);
    }
    const created: PendingRequest = {
      id: randomBytes(6).toString('base64url'),
      installId: asker.installId,
      browser: asker.browser,
      source: sourceOf(asker.caller),
      extensionVersion: asker.extensionVersion,
      firstAt: now(),
      lastAskAt: now(),
      nonce: randomBytes(16).toString('base64url'),
      caller: asker.caller,
    };
    requests.set(asker.installId, created);
    log(`pairing request from ${label(asker)}`);
    if (!options.appWatching()) options.launchApp();
    options.changed();
    return waitOn(created);
  }

  function ask(asker: Asker): GrantOutcome {
    const mode = options.mode();
    if (mode === 'code') return { refused: 'off', error: REFUSED_WORDS.off };
    const block = blockOf(asker.installId);
    if (block) {
      const reaskTooSoon = block.reason === 'denied' && now() - Date.parse(block.at) < REASK_AFTER_DENY_MS;
      if (!asker.gesture || (mode === 'ask' && reaskTooSoon)) {
        log(`refused pairing for ${label(asker)} (${block.reason})`);
        return { refused: block.reason, error: REFUSED_WORDS[block.reason] };
      }
      if (mode === 'auto') {
        unblockInstall(asker.installId);
        log(`${label(asker)} reconnected from the browser, lifting the ${block.reason} block`);
      }
    }
    if (mode === 'ask' && (block || !isApproved(asker.installId))) return { wait: request(asker) };
    return { grant: grantFor(asker, mode === 'ask' ? 'approved' : 'auto'), approver: options.approver() };
  }

  /** A grant is checked again when it is redeemed, so switching to code, revoking or denying takes back one already handed out. */
  function stillGranted(installId: string): boolean {
    const mode = options.mode();
    if (mode === 'code' || blockOf(installId)) return false;
    return mode === 'auto' || isApproved(installId);
  }

  function settled(installId: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const waiting = waiters.get(installId) ?? new Set<() => void>();
      const done = () => {
        clearTimeout(timer);
        waiting.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      waiting.add(done);
      waiters.set(installId, waiting);
    });
  }

  function wake(installId: string): void {
    for (const done of [...(waiters.get(installId) ?? [])]) done();
    waiters.delete(installId);
  }

  function decide(reference: string, allow: boolean, name?: string): boolean {
    const asked = [...requests.values()].find((candidate) => candidate.id === reference || candidate.installId === reference);
    const installId = asked?.installId ?? reference;
    const block = blockOf(installId);
    if (!asked && !block) return false;
    const subject = { installId, origin: asked?.caller ?? block!.origin, browser: asked?.browser ?? block?.browser };
    if (allow) approveInstall({ ...subject, ...(name?.trim() ? { label: name.trim().slice(0, 40) } : {}) });
    else blockInstall(subject, 'denied');
    log(`${allow ? 'approved' : 'denied'} ${label({ ...subject, caller: subject.origin })}`);
    requests.delete(installId);
    wake(installId);
    options.changed();
    return true;
  }

  function pending(): PairRequestSummary[] {
    for (const [installId, asked] of requests) {
      if (now() - asked.lastAskAt >= REQUEST_TTL_MS) requests.delete(installId);
    }
    return [...requests.values()].map(({ caller: _caller, ...summary }) => summary);
  }

  return {
    ask,
    settled,
    decide,
    pending,
    grantFor: (installId, origin) => {
      const held = grants.get(installId);
      if (!held || held.expiresAt <= now()) return undefined;
      if (!stillGranted(installId)) {
        grants.delete(installId);
        log(`dropped the grant for ${installId.slice(0, 8)}: the pairing mode, an approval or a block changed since`);
        return undefined;
      }
      if (callerMatches(held.caller, origin)) return held;
      log(`a grant for ${installId.slice(0, 8)} was offered from ${origin}, not the origin it was given to; refused`);
      return undefined;
    },
    consume: (installId) => {
      grants.delete(installId);
      if (!requests.delete(installId)) return;
      wake(installId);
      options.changed();
    },
  };
}
