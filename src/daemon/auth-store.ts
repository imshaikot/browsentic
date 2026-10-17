import { randomBytes, randomInt } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlockedBrowser, PairedBy } from '@/lib/pairing';
import { stateDir } from './lockfile';

const authPath = join(stateDir, 'auth.json');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
const CODE_LENGTH = 8;
/** A grant goes from the Bridge to the extension through native messaging and is never typed, so it carries ~126 bits. */
const GRANT_LENGTH = 26;
const PAIRING_TTL_MS = 10 * 60 * 1000;
/** Kept so a revoked or denied browser stays out; the oldest are let go past this many. */
const BLOCKED_KEPT = 200;
/** The app, a terminal and a second terminal can each be showing one; a new code must not void theirs. */
const LIVE_PAIRINGS = 3;

export interface Session {
  key: string;
  origin: string;
  /** Absent on a session paired before the extension sent one; the first reconnect claims it. */
  installId?: string;
  browser?: string;
  /** What someone named this browser, in the approval sheet or the app's list. */
  label?: string;
  /** Absent on a session paired before automatic pairing, which was always by code. */
  pairedBy?: PairedBy;
  extensionVersion: string;
  pairedAt: string;
  lastSeenAt: string;
}

/** A browser profile someone allowed in ask mode; it pairs by itself from then on, until it is revoked. */
export interface Approval {
  installId: string;
  origin: string;
  browser?: string;
  label?: string;
  at: string;
}

interface Pairing {
  code: string;
  expiresAt: number;
}

interface AuthFile {
  pairings: Pairing[];
  sessions: Session[];
  approved: Approval[];
  blocked: BlockedBrowser[];
}

function read(): AuthFile {
  try {
    const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as Partial<AuthFile>;
    return { pairings: parsed.pairings ?? [], sessions: parsed.sessions ?? [], approved: parsed.approved ?? [], blocked: parsed.blocked ?? [] };
  } catch {
    return { pairings: [], sessions: [], approved: [], blocked: [] };
  }
}

function write(auth: AuthFile): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  chmodSync(authPath, 0o600);
}

const codeOf = (length: number) => Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

/** In the typed codes' alphabet, so the extension's handshake treats it as any code. */
export const mintGrantCode = (): string => codeOf(GRANT_LENGTH);

export function createPairing(): { code: string; expiresAt: number } {
  const auth = read();
  const code = codeOf(CODE_LENGTH);
  const now = Date.now();
  const expiresAt = now + PAIRING_TTL_MS;
  const live = auth.pairings.filter((pairing) => pairing.expiresAt > now).slice(1 - LIVE_PAIRINGS);
  write({ ...auth, pairings: [...live, { code, expiresAt }] });
  return { code, expiresAt };
}

export function pendingPairings(): string[] {
  return read()
    .pairings.filter((pairing) => pairing.expiresAt > Date.now())
    .map((pairing) => pairing.code);
}

export function consumePairing(code: string): void {
  const auth = read();
  write({ ...auth, pairings: auth.pairings.filter((pairing) => pairing.code !== code) });
}

export function hasPendingPairing(): boolean {
  return read().pairings.some((pairing) => pairing.expiresAt > Date.now());
}

export interface Install {
  installId: string;
  origin: string;
  extensionVersion: string;
  browser?: string;
}

export const sessionId = (session: Pick<Session, 'installId' | 'origin'>): string =>
  session.installId ?? session.origin;

export function createSession({ installId, origin, extensionVersion, browser }: Install, pairedBy: PairedBy = 'code'): Session {
  const auth = read();
  const now = new Date().toISOString();
  const label = auth.approved.find((approval) => approval.installId === installId)?.label;
  const session: Session = {
    key: randomBytes(32).toString('base64url'),
    origin,
    installId,
    browser,
    ...(label ? { label } : {}),
    pairedBy,
    extensionVersion,
    pairedAt: now,
    lastSeenAt: now,
  };
  const sessions = auth.sessions.filter((existing) => existing.installId !== installId);
  write({ ...auth, sessions: [...sessions, session], blocked: auth.blocked.filter((block) => block.installId !== installId) });
  return session;
}

