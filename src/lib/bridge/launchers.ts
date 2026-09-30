import { browser } from 'wxt/browser';
import { HANDS_FREE_SHORTCUT, PANEL_SHORTCUT } from '@/lib/settings/shortcuts';
import { CONTEXT_MENU_KEY, HANDS_FREE_ITEM, PANEL_ITEM, describeMenu, readContextMenuChoice } from './context-menu';
import { HANDS_FREE_KEY, endHandsFree, readHandsFree, startHandsFree } from './panel-view';
import { closePanels, onPanelPresence } from './run-port';
import { closeSidebar, openSidePanel } from './side-panel';
import { SPEECH_SERVICE_KEY, handsFreeSupported } from './speech-support';

let panelOpen = false;
let painting: Promise<void> = Promise.resolve();

/** One paint at a time, so a second change never lands its items between another's removeAll and creates. */
function repaintMenu(): void {
  painting = painting
    .then(paintMenu)
    .catch((error) => console.warn('[browsentic] context menu paint failed:', error));
}

async function paintMenu(): Promise<void> {
  const [choice, speech, handsFree] = await Promise.all([readContextMenuChoice(), handsFreeSupported(), readHandsFree()]);
  await browser.contextMenus.removeAll();
  describeMenu({ choice, speech, panelOpen, handsFree: handsFree !== null }).forEach((item) =>
    browser.contextMenus.create({ ...item, contexts: ['all'] }),
  );
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
  onPanelPresence((open) => {
    panelOpen = open;
    repaintMenu();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === PANEL_ITEM && tab?.windowId != null) togglePanel(tab.windowId);
    if (info.menuItemId === HANDS_FREE_ITEM) void toggleHandsFree();
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === PANEL_SHORTCUT && tab?.windowId != null) togglePanel(tab.windowId);
    if (command === HANDS_FREE_SHORTCUT) void toggleHandsFree();
  });

  browser.storage.session.onChanged.addListener((changes) => {
    const handsFree = changes[HANDS_FREE_KEY];
    if (handsFree && !handsFree.oldValue !== !handsFree.newValue) repaintMenu();
  });
  browser.storage.local.onChanged.addListener((changes) => {
    if (CONTEXT_MENU_KEY in changes || SPEECH_SERVICE_KEY in changes) repaintMenu();
  });

  repaintMenu();
}
