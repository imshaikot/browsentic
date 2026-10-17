import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { success } from '@/lib/actions/protocol';
import { BLOCKED_SITES_KEY, SITE_BLOCKED } from '@/lib/settings/blocked-sites';
import { invokeForHarness } from './invoke';

const HOME = 'chrome-extension://abcdef/newtab.html';

const tabOn = async (url?: string) => (await fakeBrowser.tabs.create({ url, active: true })).id!;

let sent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeBrowser.reset();
  sent = vi.fn(async () => success({}));
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation(sent as never);
  const update = fakeBrowser.tabs.update.bind(fakeBrowser.tabs);
  vi.spyOn(fakeBrowser.tabs, 'update').mockImplementation((async (tabId: number, info: { url?: string }) => {
    const tab = await update(tabId, info);
    setTimeout(() => void fakeBrowser.tabs.onUpdated.trigger(tabId, { status: 'complete' }, tab), 0);
    return tab;
  }) as never);
});

afterEach(() => vi.restoreAllMocks());

describe('navigating away from a page that is not a web page', () => {
  test('the browser moves the tab, and nothing is sent into the page', async () => {
    const tabId = await tabOn(HOME);
    expect(await invokeForHarness('page.navigate', { url: 'https://example.com/' }, tabId)).toMatchObject({
      ok: true,
      data: { navigatedTo: 'https://example.com/', loaded: true },
    });
    expect((await fakeBrowser.tabs.get(tabId)).url).toBe('https://example.com/');
    expect(sent).not.toHaveBeenCalled();
  });

  test('a tab whose address the browser keeps from the extension is moved the same way', async () => {
    const tabId = await tabOn();
    expect(await invokeForHarness('page.navigate', { url: 'https://example.com/' }, tabId)).toMatchObject({ ok: true });
    expect(sent).not.toHaveBeenCalled();
  });

  test('a blocked destination is still refused, and the tab stays put', async () => {
    await fakeBrowser.storage.local.set({ [BLOCKED_SITES_KEY]: ['mybank.com'] });
    const tabId = await tabOn(HOME);
    expect(await invokeForHarness('page.navigate', { url: 'https://mybank.com/' }, tabId)).toMatchObject({
      ok: false,
      error: { code: SITE_BLOCKED },
    });
    expect((await fakeBrowser.tabs.get(tabId)).url).toBe(HOME);
  });

  test('a relative address has nothing to resolve against, and the error says to pass a full one', async () => {
    const tabId = await tabOn(HOME);
    expect(await invokeForHarness('page.navigate', { url: '/docs' }, tabId)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT', message: expect.stringContaining('absolute http(s) URL') },
    });
  });
});
