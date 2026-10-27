import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { ensureSessionForTab, hostOf, siteUrlOf } from './tab-sessions';

const FIREFOX_HOME = 'moz-extension://4f1c2a0e-9b7d-4c51-a3e2-0d6f5b8c9e17/newtab.html';

beforeEach(() => fakeBrowser.reset());

describe('a conversation begun on Browsentic Home in Firefox, which shows the page its own address', () => {
  test('is on no site, so the extension’s id never stands in for a host', async () => {
    const ensured = await ensureSessionForTab({ tabId: 7, windowId: 1, url: FIREFOX_HOME, title: 'New Tab' });
    expect(ensured.ok && ensured.session.host).toBeUndefined();
    expect(hostOf(FIREFOX_HOME)).toBeUndefined();
  });

  test('reaches the Bridge as nowhere in particular, which a blank tab is too', () => {
    expect(siteUrlOf(FIREFOX_HOME)).toBeUndefined();
    expect(siteUrlOf('chrome-extension://abcdefghijklmnopabcdefghijklmnop/newtab.html')).toBeUndefined();
    expect(siteUrlOf(undefined)).toBeUndefined();
  });
});

describe('a conversation on a site', () => {
  test('keeps its host and its address', () => {
    expect(hostOf('https://www.github.com/pulls')).toBe('www.github.com');
    expect(hostOf('http://localhost:5173/')).toBe('localhost:5173');
    expect(siteUrlOf('https://github.com/pulls')).toBe('https://github.com/pulls');
  });

  test('on a local file has no host, as before', () => {
    expect(hostOf('file:///Users/you/notes.html')).toBeUndefined();
  });
});

/** A fresh registry: the module caches what it read, and that cache outlives fakeBrowser.reset(). */
async function registry() {
  vi.resetModules();
  return import('./tab-sessions');
}

async function begun(tabId: number, title = `Tab ${tabId}`) {
  const sessions = await registry();
  const ensured = await sessions.ensureSessionForTab({ tabId, windowId: 1, url: `https://site${tabId}.example/`, title });
  if (!ensured.ok) throw new Error(ensured.message);
  return { ...sessions, session: ensured.session };
}

const lists = (session: { mainTabId: number; currentTabId: number; tabIds: number[]; userTabIds: number[]; openedTabIds: number[] } | null | undefined) =>
  session && {
    main: session.mainTabId,
    current: session.currentTabId,
    tabs: session.tabIds,
    user: session.userTabIds,
    opened: session.openedTabIds,
  };

describe('a conversation the user spread across tabs', () => {
  test('keeps its name from the tab it began on, and its address from the tab it is working in', async () => {
    const { ensureSessionForTab, addTabs, session } = await begun(1, 'Board');
    await addTabs(session.sessionId, [2]);
    const again = await ensureSessionForTab({ tabId: 2, url: 'https://site2.example/ticket', title: 'Ticket' });
    expect(again.ok && [again.session.title, again.session.url]).toEqual(['Board', 'https://site1.example/']);
  });

  test('works in the tab the user sent from', async () => {
    const { addTabs, focusTab, session } = await begun(1);
    await addTabs(session.sessionId, [2]);
    const focused = await focusTab(session.sessionId, { tabId: 2, url: 'https://site2.example/t' });
    expect([focused?.currentTabId, focused?.host]).toEqual([2, 'site2.example']);
  });

  test('never moves a run that is going, nor onto a tab that is not its own', async () => {
    const { addTabs, focusTab, patchSession, session } = await begun(1);
    await addTabs(session.sessionId, [2]);
    expect((await focusTab(session.sessionId, { tabId: 9 }))?.currentTabId).toBe(1);
    await patchSession(session.sessionId, { runId: 'r1' });
    expect((await focusTab(session.sessionId, { tabId: 2 }))?.currentTabId).toBe(1);
  });

  test('takes a tab the agent reached as one the user chose', async () => {
    const { adoptSubtab, addTabs, readTabSessions, session } = await begun(1);
    await adoptSubtab(session.sessionId, 2, { activate: false, opened: true });
    const outcome = await addTabs(session.sessionId, [2, 3]);
    expect([outcome?.added, lists((await readTabSessions())[session.sessionId])]).toEqual([
      [2, 3],
      { main: 1, current: 1, tabs: [1, 2, 3], user: [1, 2, 3], opened: [] },
    ]);
  });

  test('moves a tab out of an idle conversation, and hands one left with nothing back to be filed away', async () => {
    const { ensureSessionForTab, addTabs, readTabSessions, session } = await begun(1);
    const other = await ensureSessionForTab({ tabId: 2, title: 'Other' });
    const outcome = await addTabs(session.sessionId, [2]);
    const map = await readTabSessions();
    expect([outcome?.absorbed.map((s) => s.title), Object.keys(map)]).toEqual([['Other'], [session.sessionId]]);
    expect(other.ok).toBe(true);
  });

  test('leaves alone a tab another conversation is working in', async () => {
    const { ensureSessionForTab, addTabs, patchSession, session } = await begun(1);
    const other = await ensureSessionForTab({ tabId: 2 });
    if (other.ok) await patchSession(other.session.sessionId, { runId: 'busy' });
    expect((await addTabs(session.sessionId, [2]))?.refused).toEqual([{ tabId: 2, reason: 'running' }]);
  });

  test('is never put on the phone', async () => {
    const { addTabs, patchSession, session } = await begun(1);
    await patchSession(session.sessionId, { phone: { serial: 'emulator-5554' } });
    expect(await addTabs(session.sessionId, [2])).toBeNull();
  });
});

