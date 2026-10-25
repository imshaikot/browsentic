import { useEffect, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';

/** The tabs of the window the page is in, in tab-strip order, kept live: titles, icons, order and the tab strip's selection. */
export function useWindowTabs(): Browser.tabs.Tab[] {
  const [tabs, setTabs] = useState<Browser.tabs.Tab[]>([]);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void browser.tabs
        .query({ currentWindow: true })
        .then((found) => live && setTabs([...found].sort((a, b) => a.index - b.index)))
        .catch(() => undefined);
    };
    refresh();

    const onUpdated = (_id: number, change: { title?: string; url?: string; favIconUrl?: string }) => {
      if (change.title !== undefined || change.url !== undefined || change.favIconUrl !== undefined) refresh();
    };
    const { onCreated, onRemoved, onMoved, onActivated, onHighlighted, onAttached, onDetached } = browser.tabs;
    onCreated.addListener(refresh);
    onRemoved.addListener(refresh);
    onMoved.addListener(refresh);
    onActivated.addListener(refresh);
    onHighlighted.addListener(refresh);
    onAttached.addListener(refresh);
    onDetached.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      live = false;
      onCreated.removeListener(refresh);
      onRemoved.removeListener(refresh);
      onMoved.removeListener(refresh);
      onActivated.removeListener(refresh);
      onHighlighted.removeListener(refresh);
      onAttached.removeListener(refresh);
      onDetached.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return tabs;
}
