import { randomBytes, randomInt } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir } from './lockfile';

const authPath = join(stateDir, 'auth.json');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
const CODE_LENGTH = 8;
const PAIRING_TTL_MS = 10 * 60 * 1000;

export interface Session {
  key: string;
  origin: string;
  /** Absent on a session paired before the extension sent one; the first reconnect claims it. */
  installId?: string;
  browser?: string;
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

export function createPairing(): { code: string; expiresAt: number } {
  const auth = read();
  const code = Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  write({ ...auth, pairings: [{ code, expiresAt }] });
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

export function createSession({ installId, origin, extensionVersion, browser }: Install): Session {
  const auth = read();
  const now = new Date().toISOString();
  const session: Session = {
    key: randomBytes(32).toString('base64url'),
    origin,
    installId,
    browser,
    extensionVersion,
    pairedAt: now,
    lastSeenAt: now,
  };
  const sessions = auth.sessions.filter((existing) => existing.installId !== installId);
  write({ ...auth, sessions: [...sessions, session] });
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

export function revokeSessions(predicate: (session: Session) => boolean): number {
  const auth = read();
  const keep = auth.sessions.filter((session) => !predicate(session));
  write({ ...auth, sessions: keep });
  return auth.sessions.length - keep.length;
}

export function clearAuth(): void {
  rmSync(authPath, { force: true });
}
