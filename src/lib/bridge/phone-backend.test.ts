import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import type { PhoneSession } from './phone';

const TARGET = 'A'.repeat(32);

const phone = vi.hoisted(() => ({
  sent: [] as { method: string; params?: Record<string, unknown> }[],
  contexts: 0,
  answer: (_expression: string): unknown => ({ ok: true, data: {} }),
  goneOnce: false,
  viewport: { offsetX: 0, offsetY: 50, clientWidth: 411, clientHeight: 675 },
}));

vi.mock('./socket', () => ({
  DAEMON_STATE_KEY: 'browsentic/daemon',
  sendCdp: async (_serial: string, method: string, params?: Record<string, unknown>) => {
    phone.sent.push({ method, params });
    if (method === 'Page.getFrameTree') return success({ frameTree: { frame: { id: 'TOP' } } });
    if (method === 'Page.createIsolatedWorld') return success({ executionContextId: ++phone.contexts });
    if (method === 'Page.getLayoutMetrics') return success({ cssVisualViewport: phone.viewport });
    if (method === 'Runtime.evaluate' && String(params?.expression).startsWith('__browsenticPhone.dispatch')) {
      if (phone.goneOnce) {
        phone.goneOnce = false;
        return failure('CDP_ERROR', 'Cannot find context with specified id');
      }
      return success({ result: { value: phone.answer(String(params?.expression)) } });
    }
    if (method === 'Runtime.evaluate' && String(params?.expression).includes('scrollY')) return success({ result: { value: { scrollX: 0, scrollY: 574 } } });
    return success({});
  },
  onCdpEvent: () => undefined,
  onPhoneClosed: () => undefined,
  onDaemonClosed: () => undefined,
}));

vi.mock('./phone-mirror', () => ({ attachedSession: async () => 'session-1' }));

const { pageSideOnPhone, shotClip } = await import('./phone-backend');

const SESSION: PhoneSession = {
  serial: 'emulator-5554',
  mirrorTabId: 9,
  windowId: 1,
  openedAt: 0,
  activeTargetId: TARGET,
  targets: [{ targetId: TARGET, url: 'http://localhost:8080/', title: 'Spike page' }],
};

const methods = () => phone.sent.map(({ method }) => method);
const input = (type: string) => phone.sent.filter(({ method, params }) => method === 'Input.dispatchTouchEvent' && params?.type === type);

beforeEach(() => {
  fakeBrowser.reset();
  phone.sent.length = 0;
  phone.goneOnce = false;
  phone.viewport = { offsetX: 0, offsetY: 50, clientWidth: 411, clientHeight: 675 };
  phone.answer = () => ({ ok: true, data: {} });
  vi.stubGlobal('fetch', async () => new Response('/* the bundle */'));
});

describe('page-side tools on the phone', () => {
  test('run in an isolated world that is made, and given the bundle, once', async () => {
    phone.answer = () => ({ ok: true, data: { title: 'Spike page' } });
    const first = await pageSideOnPhone('page.getPageInfo', {}, SESSION);
    await pageSideOnPhone('page.extractText', {}, SESSION);
    expect(first).toEqual({ ok: true, data: { title: 'Spike page' } });
    expect(methods().filter((method) => method === 'Page.createIsolatedWorld')).toHaveLength(1);
    expect(phone.sent.filter(({ params }) => params?.expression === '/* the bundle */')).toHaveLength(1);
  });

  test('a navigation that killed the world makes it again and retries once', async () => {
    await pageSideOnPhone('page.getPageInfo', {}, SESSION);
    const before = methods().filter((method) => method === 'Page.createIsolatedWorld').length;
    phone.goneOnce = true;
    expect((await pageSideOnPhone('page.getPageInfo', {}, SESSION)).ok).toBe(true);
    expect(methods().filter((method) => method === 'Page.createIsolatedWorld').length - before).toBe(1);
  });
});

describe('touch on the phone', () => {
  test('a click is a tap at the page’s point less the visual viewport’s offset, reported like a click', async () => {
    phone.answer = () => ({ ok: true, data: { tag: 'a', text: 'Go to second', point: { x: 100, y: 200 }, from: { x: 90, y: 190 }, button: 'left', submits: false } });
    const clicked = (await pageSideOnPhone('page.clickElement', { target: { selector: '#link' } }, SESSION)) as ActionResult<Record<string, unknown>>;
    expect(clicked).toEqual({ ok: true, data: { tag: 'a', text: 'Go to second', submits: false } });
    expect(input('touchStart')[0].params?.touchPoints).toEqual([{ x: 100, y: 150 }]);
    expect(input('touchEnd')[0].params?.touchPoints).toEqual([]);
  });

  test('a point off the visible screen is not touched, and says why', async () => {
    phone.answer = () => ({ ok: true, data: { point: { x: 100, y: 2000 } } });
    expect(await pageSideOnPhone('page.clickElement', { target: { selector: '#far' } }, SESSION)).toMatchObject({ ok: false, error: { code: 'TAP_MISSED' } });
    expect(input('touchStart')).toEqual([]);
  });

  test('scrolling a screen down is wheel steps at the middle of the screen, adding up to 85% of it', async () => {
    const scrolled = await pageSideOnPhone('page.scrollTo', { direction: 'down' }, SESSION);
    const wheels = phone.sent.filter(({ params }) => params?.type === 'mouseWheel');
    expect(wheels.reduce((sum, { params }) => sum + Number(params?.deltaY), 0)).toBe(Math.round(675 * 0.85));
    expect(wheels[0].params).toMatchObject({ x: 205.5, y: 337.5 });
    expect(scrolled).toEqual({ ok: true, data: { direction: 'down', scrollX: 0, scrollY: 574 } });
  });

  test('typing focuses the field in the page, selects what it held, and inserts the text', async () => {
    phone.answer = () => ({ ok: true, data: { tag: 'input' } });
    await pageSideOnPhone('page.typeText', { target: { selector: '#inp' }, text: 'hello\nworld' }, SESSION);
    const typed = phone.sent.filter(({ method }) => method === 'Input.insertText' || method === 'Input.dispatchKeyEvent').map(({ params }) => params?.text ?? params?.type);
    expect(typed).toEqual(['hello', '\r', 'keyUp', 'world']);
    expect(phone.sent.some(({ params }) => String(params?.expression).includes('page.focusInput'))).toBe(true);
    expect(phone.sent.some(({ params }) => String(params?.expression).includes('select()'))).toBe(true);
  });
});

describe('a screenshot on the phone', () => {
  const plan = { mode: 'viewport' as const, dpr: 2.625, viewport: { w: 411, h: 675 }, region: { x: 0, y: 300, w: 411, h: 675 }, format: 'jpeg' as const, maxLongSide: 675 };

  test('clips in CSS px and scales against device pixels, so one image pixel is one CSS pixel', () => {
    expect(shotClip(plan)).toEqual({ clip: { x: 0, y: 300, width: 411, height: 675, scale: 1 / 2.625 }, width: 411, height: 675, truncated: false });
  });

  test('a long page is cut at eight screens and fitted to the longest side asked for', () => {
    const shot = shotClip({ ...plan, mode: 'fullPage', region: { x: 0, y: 0, w: 411, h: 11_000 }, maxLongSide: 1600 });
    expect(shot.truncated).toBe(true);
    expect(shot.clip.height).toBe(5400);
    expect([shot.width, shot.height]).toEqual([Math.round(411 * (1600 / 5400)), 1600]);
  });
});
