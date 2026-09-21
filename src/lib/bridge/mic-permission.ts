import { browser } from 'wxt/browser';

export type MicPermission = 'granted' | 'prompt' | 'denied';

const MIC_PERMISSION_PAGE = '/mic-permission.html';

function micStatus(): Promise<PermissionStatus> {
  return navigator.permissions.query({ name: 'microphone' as PermissionName });
}

export async function micPermission(): Promise<MicPermission> {
  if (import.meta.env.FIREFOX) return 'granted';
  try {
    return (await micStatus()).state;
  } catch {
    return 'granted';
  }
}

export function watchMicPermission(onChange: (state: MicPermission) => void): () => void {
  if (import.meta.env.FIREFOX) return () => {};
  let status: PermissionStatus | null = null;
  let live = true;
  const listener = () => {
    if (status) onChange(status.state);
  };
  void micStatus()
    .then((found) => {
      if (!live) return;
      status = found;
      status.addEventListener('change', listener);
    })
    .catch(() => {});
  return () => {
    live = false;
    status?.removeEventListener('change', listener);
  };
}

export function openMicPermissionPage() {
  const url = (browser.runtime.getURL as (path: string) => string)(MIC_PERMISSION_PAGE);
  return browser.tabs.create({ url });
}
