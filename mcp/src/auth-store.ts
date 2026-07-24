import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './lockfile';

/**
 * Persistent pairing state, deliberately separate from the lockfile: the lockfile describes a
 * running process and is deleted on shutdown, while sessions must survive daemon and browser
 * restarts until the user explicitly revokes them.
 */
const authPath = join(stateDir, 'auth.json');

/** Unambiguous when read aloud or typed: no 0/O, 1/I/L, U/V. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
const CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;

export interface Session {
  key: string;
  origin: string;
  extensionVersion: string;
  pairedAt: string;
  lastSeenAt: string;
}

interface Pairing {
  code: string;
  expiresAt: number;
}

interface AuthFile {
  pairings: Pairing[];
  sessions: Session[];
}

function read(): AuthFile {
  try {
    const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as Partial<AuthFile>;
    return { pairings: parsed.pairings ?? [], sessions: parsed.sessions ?? [] };
  } catch {
    return { pairings: [], sessions: [] };
  }
}

function write(auth: AuthFile): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  chmodSync(authPath, 0o600);
}

/** Mint a one-time pairing code for the user to type into the extension. */
export function createPairing(): { code: string; expiresAt: number } {
  const auth = read();
  const code = Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  // One outstanding code at a time: minting a new one invalidates any earlier code.
  write({ ...auth, pairings: [{ code, expiresAt }] });
  return { code, expiresAt };
}

/**
 * Redeem a pairing code. Single use — it is removed whether or not it had expired, so a
 * leaked code cannot be replayed after the legitimate pairing consumed it.
 */
export function consumePairing(offered: string): boolean {
  const auth = read();
  const normalized = offered.replace(/[\s-]/g, '').toUpperCase();
  const match = auth.pairings.find((pairing) => equals(pairing.code, normalized));
  write({ ...auth, pairings: auth.pairings.filter((pairing) => pairing !== match) });
  return !!match && match.expiresAt > Date.now();
}

export function hasPendingPairing(): boolean {
  return read().pairings.some((pairing) => pairing.expiresAt > Date.now());
}

export function createSession(origin: string, extensionVersion: string): Session {
  const auth = read();
  const now = new Date().toISOString();
  const session: Session = {
    key: randomBytes(32).toString('base64url'),
    origin,
    extensionVersion,
    pairedAt: now,
    lastSeenAt: now,
  };
  // One browser at a time: a new pairing replaces any session for the same origin.
  const sessions = auth.sessions.filter((existing) => existing.origin !== origin);
  write({ ...auth, sessions: [...sessions, session] });
  return session;
}

/** A session key is only valid from the origin that paired it. */
export function validateSession(offeredKey: string, origin: string): Session | null {
  const auth = read();
  const session = auth.sessions.find(
    (candidate) => candidate.origin === origin && equals(candidate.key, offeredKey),
  );
  if (!session) return null;
  session.lastSeenAt = new Date().toISOString();
  write(auth);
  return session;
}

export function listSessions(): Session[] {
  return read().sessions;
}

export function revokeSessions(predicate: (session: Session) => boolean): number {
  const auth = read();
  const keep = auth.sessions.filter((session) => !predicate(session));
  write({ ...auth, sessions: keep });
  return auth.sessions.length - keep.length;
}

export function clearAuth(): void {
  rmSync(authPath, { force: true });
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
