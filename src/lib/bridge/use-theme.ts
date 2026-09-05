import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

import { asTheme, THEME_KEY, writeTheme, type ThemeId } from './theme';

export function useTheme(): [ThemeId, (theme: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>(() => asTheme(document.documentElement.dataset.theme));

  useEffect(() => {
    let live = true;
    void browser.storage.local
      .get(THEME_KEY)
      .then((stored) => live && setTheme(asTheme(stored[THEME_KEY])));

    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (THEME_KEY in changes) setTheme(asTheme(changes[THEME_KEY].newValue));
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, []);

  const select = useCallback((next: ThemeId) => {
    setTheme(next);
    void writeTheme(next);
  }, []);

  return [theme, select];
}
