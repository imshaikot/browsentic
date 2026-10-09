import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { success } from '@/lib/actions/protocol';
import { BLOCKED_SITES_KEY } from '@/lib/settings/blocked-sites';
import type { CdpEvent } from './socket';
import type { MirrorMessage } from '@/lib/phone/mirror';

const SERIAL = 'emulator-5554';
const FRONT = 'A'.repeat(32);
const BACK = 'B'.repeat(32);

const socket = vi.hoisted(() => ({ sent: [] as { method: string; params?: Record<string, unknown>; sessionId?: string }[], events: [] as ((event: CdpEvent) => void)[] }));

vi.mock('./socket', () => ({
  DAEMON_STATE_KEY: 'browsentic/daemon',
  sendCdp: async (_serial: string, method: string, params?: Record<string, unknown>, sessionId?: string) => {
    socket.sent.push({ method, params, sessionId });
    if (method === 'Target.attachToTarget') return success({ sessionId: `session-${params?.targetId}` });
    if (method === 'Runtime.evaluate') return success({ result: { value: sessionId === `session-${FRONT}` ? 'visible' : 'hidden' } });
    if (method === 'Page.getNavigationHistory') return success({ currentIndex: 1, entries: [{ id: 1, url: 'https://a.example/', title: 'A' }, { id: 2, url: 'https://b.example/', title: 'B' }] });
    return success({});
  },
  onCdpEvent: (listener: (event: CdpEvent) => void) => socket.events.push(listener),
  onPhoneClosed: () => undefined,
  onDaemonClosed: () => undefined,
  closePhone: () => undefined,
  openPhone: async () => success({}),
  launchPhoneChrome: async () => success({}),
}));

type Phone = typeof import('./phone');
let readPhone: Phone['readPhone'];
const connectListeners: ((port: unknown) => void)[] = [];

/** The page's end of the port, as the background sees it. */
function connectPage() {
  const received: MirrorMessage[] = [];
  const messageListeners: ((message: unknown) => void)[] = [];
  const port = {
    name: 'browsentic/phone',
    postMessage: (message: MirrorMessage) => received.push(message),
    onMessage: { addListener: (listener: (message: unknown) => void) => messageListeners.push(listener) },
    onDisconnect: { addListener: () => undefined },
  };
  connectListeners.forEach((listener) => listener(port));
  return { received, say: (message: unknown) => messageListeners.forEach((listener) => listener(message)) };
}

const methods = () => socket.sent.map(({ method }) => method);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const emit = (event: Omit<CdpEvent, 't' | 'serial'>) => socket.events.forEach((listener) => listener({ t: 'cdpEvent', serial: SERIAL, ...event }));

beforeEach(async () => {
  fakeBrowser.reset();
  socket.sent.length = 0;
  socket.events.length = 0;
  connectListeners.length = 0;
  Object.assign(fakeBrowser.runtime, { onConnect: { addListener: (listener: (port: unknown) => void) => connectListeners.push(listener) } });
  vi.resetModules();
  ({ readPhone } = await import('./phone'));
  (await import('./phone-mirror')).servePhoneMirror();
  await fakeBrowser.storage.session.set({
    'browsentic/phone': {
      serial: SERIAL,
      mirrorTabId: 9,
      windowId: 1,
      openedAt: 0,
      transport: 'usb',
      targets: [
        { targetId: BACK, url: 'https://b.example/', title: 'B' },
        { targetId: FRONT, url: 'https://a.example/', title: 'A' },
      ],
    },
  });
});

