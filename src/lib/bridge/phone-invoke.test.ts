import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { success } from '@/lib/actions/protocol';
import { BLOCKED_SITES_KEY } from '@/lib/settings/blocked-sites';

const SERIAL = 'emulator-5554';
const HOME = 'A'.repeat(32);
const OTHER = 'B'.repeat(32);

const phone = vi.hoisted(() => ({
  sent: [] as { method: string; params?: Record<string, unknown> }[],
  location: 'https://news.example/',
  fronted: [] as string[],
  followed: [] as string[],
}));

vi.mock('./socket', () => ({
  DAEMON_STATE_KEY: 'browsentic/daemon',
  sendCdp: async (_serial: string, method: string, params?: Record<string, unknown>) => {
    phone.sent.push({ method, params });
    if (method === 'Page.navigate') phone.location = String(params?.url);
    if (method === 'Runtime.evaluate') return success({ result: { value: JSON.stringify({ url: phone.location, title: 'Landed', readyState: 'complete' }) } });
    if (method === 'Target.createTarget') return success({ targetId: 'C'.repeat(32) });
    if (method === 'Page.getLayoutMetrics') return success({ cssVisualViewport: { clientWidth: 411, clientHeight: 675 } });
    return success({});
  },
  closePhone: () => undefined,
  openPhone: async () => success({}),
  launchPhoneChrome: async () => success({}),
  onPhoneClosed: () => undefined,
  onDaemonClosed: () => undefined,
}));

vi.mock('./phone-mirror', () => ({
  attachedSession: async (_serial: string, targetId: string) => `session-${targetId}`,
  bringToFront: async (_serial: string, targetId: string) => void phone.fronted.push(targetId),
  followTarget: async (targetId: string) => void phone.followed.push(targetId),
}));

const { invokeOnPhone, phoneRoute } = await import('./phone-invoke');
const { phoneAnchor, phoneContext } = await import('./phone-conversation');
const { invokeForHarness } = await import('./invoke');
const { ensureSessionForTab, patchSession } = await import('./tab-sessions');

let mirrorTabId: number;
let desktopTabId: number;

beforeEach(async () => {
  fakeBrowser.reset();
  phone.sent.length = 0;
  phone.fronted.length = 0;
  phone.followed.length = 0;
  phone.location = 'https://news.example/';
  desktopTabId = (await fakeBrowser.tabs.create({ url: 'https://desktop.example/', active: false })).id!;
  mirrorTabId = (await fakeBrowser.tabs.create({ url: 'chrome-extension://abc/phone.html', active: true })).id!;
  await fakeBrowser.storage.session.set({
    'browsentic/phone': {
      serial: SERIAL,
      model: 'Pixel 8',
      mirrorTabId,
      windowId: 1,
      openedAt: 0,
      activeTargetId: HOME,
      targets: [
        { targetId: HOME, url: 'https://news.example/', title: 'News' },
        { targetId: OTHER, url: 'https://shop.example/', title: 'Shop' },
      ],
      tabNumbers: { [HOME]: 1, [OTHER]: 2 },
    },
    'browsentic/daemon': {
      connected: true,
      paired: true,
      lastChangeAt: 0,
      android: { devices: [{ serial: SERIAL, model: 'Pixel 8', android: '16', screen: { width: 1080, height: 2400, density: 420, awake: true }, chrome: { version: '150.0.7871.186' } }] },
    },
  });
});

const block = (...patterns: string[]) => fakeBrowser.storage.local.set({ [BLOCKED_SITES_KEY]: patterns });

describe('which calls go to the phone', () => {
  test('a call landing on the phone tab with no run does, and a desktop tab’s does not', async () => {
    expect(await phoneRoute(mirrorTabId, undefined)).toMatchObject({ serial: SERIAL });
    expect(await phoneRoute(desktopTabId, undefined)).toBeNull();
  });

  test('a run whose conversation lives on the phone tab does, wherever its tab id points', async () => {
    const ensured = await ensureSessionForTab({ tabId: mirrorTabId, url: 'https://news.example/' });
    if (!ensured.ok) throw new Error('no session');
    await patchSession(ensured.session.sessionId, { runId: 'run-1', phone: { serial: SERIAL } });
    expect(await phoneRoute(desktopTabId, 'run-1')).toMatchObject({ serial: SERIAL });
    const desktop = await ensureSessionForTab({ tabId: desktopTabId, url: 'https://desktop.example/' });
    if (!desktop.ok) throw new Error('no session');
    await patchSession(desktop.session.sessionId, { runId: 'run-2' });
    expect(await phoneRoute(mirrorTabId, 'run-2')).toBeNull();
  });

  test('a phone run after the phone went away is told so', async () => {
    const ensured = await ensureSessionForTab({ tabId: mirrorTabId });
    if (!ensured.ok) throw new Error('no session');
    await patchSession(ensured.session.sessionId, { runId: 'run-3', phone: { serial: SERIAL } });
    const stored = (await fakeBrowser.storage.session.get('browsentic/phone'))['browsentic/phone'] as object;
    await fakeBrowser.storage.session.set({ 'browsentic/phone': { ...stored, ended: { reason: 'unplugged', at: 1 } } });
    expect(await invokeForHarness('page.getPageInfo', {}, mirrorTabId, 'run-3')).toMatchObject({ ok: false, error: { code: 'PHONE_GONE' } });
  });

  test('invokeForHarness takes the phone branch before any desktop check of the extension page', async () => {
    expect(await invokeForHarness('page.hoverElement', {}, mirrorTabId)).toMatchObject({ ok: false, error: { code: 'NOT_ON_PHONE' } });
  });
});

