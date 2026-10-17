import { mkdirSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PairingMode } from '@/lib/pairing';
import { blockInstall, clearAuth, listBlocked } from './auth-store';
import { stateDir } from './lockfile';
import { callerMatches, pairingDesk, type Asker } from './pairing-desk';

const chrome: Asker = {
  installId: 'install-desk-chrome01',
  caller: 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/',
  browser: 'Google Chrome',
  extensionVersion: '0.9.0',
  gesture: false,
};

function desk(mode: PairingMode, appWatching = false) {
  let clock = Date.now();
  const launched = vi.fn(() => true);
  const changed = vi.fn();
  const built = pairingDesk({
    port: () => 8765,
    mode: () => mode,
    approver: () => 'app',
    appWatching: () => appWatching,
    launchApp: launched,
    changed,
    now: () => clock,
  });
  return { desk: built, launched, changed, advance: (ms: number) => (clock += ms) };
}

beforeEach(() => {
  mkdirSync(stateDir, { recursive: true });
  clearAuth();
});

describe('callerMatches', () => {
  it('binds Chromium to the exact origin and Firefox to the scheme', () => {
    expect(callerMatches(chrome.caller, 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp')).toBe(true);
    expect(callerMatches(chrome.caller, 'chrome-extension://cbkjhkgjcpihokphhdkbahilpcjojpdc')).toBe(false);
    expect(callerMatches('moz-extension://', 'moz-extension://5b1d7a4e-9f3c')).toBe(true);
    expect(callerMatches('moz-extension://', chrome.caller)).toBe(false);
  });
});

describe('grants', () => {
  it('lasts two minutes and is handed out again while more than half a minute is left', () => {
    const { desk: built, advance } = desk('auto');
    const first = built.ask(chrome);
    advance(60_000);
    const second = built.ask(chrome);
    advance(40_000);
    const third = built.ask(chrome);

    const code = (outcome: typeof first) => ('grant' in outcome ? outcome.grant.code : null);
    expect(code(first)).toBe(code(second));
    expect(code(third)).not.toBe(code(first));
    expect('grant' in first && first.grant.expiresAt - (Date.now() - 100_000)).toBeGreaterThan(119_000);
  });

  it('is gone once it expires or is used', () => {
    const { desk: built, advance } = desk('auto');
    built.ask(chrome);
    expect(built.grantFor(chrome.installId, 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp')).toBeDefined();
    built.consume(chrome.installId);
    expect(built.grantFor(chrome.installId, 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp')).toBeUndefined();

    built.ask(chrome);
    advance(120_001);
    expect(built.grantFor(chrome.installId, 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp')).toBeUndefined();
  });
});

describe('ask mode', () => {
  it('starts the app once per request when nobody is watching, and tells approvers once', () => {
    const { desk: built, launched, changed } = desk('ask');
    built.ask(chrome);
    built.ask(chrome);
    expect(launched).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledOnce();
  });

  it('leaves a watching app to ask by itself', () => {
    const { desk: built, launched } = desk('ask', true);
    built.ask(chrome);
    expect(launched).not.toHaveBeenCalled();
  });

  it('forgets a request nobody asked about for ten minutes, without counting it as a deny', () => {
    const { desk: built, advance } = desk('ask');
    built.ask(chrome);
    advance(10 * 60_000);
    expect(built.pending()).toEqual([]);
    expect(listBlocked()).toEqual([]);
  });

  it('lets a click ask again a minute after a deny, not sooner', () => {
    const { desk: built, advance } = desk('ask');
    built.ask(chrome);
    built.decide(chrome.installId, false);

    expect(built.ask({ ...chrome, gesture: true })).toMatchObject({ refused: 'denied' });
    advance(61_000);
    expect(built.ask({ ...chrome, gesture: true })).toMatchObject({ wait: expect.anything() });
  });

  it('hears a decision the moment it is made', async () => {
    const { desk: built } = desk('ask');
    built.ask(chrome);
    const settled = built.settled(chrome.installId, 60_000);
    built.decide(chrome.installId, true);
    await expect(settled).resolves.toBeUndefined();
  });

  it('answers a request once its browser pairs some other way, as with a typed code', async () => {
    const { desk: built, changed } = desk('ask');
    built.ask(chrome);
    const settled = built.settled(chrome.installId, 60_000);
    built.consume(chrome.installId);
    await expect(settled).resolves.toBeUndefined();
    expect(built.pending()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('decides a blocked browser by its install id even with no request', () => {
    const { desk: built } = desk('ask');
    blockInstall({ installId: chrome.installId, origin: chrome.caller }, 'revoked');
    expect(built.decide(chrome.installId, true)).toBe(true);
    expect(listBlocked()).toEqual([]);
    expect(built.decide('nobody-at-all-here', true)).toBe(false);
  });
});
