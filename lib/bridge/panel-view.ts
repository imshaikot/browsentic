import { browser } from 'wxt/browser';
import type { PanelTab } from '@/lib/rail/events';

export const PANEL_COLLAPSED_KEY = 'browsentic/panelCollapsed';
export const PANEL_TAB_KEY = 'browsentic/panelTab';

export async function readPanelCollapsed(): Promise<boolean> {
  const stored = await browser.storage.local.get(PANEL_COLLAPSED_KEY);
  return stored[PANEL_COLLAPSED_KEY] === true;
}

export async function readPanelTab(): Promise<PanelTab> {
  const stored = await browser.storage.local.get(PANEL_TAB_KEY);
  const tab = stored[PANEL_TAB_KEY];
  return typeof tab === 'string' ? (tab as PanelTab) : 'chat';
}
