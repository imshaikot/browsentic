import { browser, type Browser } from 'wxt/browser';
import { HANDS_FREE_SHORTCUT, PANEL_SHORTCUT } from '@/lib/settings/shortcuts';
import { CONTEXT_MENU_KEY, HANDS_FREE_ITEM, PANEL_ITEM, describeMenu, readContextMenuChoice, sessionOfItem } from './context-menu';
import { HANDS_FREE_KEY, endHandsFree, readHandsFree, startHandsFree } from './panel-view';
import { addTabsTo, closePanels, onPanelPresence } from './run-port';
import { TAB_SESSIONS_KEY, readTabSessions } from './tab-sessions';
import { closeSidebar, openPanelFromToolbar, openSidePanel, toggleSidebar } from './side-panel';
import { SPEECH_SERVICE_KEY, handsFreeSupported } from './speech-support';

let panelOpen = false;
let painting: Promise<void> = Promise.resolve();
let painted = '';

/** One paint at a time, so a second change never lands its items between another's removeAll and creates. */
function repaintMenu(): void {
  painting = painting
    .then(paintMenu)
    .catch((error) => console.warn('[browsentic] context menu paint failed:', error));
}

/** Firefox also lists it on the tab strip's own menu, where a right-click names the tab it is about. */
const ADD_CONTEXTS: NonNullable<Browser.contextMenus.CreateProperties['contexts']> = import.meta.env.FIREFOX
  ? ['all', 'tab']
  : ['all'];

async function paintMenu(): Promise<void> {
  const [choice, speech, handsFree, sessions, [front]] = await Promise.all([
    readContextMenuChoice(),
    handsFreeSupported(),
    readHandsFree(),
    readTabSessions(),
    browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []),
  ]);
  const items = describeMenu({
    choice,
    speech,
    panelOpen,
    handsFree: handsFree !== null,
    sessions: Object.values(sessions).sort((a, b) => b.lastActivityAt - a.lastActivityAt),
    frontTabId: front?.id,
  });
  const drawn = JSON.stringify(items);
  if (drawn === painted) return;
  painted = drawn;
  await browser.contextMenus.removeAll();
  items.forEach((item) =>
    browser.contextMenus.create({ ...item, contexts: item.id === PANEL_ITEM || item.id === HANDS_FREE_ITEM ? ['all'] : ADD_CONTEXTS }),
  );
}

/** The tab right-clicked, or every tab selected with it in the tab strip. */
async function tabsToAdd(tab: Browser.tabs.Tab): Promise<number[]> {
  if (!tab.highlighted || tab.windowId == null) return tab.id != null ? [tab.id] : [];
  const selected = await browser.tabs.query({ windowId: tab.windowId, highlighted: true }).catch(() => [tab]);
  return selected.flatMap((each) => (each.id != null ? [each.id] : []));
}

/** Called with a user gesture that the first await would spend, so the panel opens before anything is awaited. */
function togglePanel(windowId: number): void {
  if (!panelOpen) void openSidePanel(windowId);
  else if (import.meta.env.FIREFOX) void closeSidebar();
  else closePanels();
}

async function toggleHandsFree(): Promise<void> {
  if (await readHandsFree()) return endHandsFree();
  if (await handsFreeSupported()) await startHandsFree();
}

export function serveLaunchers(): void {
  if (import.meta.env.FIREFOX) browser.browserAction.onClicked.addListener(() => void toggleSidebar());
  else void openPanelFromToolbar().catch((error) => console.warn('[browsentic] toolbar button setup failed:', error));

  onPanelPresence((open) => {
    panelOpen = open;
    repaintMenu();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === PANEL_ITEM && tab?.windowId != null) togglePanel(tab.windowId);
    if (info.menuItemId === HANDS_FREE_ITEM) void toggleHandsFree();
    const into = sessionOfItem(info.menuItemId);
    if (into && tab) void tabsToAdd(tab).then((tabIds) => addTabsTo(into, tabIds));
  });

  browser.tabs.onActivated.addListener(() => repaintMenu());

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === PANEL_SHORTCUT && tab?.windowId != null) togglePanel(tab.windowId);
    if (command === HANDS_FREE_SHORTCUT) void toggleHandsFree();
  });

  browser.storage.session.onChanged.addListener((changes) => {
    const handsFree = changes[HANDS_FREE_KEY];
    if ((handsFree && !handsFree.oldValue !== !handsFree.newValue) || TAB_SESSIONS_KEY in changes) repaintMenu();
  });
  browser.storage.local.onChanged.addListener((changes) => {
    if (CONTEXT_MENU_KEY in changes || SPEECH_SERVICE_KEY in changes) repaintMenu();
  });

  repaintMenu();
}
