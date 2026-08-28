import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { RECORDINGS_INDEX_KEY, type StoredRecordingMeta } from './recording-store';

export function useStoredRecordings(): StoredRecordingMeta[] {
  const [recordings, setRecordings] = useState<StoredRecordingMeta[]>([]);

  useEffect(() => {
    let live = true;
    void browser.storage.local.get(RECORDINGS_INDEX_KEY).then((stored) => {
      const list = stored[RECORDINGS_INDEX_KEY];
      if (live && Array.isArray(list)) setRecordings(list as StoredRecordingMeta[]);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (RECORDINGS_INDEX_KEY in changes) {
        const next = changes[RECORDINGS_INDEX_KEY].newValue;
        setRecordings(Array.isArray(next) ? (next as StoredRecordingMeta[]) : []);
      }
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, []);

  return recordings;
}
