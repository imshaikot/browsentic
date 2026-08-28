import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { FILES_INDEX_KEY, type StoredFileMeta } from './file-store';

export function useStoredFiles(): StoredFileMeta[] {
  const [files, setFiles] = useState<StoredFileMeta[]>([]);

  useEffect(() => {
    let live = true;
    void browser.storage.local.get(FILES_INDEX_KEY).then((stored) => {
      const list = stored[FILES_INDEX_KEY];
      if (live && Array.isArray(list)) setFiles(list as StoredFileMeta[]);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (FILES_INDEX_KEY in changes) {
        const next = changes[FILES_INDEX_KEY].newValue;
        setFiles(Array.isArray(next) ? (next as StoredFileMeta[]) : []);
      }
    };
    browser.storage.local.onChanged.addListener(listener);
    return () => {
      live = false;
      browser.storage.local.onChanged.removeListener(listener);
    };
  }, []);

  return files;
}
