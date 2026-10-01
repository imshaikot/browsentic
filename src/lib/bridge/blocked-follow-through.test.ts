import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { BLOCKED_SITES_KEY, SITE_BLOCKED } from '@/lib/settings/blocked-sites';
import { completedMonitorStates, monitorsForTab, serveMonitor, startTabMonitor } from './monitor';
import { appendEvents, currentRecording, recordingStateFor, serveRecorder, startRecording } from './recorder';

const block = (...patterns: string[]) => fakeBrowser.storage.local.set({ [BLOCKED_SITES_KEY]: patterns });

const tabOn = async (url: string) => (await fakeBrowser.tabs.create({ url, active: true })).id!;

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockResolvedValue(undefined as never);
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ content_scripts: [] } as never);
  Object.assign(fakeBrowser, { notifications: { create: vi.fn(async () => ''), clear: vi.fn(), onClicked: { addListener: vi.fn() } } });
});

afterEach(() => vi.restoreAllMocks());

describe('a monitor', () => {
  const until = { kind: 'text-matches' as const, pattern: 'Done', threshold: 1 };

  test('ends when its tab moves onto a blocked site, without naming where it went', async () => {
    serveMonitor();
    await block('mybank.com');
    const tabId = await tabOn('https://example.com/upload');
    expect(await startTabMonitor({ until, timeoutMs: 60_000 }, tabId)).toMatchObject({ ok: true });

    await fakeBrowser.tabs.update(tabId, { url: 'https://mybank.com/statement' });
    await settle();

    const [ended] = await completedMonitorStates();
    expect(ended).toMatchObject({ phase: 'tab-navigated' });
    expect(JSON.stringify(ended)).not.toContain('mybank');
  });

  test('ends when the site it watches is blocked while it runs', async () => {
    serveMonitor();
    const tabId = await tabOn('https://example.com/upload');
    await startTabMonitor({ until, timeoutMs: 60_000 }, tabId);
    await block('example.com');
    await settle();
    expect(await completedMonitorStates()).toMatchObject([{ phase: 'tab-navigated' }]);
  });

  test('a page on a blocked site is told there is nothing to watch', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://example.com/upload');
    await startTabMonitor({ until, timeoutMs: 60_000 }, tabId);
    expect(await monitorsForTab(tabId, 'https://mybank.com/')).toMatchObject({ ok: true, data: { monitors: [] } });
    expect(await monitorsForTab(tabId, 'https://example.com/upload')).toMatchObject({ ok: true, data: { monitors: [{}] } });
  });
});

describe('a recording', () => {
  test('cannot start on a blocked site', async () => {
    await block('mybank.com');
    const tabId = await tabOn('https://mybank.com/');
    expect(await startRecording({ tabId, url: 'https://mybank.com/', captureValues: false })).toMatchObject({
      ok: false,
      error: { code: SITE_BLOCKED },
    });
    expect(await currentRecording()).toBeNull();
  });

  test('stops before a blocked page is written into it, and ignores what that page sends', async () => {
    serveRecorder();
    await block('mybank.com');
    const tabId = await tabOn('https://example.com/');
    await startRecording({ tabId, url: 'https://example.com/', captureValues: false });

    await appendEvents(tabId, [{ t: 1, kind: 'navigate', url: 'https://example.com/elsewhere' }], 'https://mybank.com/');
    expect((await currentRecording())?.events).toBe(1);
    expect(await recordingStateFor(tabId, 'https://mybank.com/')).toEqual({ recording: false, captureValues: false });

    await fakeBrowser.tabs.update(tabId, { url: 'https://mybank.com/login' });
    await settle();
    expect(await currentRecording()).toBeNull();
  });
});
