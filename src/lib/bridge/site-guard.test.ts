import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { success, type ActionResult } from '@/lib/actions/protocol';
import { BLOCKED_SITES_KEY, LIST_UNREADABLE_MESSAGE, SITE_BLOCKED } from '@/lib/settings/blocked-sites';
import { setFramePath } from './frame-focus';
import { invokeForHarness } from './invoke';

const block = (...patterns: string[]) => fakeBrowser.storage.local.set({ [BLOCKED_SITES_KEY]: patterns });

const tabOn = async (url: string) => (await fakeBrowser.tabs.create({ url, active: true })).id!;

const refusedAsBlocked = (result: ActionResult) => !result.ok && result.error.code === SITE_BLOCKED;

let sent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeBrowser.reset();
  sent = vi.fn(async () => success({ text: 'the page' }));
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockImplementation(sent as never);
});

afterEach(() => vi.restoreAllMocks());

describe('the tab an action would touch', () => {
  test('a blocked tab is refused before the page hears anything', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://www.mybank.com/accounts');
    expect(refusedAsBlocked(await invokeForHarness('page.extractText', {}, tabId))).toBe(true);
    expect(sent).not.toHaveBeenCalled();
  });

  test('an allowed tab goes through as before', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://example.com/');
    expect(await invokeForHarness('page.extractText', {}, tabId)).toMatchObject({ ok: true });
    expect(sent).toHaveBeenCalledOnce();
  });

  test('a tab on its way to a blocked page is refused already', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://example.com/');
    const tab = await fakeBrowser.tabs.get(tabId);
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({ ...tab, pendingUrl: 'https://mybank.com/login' } as never);
    expect(refusedAsBlocked(await invokeForHarness('page.clickElement', { target: { text: 'Go' } }, tabId))).toBe(true);
  });

  test('a blocked frame inside an allowed page is refused while it holds the focus', async () => {
    await block('pay.mybank.com');
    const tabId = await tabOn('https://shop.example.com/checkout');
    await setFramePath(tabId, [{ frameId: 7, url: 'https://pay.mybank.com/widget', selector: 'iframe#pay' }]);
    expect(refusedAsBlocked(await invokeForHarness('page.fillInput', { target: { text: 'Card' }, value: '1' }, tabId))).toBe(true);
  });

  test('a browser page is refused outright, so the settings page can never be driven', async () => {
    const tabId = await tabOn('chrome-extension://abcdef/options.html#blocked');
    for (const action of ['page.findCaptcha', 'page.injectCode', 'page.screenshot', 'page.extractText']) {
      expect(await invokeForHarness(action, {}, tabId)).toMatchObject({ ok: false, error: { code: 'TAB_UNREACHABLE' } });
    }
    expect(sent).not.toHaveBeenCalled();
  });

  test('an unreadable list refuses every page action, and says why', async () => {
    const tabId = await tabOn('https://example.com/');
    await fakeBrowser.storage.local.set({ [BLOCKED_SITES_KEY]: 'not a list' });
    expect(await invokeForHarness('page.extractText', {}, tabId)).toMatchObject({
      ok: false,
      error: { code: SITE_BLOCKED, message: LIST_UNREADABLE_MESSAGE },
    });
  });

  test('actions that never touch a tab still answer', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://mybank.com/');
    expect(await invokeForHarness('page.listFiles', {}, tabId)).toMatchObject({ ok: true });
    expect(await invokeForHarness('page.timerStatus', {}, tabId)).toMatchObject({ ok: true });
  });

  test('watching a blocked tab is refused, whichever tab the run is on', async () => {
    await block('mybank.com');
    const current = await tabOn('https://example.com/');
    const watched = await tabOn('https://mybank.com/transfer');
    const until = { kind: 'text-matches', pattern: 'Done', threshold: 1 };
    expect(refusedAsBlocked(await invokeForHarness('page.startMonitor', { tabId: watched, until }, current))).toBe(true);
  });
});

