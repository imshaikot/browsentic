import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { success } from '@/lib/actions/protocol';

const SERIAL = 'emulator-5554';
const FRONT = 'A'.repeat(32);

const phone = vi.hoisted(() => ({
  evaluated: [] as { expression: string; contextId?: unknown }[],
}));

vi.mock('./socket', () => ({
  DAEMON_STATE_KEY: 'browsentic/daemon',
  sendCdp: async (_serial: string, method: string, params?: Record<string, unknown>) => {
    if (method === 'Page.getFrameTree') return success({ frameTree: { frame: { id: 'TOP' } } });
    if (method === 'Page.createIsolatedWorld') return success({ executionContextId: 7 });
    if (method !== 'Runtime.evaluate') return success({});
    const expression = String(params?.expression);
    phone.evaluated.push({ expression, contextId: params?.contextId });
    if (expression.includes('__browsenticToolkit')) return success({ result: { value: [{ name: 'addTag', arity: 1 }] } });
    if (expression.startsWith('__browsenticPhone.dispatch("page.runCode"')) return success({ result: { value: { ok: true, data: { function: 'addTag', returned: 'tagged' } } } });
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
  bringToFront: async () => undefined,
  followTarget: async () => undefined,
}));

const { invokeOnPhone, toolkitPlaceFor } = await import('./phone-invoke');
const { readPhone } = await import('./phone');

let mirrorTabId: number;

const phoneAt = async (url: string) => {
  await fakeBrowser.storage.session.set({
    'browsentic/phone': { serial: SERIAL, mirrorTabId, windowId: 1, openedAt: 0, activeTargetId: FRONT, targets: [{ targetId: FRONT, url, title: 'Tags' }] },
  });
  return (await readPhone())!;
};

const install = { purpose: 'Tag every row', code: 'tools.addTag = (name) => name;' };
const toolkits = async () => (await fakeBrowser.storage.session.get('browsentic/codeToolkits'))['browsentic/codeToolkits'] as Record<string, { origin: string }>;

beforeEach(async () => {
  fakeBrowser.reset();
  phone.evaluated.length = 0;
  vi.stubGlobal('fetch', async () => new Response('/* the bundle */'));
  mirrorTabId = (await fakeBrowser.tabs.create({ url: 'chrome-extension://abc/phone.html', active: true })).id!;
});

describe('live tools on the phone', () => {
  test('approved code installs in the phone page’s main world, and is recorded for the phone’s tab and site', async () => {
    const installed = await invokeOnPhone('page.injectCode', install, await phoneAt('https://tags.example/list'));
    expect(installed).toMatchObject({ ok: true, data: { origin: 'https://tags.example', functions: ['addTag'] } });
    expect(phone.evaluated.find(({ expression }) => expression.includes('__browsenticToolkit'))?.contextId).toBeUndefined();
    expect(Object.keys(await toolkits())).toEqual([`phone:${FRONT}`]);
  });

  test('a call runs runCode’s own page side in the bundle’s world, which reaches the toolkit by DOM events', async () => {
    const at = await phoneAt('https://tags.example/list');
    await invokeOnPhone('page.injectCode', install, at);
    const called = await invokeOnPhone('page.runCode', { function: 'addTag', args: ['urgent'] }, at);
    expect(called).toEqual({ ok: true, data: { function: 'addTag', returned: 'tagged' } });
    expect(phone.evaluated.find(({ expression }) => expression.startsWith('__browsenticPhone.dispatch("page.runCode"'))?.contextId).toBe(7);
  });

  test('a call after the phone went to another site is refused, as on desktop', async () => {
    await invokeOnPhone('page.injectCode', install, await phoneAt('https://tags.example/list'));
    const elsewhere = await invokeOnPhone('page.runCode', { function: 'addTag', args: ['x'] }, await phoneAt('https://other.example/'));
    expect(elsewhere).toMatchObject({ ok: false, error: { code: 'TOOLKIT_SCOPE' } });
  });

  test('the panel on the phone tab saves and runs tools on the phone’s page, and on a desktop tab on that tab', async () => {
    await phoneAt('https://tags.example/list');
    const desktopTabId = (await fakeBrowser.tabs.create({ url: 'https://desk.example/', active: false })).id!;
    const onPhone = await toolkitPlaceFor(mirrorTabId, '');
    const onDesktop = await toolkitPlaceFor(desktopTabId, 'https://desk.example/');
    expect([onPhone?.place.key, onPhone?.url]).toEqual([`phone:${FRONT}`, 'https://tags.example/list']);
    expect([onDesktop?.place.key, onDesktop?.url]).toEqual([String(desktopTabId), 'https://desk.example/']);
  });
});
