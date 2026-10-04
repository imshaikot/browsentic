import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { MIN_EXTENSION_PROTOCOL, SOCKET_PROTOCOL_VERSION } from '@/lib/actions/protocol';
import { CHROME_WEB_STORE } from '@/lib/stores';
import { clearAuth } from '../auth-store';
import { startDaemon, type Daemon } from '../daemon';
import { readLockfile } from '../lockfile';
import { RemoteBridge } from '../remote-bridge';
import { FakeBrowser, type Profile } from './fake-browser';

const store: Profile = {
  origin: `chrome-extension://${CHROME_WEB_STORE.id}`,
  installId: 'install-store-chrome1',
  browser: 'Google Chrome',
};

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
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearAuth();
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
