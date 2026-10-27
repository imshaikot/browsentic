import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  ADD_TAB_ITEM,
  CONTEXT_MENU_KEY,
  HANDS_FREE_ITEM,
  PANEL_ITEM,
  addTabItem,
  asContextMenuChoice,
  describeMenu,
  readContextMenuChoice,
  sessionOfItem,
} from './context-menu';
import type { TabSession } from './tab-sessions';

const both = { panel: true, handsFree: true, addTab: true };
const idle = { choice: both, speech: true, panelOpen: false, handsFree: false };

beforeEach(() => {
  fakeBrowser.reset();
});

describe('describeMenu', () => {
  it('offers the panel and hands-free where speech works', () => {
    expect(describeMenu(idle)).toEqual([
      { id: PANEL_ITEM, title: 'Open Browsentic' },
      { id: HANDS_FREE_ITEM, title: 'Open Browsentic (Hands Free)' },
    ]);
  });

  it('never offers hands-free where speech cannot work, whatever the choice', () => {
    expect(describeMenu({ ...idle, speech: false }).map(({ id }) => id)).toEqual([PANEL_ITEM]);
  });

  it('offers to close whichever surface is showing', () => {
    expect(describeMenu({ ...idle, panelOpen: true })[0].title).toBe('Close Browsentic');
    expect(describeMenu({ ...idle, handsFree: true })[1].title).toBe('Close Browsentic (Hands Free)');
  });

  it('leaves out what was switched off, down to an empty menu', () => {
    expect(describeMenu({ ...idle, choice: { ...both, panel: false } }).map(({ id }) => id)).toEqual([HANDS_FREE_ITEM]);
    expect(describeMenu({ ...idle, choice: { panel: false, handsFree: false, addTab: true } })).toEqual([]);
  });
});

describe('the stored choice', () => {
  it('has both items on until one is switched off', async () => {
    expect(await readContextMenuChoice()).toEqual(both);
    await fakeBrowser.storage.local.set({ [CONTEXT_MENU_KEY]: { panel: false } });
    expect(await readContextMenuChoice()).toEqual({ panel: false, handsFree: true, addTab: true });
  });

  it('reads anything malformed as the default', () => {
    expect(asContextMenuChoice('off')).toEqual(both);
    expect(asContextMenuChoice(null)).toEqual(both);
    expect(asContextMenuChoice({ panel: 0, handsFree: 'no' })).toEqual(both);
  });
});

describe('Add this tab to', () => {
  const conversation = (sessionId: string, patch: Partial<TabSession> = {}): TabSession => ({
    sessionId,
    mainTabId: 1,
    tabIds: [1],
    userTabIds: [1],
    openedTabIds: [],
    currentTabId: 1,
    windowId: 1,
    title: `Conversation ${sessionId}`,
    host: `${sessionId}.example`,
    runId: null,
    turns: 1,
    createdAt: 0,
    lastActivityAt: 0,
    ...patch,
  });
  const quiet = { ...idle, choice: { panel: false, handsFree: false, addTab: true } };

  it('lists the conversations on other tabs, under one item', () => {
    const sessions = [conversation('jira', { tabIds: [1, 2] }), conversation('docs', { mainTabId: 5, tabIds: [5] })];
    expect(describeMenu({ ...quiet, sessions, frontTabId: 2 })).toEqual([
      { id: ADD_TAB_ITEM, title: 'Add this tab to' },
      { id: addTabItem('docs'), parentId: ADD_TAB_ITEM, title: '“Conversation docs” · docs.example' },
    ]);
  });

  it('is not there with nowhere to add the tab, nor when switched off', () => {
    const phone = conversation('phone', { phone: { serial: 's' }, tabIds: [9] });
    expect(describeMenu({ ...quiet, sessions: [phone, conversation('own')], frontTabId: 1 })).toEqual([]);
    expect(describeMenu({ ...idle, choice: { ...both, addTab: false }, sessions: [conversation('other')], frontTabId: 7 }).map(({ id }) => id)).toEqual([
      PANEL_ITEM,
      HANDS_FREE_ITEM,
    ]);
  });

  it('names the conversation in its item id', () => {
    expect([sessionOfItem(addTabItem('abc')), sessionOfItem(PANEL_ITEM), sessionOfItem(3)]).toEqual(['abc', null, null]);
  });
});
