import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { syncRunIndicator } from './run-indicator';
import { TAB_REPLY_MS } from './tab-message';
import { mutateTabSessions } from './tab-sessions';

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('syncRunIndicator', () => {
  it('settles while a tab never answers, so the run queue behind it keeps moving', async () => {
    const tab = await fakeBrowser.tabs.create({ url: 'https://example.com/' });
    const frozen = await fakeBrowser.tabs.create({ url: 'https://example.org/' });
    vi.spyOn(fakeBrowser.tabs, 'sendMessage').mockReturnValue(new Promise(() => undefined));
    await mutateTabSessions((map) => {
      map.running = {
        sessionId: 'running',
        mainTabId: tab.id!,
        tabIds: [tab.id!, frozen.id!],
        currentTabId: tab.id!,
        windowId: -1,
        title: 'Example',
        runId: 'run',
        turns: 1,
        createdAt: 0,
        lastActivityAt: 0,
      };
    });

    let settled = false;
    void syncRunIndicator().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10 * TAB_REPLY_MS);

    expect(settled).toBe(true);
  });
});
