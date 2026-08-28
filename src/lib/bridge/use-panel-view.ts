import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { PanelTab } from '@/lib/rail/events';
import { PANEL_COLLAPSED_KEY, PANEL_TAB_KEY } from './panel-view';

export function usePanelCollapsed(): [boolean, (collapsed: boolean) => void] {
  return useStoredLocal(PANEL_COLLAPSED_KEY, false, (value): value is boolean => typeof value === 'boolean');
}

export function usePanelTab(): [PanelTab, (tab: PanelTab) => void] {
  return useStoredLocal(PANEL_TAB_KEY, 'chat' as PanelTab, (value): value is PanelTab => typeof value === 'string');
}

function useStoredLocal<T>(
  key: string,
  fallback: T,
  accepts: (value: unknown) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    let live = true;
    void browser.storage.local.get(key).then((stored) => {
      if (live && accepts(stored[key])) setValue(stored[key] as T);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      const change = changes[key];
      if (change && accepts(change.newValue)) setValue(change.newValue);
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, [key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      void browser.storage.local.set({ [key]: next });
    },
    [key],
  );

  return [value, set];
}
