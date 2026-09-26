import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { WebSocket } from 'ws';
import { clearAuth } from '../auth-store';
import { startDaemon, type Daemon } from '../daemon';
import { readLockfile, stateDir } from '../lockfile';
import { RemoteBridge } from '../remote-bridge';
import { FakeBrowser, type Profile } from './fake-browser';

// Every Chromium browser loading ~/browsentic/extension/chrome-mv3 presents this one origin.
const unpacked = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const chrome: Profile = { origin: unpacked, installId: 'install-chrome-0001', browser: 'Google Chrome' };
const brave: Profile = { origin: unpacked, installId: 'install-brave-00001', browser: 'Brave' };
const firefox: Profile = {
  origin: 'moz-extension://0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
  installId: 'install-firefox-001',
  browser: 'Firefox',
  target: 'firefox',
};
// The nine tools a Firefox build leaves off, less the two page-code tools the default guardrails
// already keep from any caller outside a run.
const DEBUGGER_ONLY = [
  'page.findCaptcha',
  'page.readConsole',
  'page.readNetwork',
  'page.solveCaptcha',
  'page.startDiagnostics',
  'page.stopDiagnostics',
  'page.trustedClick',
];

let daemon: Daemon;
let opened: { close(): unknown }[] = [];

beforeAll(async () => {
  daemon = await startDaemon({ version: '0.0.0-test', idleExit: false });
});

afterAll(async () => {
  await daemon?.stop();
});

