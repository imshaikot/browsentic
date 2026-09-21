import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  claimSession,
  clearAuth,
  consumePairing,
  createPairing,
  createSession,
  hasPendingPairing,
  listSessions,
  pendingPairings,
  revokeSessions,
  sessionCandidates,
  sessionId,
  type Install,
} from './auth-store';
import { stateDir } from './lockfile';

const authPath = join(stateDir, 'auth.json');
const extension = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

const chrome: Install = { installId: 'install-chrome-0001', origin: extension, extensionVersion: '0.6.2', browser: 'Google Chrome' };
const brave: Install = { installId: 'install-brave-00001', origin: extension, extensionVersion: '0.6.2', browser: 'Brave' };
const firefox: Install = { installId: 'install-firefox-001', origin: 'moz-extension://firefox-uuid', extensionVersion: '0.6.2' };

/** What auth.json holds for a browser paired before the extension sent an install id. */
function pairedBeforeInstallIds(origin: string): string {
  const key = 'k'.repeat(43);
  const legacy = { key, origin, extensionVersion: '0.6.1', pairedAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-09-01T00:00:00.000Z' };
  writeFileSync(authPath, JSON.stringify({ pairings: [], sessions: [legacy] }));
  return key;
}

beforeEach(() => {
  mkdirSync(stateDir, { recursive: true });
  clearAuth();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pairing codes', () => {
  test('a code is eight characters that cannot be misread, valid for ten minutes', () => {
    vi.useFakeTimers({ now: new Date('2026-09-21T10:00:00Z') });
    const { code, expiresAt } = createPairing();
    expect([/^[ABCDEFGHJKMNPQRSTWXYZ23456789]{8}$/.test(code), expiresAt - Date.now()]).toEqual([true, 10 * 60_000]);
  });

  test('a new code replaces the one before it', () => {
    createPairing();
    const { code } = createPairing();
    expect(pendingPairings()).toEqual([code]);
  });

  test('a code stops being pending once it expires', () => {
    vi.useFakeTimers({ now: new Date('2026-09-21T10:00:00Z') });
    createPairing();
    vi.setSystemTime(new Date('2026-09-21T10:10:01Z'));
    expect([pendingPairings(), hasPendingPairing()]).toEqual([[], false]);
  });

  test('a code can be used once', () => {
    const { code } = createPairing();
    consumePairing(code);
    expect(hasPendingPairing()).toBe(false);
  });
});

describe('sessions', () => {
  test('pairing gives the browser a 256-bit key, bound to its install id', () => {
    const session = createSession(chrome);
    expect([Buffer.from(session.key, 'base64url').length, sessionCandidates(chrome)]).toEqual([32, [session]]);
  });

  test('pairing the same browser again replaces its key rather than adding a second', () => {
    const first = createSession({ ...chrome, extensionVersion: '0.6.1' });
    const second = createSession(chrome);
    expect([listSessions(), first.key === second.key]).toEqual([[second], false]);
  });

  test('a second browser loading the same folder shares the origin and still pairs beside the first', () => {
    const first = createSession(chrome);
    const second = createSession(brave);
    expect([listSessions(), sessionCandidates(chrome), sessionCandidates(brave)]).toEqual([[first, second], [first], [second]]);
  });

  test('seeing a browser again updates when it was last seen and what it is running, and keeps its key', () => {
    vi.useFakeTimers({ now: new Date('2026-09-21T10:00:00Z') });
    const paired = createSession({ ...chrome, extensionVersion: '0.6.1' });
    vi.setSystemTime(new Date('2026-09-21T12:00:00Z'));
    claimSession(paired.key, chrome);
    expect(listSessions()).toEqual([{ ...paired, extensionVersion: '0.6.2', lastSeenAt: '2026-09-21T12:00:00.000Z' }]);
  });

  test('a key nobody holds claims nothing', () => {
    claimSession('no-such-key', chrome);
    expect(listSessions()).toEqual([]);
  });

  test('a browser paired before install ids is found by its origin, and named by it until it returns', () => {
    const key = pairedBeforeInstallIds(extension);
    expect([sessionCandidates(chrome).map((session) => session.key), listSessions().map(sessionId)]).toEqual([[key], [extension]]);
  });

  test('its first return claims that session, after which no other browser on the origin is offered it', () => {
    const key = pairedBeforeInstallIds(extension);
    claimSession(key, chrome);
    expect([listSessions().map(sessionId), sessionCandidates(brave)]).toEqual([[chrome.installId], []]);
  });

  test('revoking removes the sessions that match, and says how many', () => {
    createSession(chrome);
    createSession(firefox);
    expect([revokeSessions((session) => session.origin.startsWith('moz-')), listSessions().map((session) => session.origin)]).toEqual([1, [extension]]);
  });

  test('a revoked browser has no key left to present', () => {
    createSession(chrome);
    revokeSessions(() => true);
    expect(sessionCandidates(chrome)).toEqual([]);
  });
});

describe('the file', () => {
  test('is readable only by the user', () => {
    createSession(chrome);
    expect(statSync(authPath).mode & 0o777).toBe(0o600);
  });

  test('a damaged file pairs nothing, and the next write replaces it', () => {
    writeFileSync(authPath, '{"sessions": [');
    const session = createSession(chrome);
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({ pairings: [], sessions: [session] });
  });

  test('clearing it forgets every browser', () => {
    createSession(chrome);
    clearAuth();
    expect([existsSync(authPath), listSessions()]).toEqual([false, []]);
  });
});
