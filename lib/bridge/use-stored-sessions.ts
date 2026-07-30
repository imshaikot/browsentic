import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { SESSIONS_INDEX_KEY, type StoredSessionMeta } from './session-store';

export function useStoredSessions(): StoredSessionMeta[] {
  const [sessions, setSessions] = useState<StoredSessionMeta[]>([]);

  useEffect(() => {
    let live = true;
    void browser.storage.local.get(SESSIONS_INDEX_KEY).then((stored) => {
      const list = stored[SESSIONS_INDEX_KEY];
      if (live && Array.isArray(list)) setSessions(list as StoredSessionMeta[]);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (SESSIONS_INDEX_KEY in changes) {
        const next = changes[SESSIONS_INDEX_KEY].newValue;
        setSessions(Array.isArray(next) ? (next as StoredSessionMeta[]) : []);
      }
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, []);

  return sessions;
}
