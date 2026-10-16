import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { CHROME_WEB_STORE } from '@/lib/stores';
import type { SocketFrame } from '@/lib/actions/protocol';
import type { DeviceNotice } from '@/lib/notices';
import { clearAuth } from '../auth-store';
import { startDaemon, type Daemon } from '../daemon';
import { readLockfile } from '../lockfile';
import { RemoteBridge } from '../remote-bridge';
import { FakeBrowser, type Profile } from './fake-browser';

const chrome: Profile = { origin: `chrome-extension://${CHROME_WEB_STORE.id}`, installId: 'install-notice-chrome1', browser: 'Google Chrome' };
const done: DeviceNotice = { id: 'monitor:build', kind: 'monitor', title: 'Done: build', body: 'Finished after 3:12.', tone: 'live' };

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

async function control(runId?: string): Promise<RemoteBridge> {
  const bridge = await RemoteBridge.connect(daemon.port, readLockfile()!.token, runId);
  opened.push(bridge);
  return bridge;
}

async function browserAt(profile: Profile): Promise<FakeBrowser> {
  const { code } = await (await control()).pair();
  const browser = await FakeBrowser.connect(daemon.port, profile, { kind: 'pair', code });
  opened.push(browser);
  return browser;
}

async function offer(browser: FakeBrowser, notice: DeviceNotice = done): Promise<boolean> {
  const answer = await browser.ask({ t: 'notice', id: crypto.randomUUID(), notice });
  return answer.t === 'noticeAck' && answer.delivered;
}

describe('notices for the Browsentic app', () => {
  test('a browser hears no app is there to show them, and shows its own card', async () => {
    expect(await offer(await browserAt(chrome))).toBe(false);
  });

  test('an app whose notifications are off takes none either', async () => {
    await (await control()).watchNotices(false);
    expect(await offer(await browserAt(chrome))).toBe(false);
  });

  test('an app that may show them is told, takes the notice once, with the browser it came from', async () => {
    const app = await control();
    let told = 0;
    app.onNoticesChanged(() => told++);
    await app.watchNotices(true);

    expect(await offer(await browserAt(chrome))).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(told).toBe(1);
    expect(await app.takeNotices()).toEqual([expect.objectContaining({ ...done, browser: 'Google Chrome' })]);
    expect(await app.takeNotices()).toEqual([]);
  });

  test('a click brings the browser that sent it back with that notice', async () => {
    const app = await control();
    await app.watchNotices(true);
    const browser = await browserAt(chrome);
    await offer(browser);
    await app.takeNotices();

    expect(await app.openNotice(done.id)).toBe(true);
    const [opened] = await browser.frames('openNotice');
    expect(opened).toEqual({ t: 'openNotice', noticeId: done.id } satisfies SocketFrame);
    expect(await app.openNotice('monitor:nobody')).toBe(false);
  });

  test('a notice that names no kind, title or body is taken by nobody', async () => {
    await (await control()).watchNotices(true);
    const browser = await browserAt(chrome);
    expect(await offer(browser, { ...done, kind: 'other' as never })).toBe(false);
    expect(await offer(browser, { ...done, title: 3 as never })).toBe(false);
  });

  test('an agent run can neither show nor take notices, nor open one', async () => {
    const run = await control('run-under-test');
    await run.describe();
    expect(await run.watchNotices(true)).toBe(false);
    expect(await offer(await browserAt(chrome))).toBe(false);
    expect(await run.takeNotices()).toEqual([]);
    expect(await run.openNotice(done.id)).toBe(false);
  });

  test('a browser on a protocol before notices is never sent a click it cannot read', async () => {
    const app = await control();
    await app.watchNotices(true);
    const older = await browserAt({ ...chrome, protocolVersion: 23 });
    await offer(older);
    expect(await app.openNotice(done.id)).toBe(false);
  });
});