describe('a tool on the phone', () => {
  const route = async () => (await phoneRoute(mirrorTabId, undefined))!;

  test('a tool off the list is refused with where it does work', async () => {
    expect(await invokeOnPhone('page.captureDownload', {}, await route())).toEqual({
      ok: false,
      error: { code: 'NOT_ON_PHONE', message: 'page.captureDownload isn’t available on the phone. It works in desktop tabs.' },
    });
  });

  test('a blocked phone page refuses every action, before the phone hears of it', async () => {
    await block('news.example');
    expect(await invokeOnPhone('page.getPageInfo', {}, await route())).toMatchObject({ ok: false, error: { code: 'SITE_BLOCKED' } });
    expect(phone.sent).toEqual([]);
  });

  test('navigating to a blocked host is refused before it goes', async () => {
    await block('bank.example');
    expect(await invokeOnPhone('page.navigate', { url: 'https://bank.example/' }, await route())).toMatchObject({ ok: false, error: { code: 'SITE_BLOCKED' } });
    expect(phone.sent.map(({ method }) => method)).not.toContain('Page.navigate');
  });

  test('a page that lands somewhere blocked is refused after it lands', async () => {
    await block('landing.example');
    const landed = invokeOnPhone('page.navigate', { url: 'https://ok.example/' }, await route());
    phone.location = 'https://landing.example/';
    await fakeBrowser.storage.session.get('browsentic/phone').then(async (stored) => {
      const session = stored['browsentic/phone'] as { targets: { targetId: string; url: string; title: string }[] };
      session.targets[0].url = 'https://landing.example/';
      await fakeBrowser.storage.session.set({ 'browsentic/phone': session });
    });
    expect(await landed).toMatchObject({ ok: false, error: { code: 'SITE_BLOCKED' } });
  });

  test('navigate opens the URL in the phone’s current tab and waits for it to load', async () => {
    expect(await invokeOnPhone('page.navigate', { url: 'https://wikipedia.org/' }, await route())).toEqual({
      ok: true,
      data: { navigatedTo: 'https://wikipedia.org/', finalUrl: 'https://wikipedia.org/', title: 'Landed', loaded: true },
    });
    expect(phone.sent[0]).toEqual({ method: 'Page.navigate', params: { url: 'https://wikipedia.org/' } });
  });

  test('switchTab takes the phone’s tab numbers, brings that tab to the front and moves the mirror to it', async () => {
    expect(await invokeOnPhone('page.switchTab', { tabId: 2 }, await route())).toMatchObject({ ok: true, data: { activeTabId: 2 } });
    expect([phone.fronted, phone.followed]).toEqual([[OTHER], [OTHER]]);
    expect(await invokeOnPhone('page.switchTab', {}, await route())).toMatchObject({
      ok: true,
      data: { tabs: [{ tabId: 1, active: true }, { tabId: 2, active: false }] },
    });
  });

  test('openTab in the background opens in front, as Android insists, then puts the previous tab back', async () => {
    const opened = await invokeOnPhone('page.openTab', { url: 'https://docs.example/', active: false }, await route());
    expect(opened).toMatchObject({ ok: true, data: { tabId: 3, activeTabId: 1 } });
    expect(phone.fronted).toEqual([HOME]);
    expect(phone.followed).toEqual([]);
  });
});

describe('a conversation on the phone tab', () => {
  test('is anchored on the phone’s page, never the extension page', async () => {
    const { anchor, serial } = await phoneAnchor({ tabId: mirrorTabId, url: 'chrome-extension://abc/phone.html', title: 'Android · Pixel 8' });
    expect([anchor.url, anchor.title, serial]).toEqual(['https://news.example/', 'News', SERIAL]);
    expect((await phoneAnchor({ tabId: desktopTabId, url: 'https://desktop.example/' })).serial).toBeUndefined();
  });

  test('tells its run which phone, and the viewport as the page has it now', async () => {
    const ensured = await ensureSessionForTab({ tabId: mirrorTabId });
    if (!ensured.ok) throw new Error('no session');
    expect(await phoneContext({ ...ensured.session, phone: { serial: SERIAL } })).toEqual({
      serial: SERIAL,
      model: 'Pixel 8',
      android: '16',
      chrome: '150.0.7871.186',
      viewport: { width: 411, height: 675, dpr: 2.625 },
    });
    expect(await phoneContext({ ...ensured.session, phone: undefined })).toBeUndefined();
  });
});
