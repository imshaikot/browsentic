import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { success } from '@/lib/actions/protocol';

const calls: string[] = [];
let active = 1;
let hiddenTabRenders = false;

const plan = {
  mode: 'viewport',
  dpr: 1,
  viewport: { w: 10, h: 10 },
  page: { w: 10, h: 10 },
  region: { x: 0, y: 0, w: 10, h: 10 },
  scroll: { x: 0, y: 0 },
  format: 'png',
  maxLongSide: 4096,
};

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      get: async (id: number) => ({ id, active: id === active }),
      query: async () => [{ id: active }],
      update: async (id: number, props: { active?: boolean }) => {
        calls.push(`front:${id}`);
        if (props.active) active = id;
      },
      captureVisibleTab: async () => {
        calls.push('captureVisibleTab');
        return 'data:image/png;base64,AAAA';
      },
    },
  },
}));

vi.mock('@/lib/actions/client', () => ({
  invokeInFrame: async (_tab: number, _frame: unknown, name: string) =>
    name === 'page.screenshot' ? success(plan) : success({ scrollX: 0, scrollY: 0 }),
}));

vi.mock('./cdp', () => ({
  send: () => (hiddenTabRenders ? Promise.resolve({ data: 'AAAA' }) : new Promise(() => undefined)),
  withDebugger: async (_tab: number, _hint: string, run: (session: { tabId: number }) => Promise<unknown>) => {
    calls.push('attach');
    try {
      return await run({ tabId: 7 });
    } finally {
      calls.push('detach');
    }
  },
}));

vi.mock('./screenshot-preview', () => ({ publishScreenshot: async () => undefined }));

const { screenshotTab } = await import('./screenshot');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('FIREFOX', '');
  vi.stubEnv('CHROME', 'true');
  calls.length = 0;
  active = 1;
  hiddenTabRenders = false;
  vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob(['x']) }));
  vi.stubGlobal('createImageBitmap', async () => ({ width: 10, height: 10, close: () => undefined }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('screenshotTab on a tab behind the front one', () => {
  test('borrows the front when the debugger never gets a frame, then gives it back', async () => {
    const pending = screenshotTab({ id: 7, windowId: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual(['attach', 'detach', 'front:7', 'captureVisibleTab', 'front:1']);
    expect(active).toBe(1);
  });

  test('uses the debugger alone when the tab does render', async () => {
    hiddenTabRenders = true;
    const result = await screenshotTab({ id: 7, windowId: 1 });

    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual(['attach', 'detach']);
  });

  test('a tab already in front is captured without the debugger', async () => {
    const result = await screenshotTab({ id: 1, windowId: 1 });

    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual(['captureVisibleTab']);
  });
});
