import { browser } from 'wxt/browser';

export const CONTEXT_MENU_KEY = 'browsentic/contextMenu';
export const PANEL_ITEM = 'open-side-panel';
export const HANDS_FREE_ITEM = 'open-hands-free';

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
  speech: boolean;
  panelOpen: boolean;
  handsFree: boolean;
}

export interface MenuItem {
  id: string;
  title: string;
}

export function describeMenu({ choice, speech, panelOpen, handsFree }: MenuState): MenuItem[] {
  const panel = { id: PANEL_ITEM, title: panelOpen ? 'Close Browsentic' : 'Open Browsentic' };
  const mic = { id: HANDS_FREE_ITEM, title: handsFree ? 'Close Browsentic (Hands Free)' : 'Open Browsentic (Hands Free)' };
  return [...(choice.panel ? [panel] : []), ...(choice.handsFree && speech ? [mic] : [])];
}
