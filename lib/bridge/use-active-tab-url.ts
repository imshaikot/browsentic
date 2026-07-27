import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

/**
 * The URL of the tab this extension page is looking at, kept current as the user switches tabs
 * or navigates. It decides which uploaded skills apply, so the panel can show that before an
 * instruction is sent, and it rides along on the instruction itself.
 *
 * `currentWindow: true` is unambiguous here because an extension page belongs to one window —
 * this is why the tab is resolved in the page rather than in the shared background worker.
 * Reading `tab.url` needs no `tabs` permission: the manifest's host permissions cover it.
 */
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
    // Only the active tab's own navigations matter; a background tab loading is noise.
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