afterEach(async () => {
  for (const each of opened) each.close();
  opened = [];
  await settled();
  clearAuth();
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

async function control(): Promise<RemoteBridge> {
  const bridge = await RemoteBridge.connect(daemon.port, readLockfile()!.token);
  opened.push(bridge);
  return bridge;
}

async function pair(profile: Profile): Promise<FakeBrowser> {
  const { code } = await (await control()).pair();
  return returnOf(profile, { kind: 'pair', code });
}

async function returnOf(profile: Profile, credential: Parameters<typeof FakeBrowser.connect>[2]): Promise<FakeBrowser> {
  const browser = await FakeBrowser.connect(daemon.port, profile, credential);
  opened.push(browser);
  return browser;
}

const answeredBy = async (bridge: RemoteBridge) =>
  ((await bridge.invoke('page.getPageInfo')) as { data?: { answeredBy?: string } }).data?.answeredBy;

describe('two browsers paired with one daemon', () => {
  test('sharing an origin, both pair and both stay connected', async () => {
    const first = await pair(chrome);
    const second = await pair(brave);
    await settled();
    const sessions = await (await control()).sessions();
    expect([first.isOpen, second.isOpen, sessions.map(({ id, browser, connected }) => [id, browser, connected])]).toEqual([
      true,
      true,
      [
        [chrome.installId, 'Google Chrome', true],
        [brave.installId, 'Brave', true],
      ],
    ]);
  });

  test('each returns on its own key, and neither takes the link from the other', async () => {
    const first = await pair(chrome);
    const second = await pair(brave);
    first.close();
    await settled();
    const back = await returnOf(chrome, { kind: 'session', key: first.sessionKey });
    await settled();
    expect([back.isOpen, second.isOpen]).toEqual([true, true]);
  });

  test("a browser cannot return on the other's key", async () => {
    const first = await pair(chrome);
    await pair(brave);
    await expect(returnOf(brave, { kind: 'session', key: first.sessionKey })).rejects.toThrow(/no longer paired/);
  });

  test('the same browser connecting twice supersedes only itself', async () => {
    const first = await pair(chrome);
    const other = await pair(brave);
    const again = await returnOf(chrome, { kind: 'session', key: first.sessionKey });
    expect([await first.closed, again.isOpen, other.isOpen]).toEqual(['superseded by a newer connection', true, true]);
  });

  test('unpairing one by its id leaves the other connected and paired', async () => {
    const first = await pair(chrome);
    const second = await pair(brave);
    const bridge = await control();
    const revoked = await bridge.revoke(chrome.installId);
    expect([revoked, await first.closed, second.isOpen, (await bridge.sessions()).map(({ id }) => id)]).toEqual([
      1,
      'pairing revoked',
      true,
      [brave.installId],
    ]);
  });
});

describe('a caller outside any browser', () => {
  test('reaches the browser the user was last in', async () => {
    const first = await pair(chrome);
    await pair(brave);
    await settled();
    await first.focus();
    expect(await answeredBy(await control())).toBe(chrome.installId);
  });

  test('stays with that browser through a burst of calls, while a new caller follows the user', async () => {
    const first = await pair(chrome);
    const second = await pair(brave);
    await settled();
    await first.focus();
    const busy = await control();
    const before = await answeredBy(busy);
    await settled();
    await second.focus();
    expect([before, await answeredBy(busy), await answeredBy(await control())]).toEqual([
      chrome.installId,
      chrome.installId,
      brave.installId,
    ]);
  });

  test('follows the browser focused last, even when both were focused within the same millisecond', async () => {
    const first = await pair(chrome);
    const second = await pair(brave);
    await settled();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await first.focus();
      await second.focus();
      const viaSecond = await answeredBy(await control());
      await first.focus();
      expect([viaSecond, await answeredBy(await control())]).toEqual([brave.installId, chrome.installId]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('moves to the browser still connected when its own goes away', async () => {
    const first = await pair(chrome);
    await pair(brave);
    await settled();
    await first.focus();
    const bridge = await control();
    await answeredBy(bridge);
    first.close();
    await settled();
    expect(await answeredBy(bridge)).toBe(brave.installId);
  });

  test('is told which browser answers it, and how many could', async () => {
    await pair(chrome);
    const second = await pair(brave);
    await settled();
    await second.focus();
    const { connected, browser, connectedBrowsers, pairedBrowsers } = await (await control()).status();
    expect([connected, browser, connectedBrowsers, pairedBrowsers]).toEqual([true, 'Brave', 2, 2]);
  });

  test('with no browser connected, is told the extension is offline', async () => {
    const result = await (await control()).invoke('page.getPageInfo');
    expect(result.ok ? null : result.error.code).toBe('EXTENSION_OFFLINE');
  });
});

describe('an action the browser takes a while over', () => {
  test('a caller that asks hears the daemon is still working; one that does not hears only the result', async () => {
    const browser = await pair(chrome);
    await settled();
    let release!: () => void;
    browser.holdInvokes = new Promise((resolve) => (release = resolve));

    const raw = new WebSocket(`ws://127.0.0.1:${daemon.port}/control`, { headers: { authorization: `Bearer ${readLockfile()!.token}` } });
    opened.push(raw);
    await new Promise((resolve) => raw.once('open', resolve));
    const heard: string[] = [];
    const working = new Promise<void>((resolve) =>
      raw.on('message', (frame) => {
        const { id, op } = JSON.parse(String(frame)) as { id: string; op: string };
        heard.push(`${id} ${op}`);
        if (op === 'working') resolve();
      }),
    );
    raw.send(JSON.stringify({ id: 'patient', op: 'invoke', action: 'page.getPageInfo', keepAlive: true }));
    raw.send(JSON.stringify({ id: 'plain', op: 'invoke', action: 'page.getPageInfo' }));

    await working;
    release();
    await vi.waitFor(() => expect(heard.filter((line) => line.endsWith(' invoke'))).toHaveLength(2));
    expect([heard.filter((line) => line.startsWith('patient')), heard.filter((line) => line.startsWith('plain'))]).toEqual([
      ['patient working', 'patient invoke'],
      ['plain invoke'],
    ]);
  });
});

describe('the tool list a caller is offered', () => {
  const offeredTo = async (bridge: RemoteBridge) => (await bridge.describe()).tools.map(({ name }) => name);

  test("is the list of the browser it would reach: Firefox's without the debugger tools, Chrome's whole", async () => {
    const fox = await pair(firefox);
    const second = await pair(chrome);
    await settled();
    await fox.focus();
    const viaFirefox = await control();
    const [foxTools, foxStatus] = [await offeredTo(viaFirefox), await viaFirefox.status()];
    await second.focus();
    const chromeTools = await offeredTo(await control());
    expect([
      foxStatus.manifestInSync,
      chromeTools.filter((name) => !foxTools.includes(name)).sort(),
      foxTools.filter((name) => !chromeTools.includes(name)),
    ]).toEqual([true, DEBUGGER_ONLY, []]);
  });

  test('a drifted build is served what it reports, and only it', async () => {
    const drifted: Profile = { ...brave, tools: [{ name: 'page.onlyHere', description: 'from a build we never saw', inputSchema: {} }] };
    const odd = await pair(drifted);
    const second = await pair(chrome);
    // The daemon adopts the list once the reply reaches it; the pong behind `focus` proves it has.
    await odd.described;
    await odd.focus();
    const viaDrifted = await control();
    const [oddTools, oddStatus] = [await offeredTo(viaDrifted), await viaDrifted.status()];
    await second.focus();
    const chromeTools = await offeredTo(await control());
    expect([oddStatus.manifestInSync, oddTools, chromeTools.includes('page.onlyHere'), chromeTools.includes('page.getPageInfo')]).toEqual([
      false,
      ['page.onlyHere'],
      false,
      true,
    ]);
  });
});

describe('a browser paired before install ids', () => {
  test('returns on the key it already holds and is known by its install id from then on', async () => {
    const key = 'k'.repeat(43);
    const paired = { key, origin: unpacked, extensionVersion: '0.6.1', pairedAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-09-01T00:00:00.000Z' };
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, 'auth.json'), JSON.stringify({ pairings: [], sessions: [paired] }));

    const back = await returnOf(chrome, { kind: 'session', key });
    const sessions = await (await control()).sessions();
    expect([back.isOpen, sessions.map(({ id, connected }) => [id, connected])]).toEqual([true, [[chrome.installId, true]]]);
  });
});
