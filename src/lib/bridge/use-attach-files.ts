import { useCallback } from 'react';
import { MAX_STORED_FILE_BYTES } from '@/lib/files/report';
import { putBytes, type NewFile } from './file-store';

/**
 * Stores each file's bytes, then gives it to the conversation. A file over the cap is handed
 * over by name and size only, so the analyst can say why it was not read.
 */
export function useAttachFiles(
  attach: (file: NewFile) => void,
  onError: (message: string | null) => void,
): (files: File[]) => Promise<void> {
  return useCallback(
    async (files: File[]) => {
      onError(null);
      for (const file of files) {
        const stored = { id: crypto.randomUUID(), name: file.name, mime: file.type || 'application/octet-stream', size: file.size };
        if (file.size <= MAX_STORED_FILE_BYTES) {
          try {
            await putBytes({ id: stored.id, name: stored.name, mime: stored.mime, content: await readAsBase64(file) });
          } catch (error) {
            onError(`Couldn’t store “${file.name}”: ${error instanceof Error ? error.message : String(error)}`);
            continue;
          }
        }
        attach(stored);
      }
    },
    [attach, onError],
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(typeof result === 'string' ? result.slice(result.indexOf(',') + 1) : '');
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}