describe('taking a tab out', () => {
  test('hands the conversation to another of its tabs when it was the first', async () => {
    const { addTabs, removeTab, readTabSessions, session } = await begun(1);
    await addTabs(session.sessionId, [2]);
    expect(await removeTab(session.sessionId, 1)).toBe('removed');
    expect(lists((await readTabSessions())[session.sessionId])).toEqual({ main: 2, current: 2, tabs: [2], user: [2], opened: [] });
  });

  test('is refused for the last tab, and while a run is going', async () => {
    const { addTabs, patchSession, removeTab, session } = await begun(1);
    expect(await removeTab(session.sessionId, 1)).toBe('last');
    await addTabs(session.sessionId, [2]);
    await patchSession(session.sessionId, { runId: 'r1' });
    expect(await removeTab(session.sessionId, 2)).toBe('running');
  });
});

describe('closing a tab', () => {
  test('of a tab beside the first only shrinks the conversation, and the agent goes back to the first', async () => {
    const { addTabs, focusTab, releaseTab, session } = await begun(1);
    await addTabs(session.sessionId, [2]);
    await focusTab(session.sessionId, { tabId: 2 });
    const released = await releaseTab(2);
    expect([released.shrunk?.currentTabId, released.wasCurrent, released.closed, released.handed]).toEqual([1, true, null, null]);
  });

  test('the conversation began in hands it to the user’s next open tab', async () => {
    const { addTabs, adoptSubtab, releaseTab, session } = await begun(1);
    await adoptSubtab(session.sessionId, 2, { activate: false, opened: true });
    await addTabs(session.sessionId, [3]);
    const released = await releaseTab(1, [2, 3]);
    expect(lists(released.handed)).toEqual({ main: 3, current: 3, tabs: [2, 3], user: [3], opened: [2] });
  });

  test('with only tabs the agent opened left ends it, as it always did', async () => {
    const { adoptSubtab, releaseTab, readTabSessions, session } = await begun(1);
    await adoptSubtab(session.sessionId, 2, { activate: true, opened: true });
    const released = await releaseTab(1, [2]);
    expect([released.closed?.sessionId, Object.keys(await readTabSessions())]).toEqual([session.sessionId, []]);
  });

  test('with no heir still open ends it', async () => {
    const { addTabs, releaseTab, session } = await begun(1);
    await addTabs(session.sessionId, [3]);
    expect((await releaseTab(1, [])).closed?.sessionId).toBe(session.sessionId);
  });

  test('that a scheduled task began in ends it, whatever else it holds', async () => {
    const { addTabs, patchSession, releaseTab, session } = await begun(1);
    await addTabs(session.sessionId, [3]);
    await patchSession(session.sessionId, {
      task: { id: 't', runId: 'r', name: 'Check', keepTab: false, notify: 'always', startedAt: 0 },
    });
    expect((await releaseTab(1, [3])).closed?.sessionId).toBe(session.sessionId);
  });
});

describe('heirsOf', () => {
  test('puts the tab the agent is on first when the user chose it, then the user’s tabs, then the rest it reached', async () => {
    const { adoptSubtab, addTabs, focusTab, heirsOf, readTabSessions, session } = await begun(1);
    await addTabs(session.sessionId, [4, 5]);
    await adoptSubtab(session.sessionId, 6, { activate: false, opened: false });
    await adoptSubtab(session.sessionId, 7, { activate: false, opened: true });
    await focusTab(session.sessionId, { tabId: 5 });
    expect(heirsOf((await readTabSessions())[session.sessionId], 1)).toEqual([5, 4, 6]);
  });
});

describe('a conversation from History', () => {
  test('takes over the tabs of the idle one it replaces', async () => {
    const { addTabs, adoptSubtab, bindStoredSession, readTabSessions, session } = await begun(1);
    await addTabs(session.sessionId, [2]);
    await adoptSubtab(session.sessionId, 3, { activate: false, opened: true });
    const replaced = (await readTabSessions())[session.sessionId];
    const restored = await bindStoredSession({ sessionId: 'old', turns: 4 }, { tabId: 1 }, replaced);
    expect([lists(restored), Object.keys(await readTabSessions())]).toEqual([
      { main: 1, current: 1, tabs: [1, 2, 3], user: [1, 2], opened: [3] },
      ['old'],
    ]);
  });
});

test('a replaced tab keeps its place in every list', async () => {
  const { addTabs, readTabSessions, remapTab, session } = await begun(1);
  await addTabs(session.sessionId, [2]);
  await remapTab(2, 20);
  expect(lists((await readTabSessions())[session.sessionId])).toEqual({ main: 1, current: 1, tabs: [1, 20], user: [1, 20], opened: [] });
});
