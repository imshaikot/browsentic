import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

export interface ActiveTab {
  url: string;
  tabId?: number;
  windowId?: number;
  title?: string;
}

const NO_TAB: ActiveTab = { url: '' };

export function useActiveTab(): ActiveTab {
  const [tab, setTab] = useState<ActiveTab>(NO_TAB);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([found]) => {
          if (!live) return;
          setTab(
            found?.id == null
              ? NO_TAB
              : { url: found.url ?? '', tabId: found.id, windowId: found.windowId, title: found.title },
          );
        })
        .catch(() => {
          if (live) setTab(NO_TAB);
        });
    };
    refresh();

    const onActivated = () => refresh();
    const onUpdated = (_id: number, changes: { url?: string; title?: string }, updated: { active?: boolean }) => {
      if ((changes.url || changes.title) && updated.active) refresh();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      live = false;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return tab;
}

/** The tab a page is itself open in, for a page whose conversation is its own whichever tab is in front. */
export function useOwnTab(): ActiveTab {
  const [tab, setTab] = useState<ActiveTab>(NO_TAB);

  useEffect(() => {
    let live = true;
    void browser.tabs
      .getCurrent()
      .then((found) => {
        if (!live || found?.id == null) return;
        setTab({ url: found.url ?? '', tabId: found.id, windowId: found.windowId, title: found.title ?? document.title });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return tab;
}