describe('the mirror in the background', () => {
  test('watching follows the tab in front, not the first listed, and streams it', async () => {
    const page = connectPage();
    page.say({ op: 'watch' });
    await settle();
    expect((await readPhone())?.activeTargetId).toBe(FRONT);
    expect(socket.sent.find(({ method }) => method === 'Page.startScreencast')).toEqual({
      method: 'Page.startScreencast',
      params: { format: 'jpeg', quality: 60, maxWidth: 720, maxHeight: 1600, everyNthFrame: 1 },
      sessionId: `session-${FRONT}`,
    });
    expect(page.received.find((message) => message.kind === 'page')).toMatchObject({ targetId: FRONT, url: 'https://b.example/', canGoBack: true, canGoForward: false });
  });

  test('a frame goes to the page, and the page’s ack goes to the phone', async () => {
    const page = connectPage();
    page.say({ op: 'watch' });
    await settle();
    emit({ method: 'Page.screencastFrame', params: { data: 'JPEG', sessionId: 7, metadata: { deviceWidth: 411, pageScaleFactor: 1 } }, sessionId: `session-${FRONT}` });
    expect(page.received.find((message) => message.kind === 'frame')).toEqual({ kind: 'frame', data: 'JPEG', frame: 7, metadata: { deviceWidth: 411, pageScaleFactor: 1 } });
    page.say({ op: 'ack', frame: 7 });
    await settle();
    expect(socket.sent.at(-1)).toEqual({ method: 'Page.screencastFrameAck', params: { sessionId: 7 }, sessionId: `session-${FRONT}` });
  });

  test('a finger’s moves while one is on its way collapse into the latest, and the lift still follows', async () => {
    const page = connectPage();
    page.say({ op: 'watch' });
    await settle();
    socket.sent.length = 0;
    page.say({ op: 'touch', type: 'touchStart', x: 10, y: 10 });
    for (let step = 1; step <= 5; step++) page.say({ op: 'touch', type: 'touchMove', x: 10, y: 10 + step * 10 });
    page.say({ op: 'touch', type: 'touchEnd', x: 10, y: 60 });
    await settle();
    expect(socket.sent.map(({ params }) => [params?.type, params?.touchPoints])).toEqual([
      ['touchStart', [{ x: 10, y: 10 }]],
      ['touchMove', [{ x: 10, y: 60 }]],
      ['touchEnd', []],
    ]);
  });

  test('a blocked site typed in the address bar is refused before the phone hears of it', async () => {
    await fakeBrowser.storage.local.set({ [BLOCKED_SITES_KEY]: ['bank.example'] });
    const page = connectPage();
    page.say({ op: 'watch' });
    await settle();
    page.say({ op: 'go', url: 'https://bank.example/login' });
    await settle();
    expect(methods()).not.toContain('Page.navigate');
    expect(page.received.at(-1)).toMatchObject({ kind: 'error' });
    page.say({ op: 'go', url: 'https://ok.example/' });
    await settle();
    expect(socket.sent.at(-1)).toMatchObject({ method: 'Page.navigate', params: { url: 'https://ok.example/' } });
  });

  test('the tab list follows the phone and leaves out the phantom target', async () => {
    connectPage();
    emit({ method: 'Target.targetCreated', params: { targetInfo: { targetId: '1', type: 'page', url: 'https://a.example/', title: 'A' } } });
    emit({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'C'.repeat(32), type: 'page', url: 'https://c.example/', title: 'C' } } });
    emit({ method: 'Target.targetCreated', params: { targetInfo: { targetId: 'D'.repeat(32), type: 'service_worker', url: 'https://c.example/sw.js', title: '' } } });
    emit({ method: 'Target.targetDestroyed', params: { targetId: BACK } });
    await settle();
    expect((await readPhone())?.targets.map(({ targetId }) => targetId[0])).toEqual(['A', 'C']);
  });

  test('back steps to the previous history entry', async () => {
    const page = connectPage();
    page.say({ op: 'watch' });
    await settle();
    page.say({ op: 'back' });
    await settle();
    expect(socket.sent.at(-1)).toEqual({ method: 'Page.navigateToHistoryEntry', params: { entryId: 1 }, sessionId: `session-${FRONT}` });
  });
});