/**
 * The sessions this install may hold the key to. An origin names a browser only until a second
 * Chromium browser loads the same folder, so it is consulted just for sessions that predate the
 * install id, and which of those is this browser's is settled by the proof.
 */
export function sessionCandidates({ installId, origin }: Pick<Install, 'installId' | 'origin'>): Session[] {
  const sessions = read().sessions;
  const own = sessions.filter((candidate) => candidate.installId === installId);
  return own.length ? own : sessions.filter((candidate) => !candidate.installId && candidate.origin === origin);
}

export function claimSession(key: string, { installId, extensionVersion, browser }: Install): void {
  const auth = read();
  const session = auth.sessions.find((candidate) => candidate.key === key);
  if (!session) return;
  Object.assign(session, { installId, extensionVersion, browser, lastSeenAt: new Date().toISOString() });
  write(auth);
}

export function listSessions(): Session[] {
  return read().sessions;
}

/**
 * Unpairs the matching browsers and keeps them from pairing again by themselves, so a revoke is not
 * undone by the extension's next automatic attempt a minute later.
 */
export function revokeSessions(predicate: (session: Session) => boolean): number {
  const auth = read();
  const revoked = auth.sessions.filter(predicate);
  const keep = auth.sessions.filter((session) => !predicate(session));
  const at = new Date().toISOString();
  const blocks = revoked
    .filter((session): session is Session & { installId: string } => !!session.installId)
    .map(({ installId, origin, browser }): BlockedBrowser => ({ installId, origin, browser, at, reason: 'revoked' }));
  write({ ...withBlocks(auth, blocks), sessions: keep });
  return revoked.length;
}

function withBlocks(auth: AuthFile, blocks: BlockedBrowser[]): AuthFile {
  const ids = new Set(blocks.map((block) => block.installId));
  return {
    ...auth,
    approved: auth.approved.filter((approval) => !ids.has(approval.installId)),
    blocked: [...auth.blocked.filter((block) => !ids.has(block.installId)), ...blocks].slice(-BLOCKED_KEPT),
  };
}

export function blockInstall(install: Pick<Install, 'installId' | 'origin' | 'browser'>, reason: BlockedBrowser['reason']): void {
  const { installId, origin, browser } = install;
  write(withBlocks(read(), [{ installId, origin, browser, at: new Date().toISOString(), reason }]));
}

/** True when there was a block to lift. */
export function unblockInstall(installId: string): boolean {
  const auth = read();
  const blocked = auth.blocked.filter((block) => block.installId !== installId);
  if (blocked.length === auth.blocked.length) return false;
  write({ ...auth, blocked });
  return true;
}

export const blockOf = (installId: string): BlockedBrowser | undefined => read().blocked.find((block) => block.installId === installId);

export const listBlocked = (): BlockedBrowser[] => read().blocked;

export function approveInstall(approval: Omit<Approval, 'at'>): void {
  const auth = read();
  const approved = [...auth.approved.filter((kept) => kept.installId !== approval.installId), { ...approval, at: new Date().toISOString() }];
  write({ ...auth, approved, blocked: auth.blocked.filter((block) => block.installId !== approval.installId) });
}

export const isApproved = (installId: string): boolean => read().approved.some((approval) => approval.installId === installId);

/** True when that browser was paired; an empty name clears it. */
export function labelSession(id: string, label: string): boolean {
  const auth = read();
  const session = auth.sessions.find((candidate) => sessionId(candidate) === id);
  if (!session) return false;
  const named = label.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
  if (named) session.label = named;
  else delete session.label;
  write(auth);
  return true;
}

export function clearAuth(): void {
  rmSync(authPath, { force: true });
}
