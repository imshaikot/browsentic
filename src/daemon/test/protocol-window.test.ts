import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { ANDROID_PROTOCOL, MIN_EXTENSION_PROTOCOL, SOCKET_PROTOCOL_VERSION, type SocketFrame } from '@/lib/actions/protocol';
import { CHROME_WEB_STORE } from '@/lib/stores';
import { clearAuth } from '../auth-store';
import { startDaemon, type Daemon } from '../daemon';
import { readLockfile } from '../lockfile';
import { RemoteBridge } from '../remote-bridge';
import { FakeAndroid, NO_PHONE, READY_PHONE } from './fake-android';
import { FakeBrowser, type Profile } from './fake-browser';

const store: Profile = {
  origin: `chrome-extension://${CHROME_WEB_STORE.id}`,
  installId: 'install-store-chrome1',
  browser: 'Google Chrome',
};

let daemon: Daemon;
let android: FakeAndroid;
let opened: { close(): unknown }[] = [];

beforeAll(async () => {
  android = new FakeAndroid();
  daemon = await startDaemon({ version: '0.0.0-test', idleExit: false, android });
});

afterAll(async () => {
  await daemon?.stop();
});

afterEach(async () => {
  for (const each of opened) each.close();
  opened = [];
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearAuth();
  android.current = NO_PHONE;
  android.launched.length = 0;
  android.asked.length = 0;
  android.released.length = 0;
});

async function control(): Promise<RemoteBridge> {
  const bridge = await RemoteBridge.connect(daemon.port, readLockfile()!.token);
  opened.push(bridge);
  return bridge;
}

async function pair(profile: Profile): Promise<FakeBrowser> {
  const { code } = await (await control()).pair();
  const browser = await FakeBrowser.connect(daemon.port, profile, { kind: 'pair', code });
  opened.push(browser);
  return browser;
}

describe('the protocol window', () => {
  test('a store copy a protocol ahead of the Bridge pairs, and comes back on its key', async () => {
    const ahead = { ...store, protocolVersion: SOCKET_PROTOCOL_VERSION + 1 };
    const paired = await pair(ahead);
    paired.close();
    const back = await FakeBrowser.connect(daemon.port, ahead, { kind: 'session', key: paired.sessionKey });
    opened.push(back);
    expect(back.isOpen).toBe(true);
  });

  test('the oldest extension the Bridge takes still pairs', async () => {
    expect((await pair({ ...store, protocolVersion: MIN_EXTENSION_PROTOCOL })).isOpen).toBe(true);
  });

  test('an extension older than that is told the versions do not match', async () => {
    await expect(pair({ ...store, protocolVersion: MIN_EXTENSION_PROTOCOL - 1 })).rejects.toThrow(
      /^protocol version mismatch: Browsentic Bridge speaks v\d+ and takes extensions from v\d+ on$/,
    );
  });

  test('an extension that needs a newer Bridge is told the Bridge is too old', async () => {
    await expect(
      pair({ ...store, protocolVersion: SOCKET_PROTOCOL_VERSION + 2, minDaemonProtocol: SOCKET_PROTOCOL_VERSION + 1 }),
    ).rejects.toThrow(/^daemon too old: /);
  });

  test('a paired session says which store its extension came from', async () => {
    await pair(store);
    const [session] = await (await control()).sessions();
    expect([session.source, session.connected]).toEqual(['chrome-web-store', true]);
  });
});

const ANDROID_FRAMES: ReadonlySet<SocketFrame['t']> = new Set(['androidInfo', 'phoneOpened', 'cdpResult', 'cdpEvent', 'phoneClosed']);

