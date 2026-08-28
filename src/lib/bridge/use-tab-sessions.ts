import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { TAB_SESSIONS_KEY, type TabSession, type TabSessionMap } from './tab-sessions';

const sorted = (map: TabSessionMap | undefined): TabSession[] =>
  Object.values(map ?? {}).sort((a, b) => b.lastActivityAt - a.lastActivityAt);

export function useTabSessions(): TabSession[] {
  const [sessions, setSessions] = useState<TabSession[]>([]);

  useEffect(() => {
    let current = true;
    void browser.storage.session
      .get(TAB_SESSIONS_KEY)
      .then((stored) => current && setSessions(sorted(stored[TAB_SESSIONS_KEY] as TabSessionMap)));

    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (TAB_SESSIONS_KEY in changes) setSessions(sorted(changes[TAB_SESSIONS_KEY].newValue as TabSessionMap));
    };
    browser.storage.session.onChanged.addListener(listener);
    return () => {
      current = false;
      browser.storage.session.onChanged.removeListener(listener);
    };
  }, []);

  return sessions;
}
