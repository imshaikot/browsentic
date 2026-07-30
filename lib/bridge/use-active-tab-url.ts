import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

export function useActiveTabUrl(): string {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => {
          if (live) setUrl(tab?.url ?? '');
        })
        .catch(() => {
          if (live) setUrl('');
        });
    };
    refresh();

    const onActivated = () => refresh();
    const onUpdated = (_id: number, changes: { url?: string }, tab: { active?: boolean }) => {
      if (changes.url && tab.active) refresh();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      live = false;
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return url;
}
