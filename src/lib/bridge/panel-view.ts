import { browser } from 'wxt/browser';
import type { PanelTab } from '@/lib/rail/events';

export const PANEL_COLLAPSED_KEY = 'browsentic/panelCollapsed';
export const PANEL_TAB_KEY = 'browsentic/panelTab';

export async function readPanelCollapsed(): Promise<boolean> {
  const stored = await browser.storage.local.get(PANEL_COLLAPSED_KEY);
  return stored[PANEL_COLLAPSED_KEY] === true;
}

/**
 * Hands-free mode, while it is on. Session storage on purpose: a browser that restarts
 * comes back with the panel, never with a microphone already listening.
 */
export const HANDS_FREE_KEY = 'browsentic/handsFree';

export interface HandsFreeState {
  muted: boolean;
  /** When it was switched on, so only the page it was switched on from plays the orb’s entrance. */
  since: number;
}

export async function readHandsFree(): Promise<HandsFreeState | null> {
  const stored = await browser.storage.session.get(HANDS_FREE_KEY);
  const state = stored[HANDS_FREE_KEY] as HandsFreeState | undefined;
  return state && typeof state.muted === 'boolean' && typeof state.since === 'number' ? state : null;
}

export function writeHandsFree(state: HandsFreeState | null): Promise<void> {
  return state
    ? browser.storage.session.set({ [HANDS_FREE_KEY]: state })
    : browser.storage.session.remove(HANDS_FREE_KEY);
}

export const startHandsFree = (): Promise<void> => writeHandsFree({ muted: false, since: Date.now() });

export const endHandsFree = (): Promise<void> => writeHandsFree(null);

export async function readPanelTab(): Promise<PanelTab> {
  const stored = await browser.storage.local.get(PANEL_TAB_KEY);
  const tab = stored[PANEL_TAB_KEY];
  return typeof tab === 'string' ? (tab as PanelTab) : 'chat';
}