describe('Android across the protocol window', () => {
  const store22 = { ...store, protocolVersion: ANDROID_PROTOCOL - 1 };

  test('a protocol-22 store copy is sent no Android frame, and its phone requests are refused with an answer', async () => {
    const browser = await pair(store22);
    android.change(READY_PHONE);
    await browser.focus();
    expect(browser.received.map(({ t }) => t).filter((t) => ANDROID_FRAMES.has(t))).toEqual([]);
    expect(android.watchers).toBe(0);

    const refused = { ok: false, error: { code: 'UNSUPPORTED' } };
    expect(await browser.ask({ t: 'phoneOpen', id: 'open-1', serial: 'emulator-5554' })).toMatchObject({ t: 'phoneOpened', result: refused });
    expect(await browser.ask({ t: 'cdp', id: 'cdp-1', serial: 'emulator-5554', method: 'Browser.getVersion' })).toMatchObject({
      t: 'cdpResult',
      result: refused,
    });
    expect(await browser.ask({ t: 'phoneLaunch', id: 'launch-1', serial: 'emulator-5554' })).toMatchObject({ t: 'androidInfo', result: refused });
    expect(android.launched).toEqual([]);
  });

  test('a protocol-23 extension is sent the state on connect and on every change, and stops watching when it leaves', async () => {
    const browser = await pair({ ...store, protocolVersion: ANDROID_PROTOCOL });
    const [first] = await browser.frames('androidInfo');
    expect(first).toEqual({ t: 'androidInfo', id: '', result: { ok: true, data: NO_PHONE } });
    expect(android.watchers).toBe(1);

    android.change(READY_PHONE);
    const [, second] = await browser.frames('androidInfo', 2);
    expect(second.result).toEqual({ ok: true, data: READY_PHONE });

    browser.close();
    await browser.closed;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(android.watchers).toBe(0);
  });

  test('a protocol-23 extension can ask the Bridge to open Chrome on the phone', async () => {
    android.current = READY_PHONE;
    const browser = await pair({ ...store, protocolVersion: ANDROID_PROTOCOL });
    expect(await browser.ask({ t: 'phoneLaunch', id: 'launch-2', serial: 'emulator-5554' })).toEqual({
      t: 'androidInfo',
      id: 'launch-2',
      result: { ok: true, data: READY_PHONE },
    });
    expect(android.launched).toEqual(['emulator-5554']);
  });

  test('a protocol-23 extension\'s phone requests reach the Bridge\'s Android half, and leaving releases its sessions', async () => {
    android.current = READY_PHONE;
    const browser = await pair({ ...store, protocolVersion: ANDROID_PROTOCOL });
    expect(await browser.ask({ t: 'phoneOpen', id: 'open-2', serial: 'emulator-5554' })).toMatchObject({
      t: 'phoneOpened',
      result: { ok: true, data: { device: { serial: 'emulator-5554' } } },
    });
    expect(await browser.ask({ t: 'cdp', id: 'cdp-2', serial: 'emulator-5554', method: 'Runtime.evaluate', params: { expression: '1' } })).toEqual({
      t: 'cdpResult',
      id: 'cdp-2',
      result: { ok: true, data: { echoed: 'Runtime.evaluate' } },
    });
    browser.tell({ t: 'phoneClose', id: 'close-2', serial: 'emulator-5554' });
    await browser.focus();
    expect(android.asked.map(({ t, method }) => method ?? t)).toEqual(['phoneOpen', 'Runtime.evaluate', 'phoneClose']);
    expect(new Set(android.asked.map(({ owner }) => owner))).toEqual(new Set([store.installId]));

    browser.close();
    await browser.closed;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(android.released).toEqual([store.installId]);
  });

  test('a Firefox extension is not watched for phones, since its toggle is hidden', async () => {
    await pair({ origin: 'moz-extension://8f0e1d2c-0000-4000-8000-000000000000', installId: 'install-firefox-01', browser: 'Firefox', protocolVersion: ANDROID_PROTOCOL });
    expect(android.watchers).toBe(0);
  });

  test('the control op answers the state, and a watcher hears it and each change', async () => {
    const bridge = await control();
    const heard: unknown[] = [];
    bridge.onAndroidChanged((state) => heard.push(state));
    expect(await bridge.android({ watch: true })).toEqual({ ok: true, data: NO_PHONE });
    android.change(READY_PHONE);
    await bridge.status();
    expect(heard).toEqual([NO_PHONE, READY_PHONE]);
    bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(android.watchers).toBe(0);
  });

  test('an agent run cannot open Chrome on the phone through the control socket', async () => {
    const run = await RemoteBridge.connect(daemon.port, readLockfile()!.token, 'run-1');
    opened.push(run);
    await run.describe();
    expect(await run.android({ launch: 'emulator-5554' })).toMatchObject({ ok: false, error: { code: 'BLOCKED' } });
    expect(android.launched).toEqual([]);
    expect(await (await control()).android({ launch: 'emulator-5554' })).toEqual({ ok: true, data: NO_PHONE });
    expect(android.launched).toEqual(['emulator-5554']);
  });
});
