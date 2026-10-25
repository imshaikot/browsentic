import { browser } from 'wxt/browser';
import type { TabSession } from './tab-sessions';

export const CONTEXT_MENU_KEY = 'browsentic/contextMenu';
export const PANEL_ITEM = 'open-side-panel';
export const HANDS_FREE_ITEM = 'open-hands-free';
export const ADD_TAB_ITEM = 'add-tab-to';

const MAX_MENU_TITLE = 48;

export interface ContextMenuChoice {
  panel: boolean;
  handsFree: boolean;
  addTab: boolean;
}

export function asContextMenuChoice(value: unknown): ContextMenuChoice {
  const stored = (value !== null && typeof value === 'object' ? value : {}) as Partial<Record<keyof ContextMenuChoice, unknown>>;
  return { panel: stored.panel !== false, handsFree: stored.handsFree !== false, addTab: stored.addTab !== false };
}

export async function readContextMenuChoice(): Promise<ContextMenuChoice> {
  return asContextMenuChoice((await browser.storage.local.get(CONTEXT_MENU_KEY))[CONTEXT_MENU_KEY]);
}

export interface MenuState {
  choice: ContextMenuChoice;
  speech: boolean;
  panelOpen: boolean;
  handsFree: boolean;
  /** The live conversations, and the tab in front, for “Add this tab to”. */
  sessions?: readonly TabSession[];
  frontTabId?: number;
}

export interface MenuItem {
  id: string;
  title: string;
  parentId?: string;
}

export function describeMenu({ choice, speech, panelOpen, handsFree, sessions = [], frontTabId }: MenuState): MenuItem[] {
  const panel = { id: PANEL_ITEM, title: panelOpen ? 'Close Browsentic' : 'Open Browsentic' };
  const mic = { id: HANDS_FREE_ITEM, title: handsFree ? 'Close Browsentic (Hands Free)' : 'Open Browsentic (Hands Free)' };
  const into = choice.addTab ? sessions.filter((session) => addable(session, frontTabId)) : [];
  return [
    ...(choice.panel ? [panel] : []),
    ...(choice.handsFree && speech ? [mic] : []),
    ...(into.length
      ? [
          { id: ADD_TAB_ITEM, title: 'Add this tab to' },
          ...into.map((session) => ({ id: addTabItem(session.sessionId), parentId: ADD_TAB_ITEM, title: menuTitleOf(session) })),
        ]
      : []),
  ];
}

/** A conversation the tab in front could join: on this computer's browser, not a schedule's, and not already holding it. */
const addable = (session: TabSession, frontTabId: number | undefined) =>
  !session.phone && !session.task && (frontTabId === undefined || !session.tabIds.includes(frontTabId));

export const addTabItem = (sessionId: string) => `${ADD_TAB_ITEM}:${sessionId}`;

export function sessionOfItem(itemId: string | number): string | null {
  const prefix = `${ADD_TAB_ITEM}:`;
  return typeof itemId === 'string' && itemId.startsWith(prefix) ? itemId.slice(prefix.length) : null;
}

function menuTitleOf(session: TabSession): string {
  const title = session.title.length > MAX_MENU_TITLE ? `${session.title.slice(0, MAX_MENU_TITLE - 1)}…` : session.title;
  return session.host && session.host !== session.title ? `“${title}” · ${session.host}` : `“${title}”`;
}
