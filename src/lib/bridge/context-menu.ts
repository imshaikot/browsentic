import { browser } from 'wxt/browser';

export const CONTEXT_MENU_KEY = 'browsentic/contextMenu';
export const PANEL_ITEM = 'open-side-panel';
export const HANDS_FREE_ITEM = 'open-hands-free';

/** Which right-click items this browser shows. Both are on until switched off. */
export interface ContextMenuChoice {
  panel: boolean;
  handsFree: boolean;
}

export function asContextMenuChoice(value: unknown): ContextMenuChoice {
  const stored = (value !== null && typeof value === 'object' ? value : {}) as Partial<Record<keyof ContextMenuChoice, unknown>>;
  return { panel: stored.panel !== false, handsFree: stored.handsFree !== false };
}

export async function readContextMenuChoice(): Promise<ContextMenuChoice> {
  return asContextMenuChoice((await browser.storage.local.get(CONTEXT_MENU_KEY))[CONTEXT_MENU_KEY]);
}

export interface MenuState {
  choice: ContextMenuChoice;
  /** Whether hands-free can exist in this browser at all. */
  speech: boolean;
  panelOpen: boolean;
  handsFree: boolean;
}

export interface MenuItem {
  id: string;
  title: string;
}

/** Each item reads as what a click will do now: the one showing its surface offers to close it. */
export function describeMenu({ choice, speech, panelOpen, handsFree }: MenuState): MenuItem[] {
  const panel = { id: PANEL_ITEM, title: panelOpen ? 'Close Browsentic' : 'Open Browsentic' };
  const mic = { id: HANDS_FREE_ITEM, title: handsFree ? 'Close Browsentic (Hands Free)' : 'Open Browsentic (Hands Free)' };
  return [...(choice.panel ? [panel] : []), ...(choice.handsFree && speech ? [mic] : [])];
}