describe('where an action would send the browser', () => {
  test('navigating to a blocked address is refused, and the tab stays put', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://example.com/');
    expect(refusedAsBlocked(await invokeForHarness('page.navigate', { url: 'https://mybank.com/' }, tabId))).toBe(true);
    expect((await fakeBrowser.tabs.get(tabId)).url).toBe('https://example.com/');
  });

  test('a relative address is resolved against the page first', async () => {
    await block('example.com/admin');
    const tabId = await tabOn('https://example.com/home');
    expect(refusedAsBlocked(await invokeForHarness('page.navigate', { url: '/admin/users' }, tabId))).toBe(true);
    expect(refusedAsBlocked(await invokeForHarness('page.navigate', { url: '/%61dmin' }, tabId))).toBe(true);
  });

  test('a download from a blocked address is refused before the browser sends its cookies', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://example.com/');
    const download = vi.spyOn(fakeBrowser.downloads, 'download');
    expect(refusedAsBlocked(await invokeForHarness('page.captureDownload', { url: 'https://mybank.com/statement.pdf' }, tabId))).toBe(true);
    expect(download).not.toHaveBeenCalled();
  });

  test('opening a blocked site in a new tab is refused before the tab exists', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://example.com/');
    const before = (await fakeBrowser.tabs.query({})).length;
    expect(refusedAsBlocked(await invokeForHarness('page.openTab', { url: 'https://mybank.com/' }, tabId))).toBe(true);
    expect(await fakeBrowser.tabs.query({})).toHaveLength(before);
  });

  test('an action that lands the tab on a blocked site hands back nothing from it', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://example.com/');
    sent.mockImplementation(async () => {
      await fakeBrowser.tabs.update(tabId, { url: 'https://mybank.com/after-redirect' });
      return success({ text: 'what the bank page said' });
    });
    const result = await invokeForHarness('page.clickElement', { target: { text: 'Continue' } }, tabId);
    expect(refusedAsBlocked(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('what the bank page said');
  });
});

describe('other tabs', () => {
  async function window() {
    const current = await tabOn('https://example.com/');
    const bank = await tabOn('https://mybank.com/accounts');
    await fakeBrowser.tabs.update(current, { active: true });
    return { current, bank };
  }

  test('a blocked tab is left out of the list, counted as hidden, and never named', async () => {
    await block('mybank.com');
    const { current } = await window();
    const result = await invokeForHarness('page.switchTab', {}, current);
    expect(result).toMatchObject({ ok: true, data: { tabs: [{ url: 'https://example.com/' }] } });
    expect((result as { data: { hidden: number } }).data.hidden).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result)).not.toContain('mybank');
  });

  test('switching to it by id is refused, and matching its title or address finds nothing', async () => {
    await block('mybank.com');
    const { current, bank } = await window();
    expect(refusedAsBlocked(await invokeForHarness('page.switchTab', { tabId: bank }, current))).toBe(true);
    const matched = await invokeForHarness('page.switchTab', { match: 'mybank' }, current);
    expect(matched).toMatchObject({ ok: false, error: { code: 'TARGET_NOT_FOUND' } });
    expect(JSON.stringify(matched)).not.toContain('accounts');
  });

  test('closing it is refused', async () => {
    await block('mybank.com');
    const { current, bank } = await window();
    expect(refusedAsBlocked(await invokeForHarness('page.closeTab', { tabId: bank }, current))).toBe(true);
    expect(await fakeBrowser.tabs.get(bank)).toBeDefined();
  });

  test('a run on a blocked tab can still leave it for an allowed site', async () => {
    await block('mybank.com');
    const bank = await tabOn('https://mybank.com/');
    vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation(async (props) => ({ id: 99, index: 1, windowId: 1, ...props }) as never);
    vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation(async (id) =>
      ({ id, windowId: 1, url: id === 99 ? 'https://example.com/' : 'https://mybank.com/', status: 'complete' }) as never,
    );
    expect(await invokeForHarness('page.openTab', { url: 'https://example.com/' }, bank)).toMatchObject({ ok: true });
  });
});
