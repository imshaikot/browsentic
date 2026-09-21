import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  clearAuth,
  consumePairing,
  createPairing,
  createSession,
  hasPendingPairing,
  listSessions,
  pendingPairings,
  revokeSessions,
  sessionFor,
  touchSession,
} from './auth-store';
import { stateDir } from './lockfile';

const authPath = join(stateDir, 'auth.json');
const extension = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

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
  test("pairing gives the browser a 256-bit key, bound to the extension's origin", () => {
    const session = createSession(extension, '0.6.2');
    expect([Buffer.from(session.key, 'base64url').length, sessionFor(extension)]).toEqual([32, session]);
  });

  test('pairing the same browser again replaces its key rather than adding a second', () => {
    const first = createSession(extension, '0.6.1');
    const second = createSession(extension, '0.6.2');
    expect([listSessions(), first.key === second.key]).toEqual([[second], false]);
  });

  test('seeing a browser again updates when it was last seen, and nothing else', () => {
    vi.useFakeTimers({ now: new Date('2026-09-21T10:00:00Z') });
    const paired = createSession(extension, '0.6.2');
    vi.setSystemTime(new Date('2026-09-21T12:00:00Z'));
    touchSession(extension);
    expect(sessionFor(extension)).toEqual({ ...paired, lastSeenAt: '2026-09-21T12:00:00.000Z' });
  });

  test('seeing a browser that never paired changes nothing', () => {
    touchSession('moz-extension://stranger');
    expect(listSessions()).toEqual([]);
  });

  test('revoking removes the sessions that match, and says how many', () => {
    createSession(extension, '0.6.2');
    createSession('moz-extension://firefox-uuid', '0.6.2');
    expect([revokeSessions((session) => session.origin.startsWith('moz-')), listSessions().map((session) => session.origin)]).toEqual([1, [extension]]);
  });

  test('a revoked browser has no key left to present', () => {
    createSession(extension, '0.6.2');
    revokeSessions(() => true);
    expect(sessionFor(extension)).toBeNull();
  });
});

describe('the file', () => {
  test('is readable only by the user', () => {
    createSession(extension, '0.6.2');
    expect(statSync(authPath).mode & 0o777).toBe(0o600);
  });

  test('a damaged file pairs nothing, and the next write replaces it', () => {
    writeFileSync(authPath, '{"sessions": [');
    const session = createSession(extension, '0.6.2');
    expect(JSON.parse(readFileSync(authPath, 'utf8'))).toEqual({ pairings: [], sessions: [session] });
  });

  test('clearing it forgets every browser', () => {
    createSession(extension, '0.6.2');
    clearAuth();
    expect([existsSync(authPath), listSessions()]).toEqual([false, []]);
  });
});
