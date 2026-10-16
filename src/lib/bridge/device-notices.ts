import { browser } from 'wxt/browser';
import type { DeviceNotice } from '@/lib/notices';
import { onOpenNotice, sendNotice } from './socket';
import { goToTab } from './toast';

/** Which tab each notice the app is showing belongs to, so a click brings that tab forward. */
const NOTICE_TABS_KEY = 'browsentic/noticeTabs';
const NOTICE_TABS_MAX = 30;

/** A card on a page only helps while someone is looking at the browser: some window focused and not minimized. */
export async function browserInFront(): Promise<boolean> {
  const windows = await browser.windows.getAll({ windowTypes: ['normal'] }).catch(() => []);
  return windows.some((window) => window.focused && window.state !== 'minimized');
}

/**
 * Shows the notice as the computer's own notification, through the Browsentic app, when the browser is
 * behind or minimized and the app may post one. False leaves the caller to its card or the browser's
 * notification, which is everything else: the browser in front, no app, notifications not allowed, or a
 * Bridge from before this.
 */
export async function noticeOnDevice(notice: DeviceNotice, tabId?: number): Promise<boolean> {
  if (await browserInFront()) return false;
  if (!(await sendNotice(notice))) return false;
  if (tabId != null) await rememberTab(notice.id, tabId);
  return true;
}

async function noticeTabs(): Promise<Record<string, number>> {
  return ((await browser.storage.session.get(NOTICE_TABS_KEY))[NOTICE_TABS_KEY] as Record<string, number> | undefined) ?? {};
}

async function rememberTab(noticeId: string, tabId: number): Promise<void> {
  const kept = Object.entries({ ...(await noticeTabs()), [noticeId]: tabId }).slice(-NOTICE_TABS_MAX);
  await browser.storage.session.set({ [NOTICE_TABS_KEY]: Object.fromEntries(kept) });
}

/** Focus alone leaves a minimized window in the Dock or the taskbar, so it is restored first. */
async function restore(windowId: number): Promise<void> {
  const window = await browser.windows.get(windowId).catch(() => null);
  if (window?.state === 'minimized') await browser.windows.update(windowId, { state: 'normal' }).catch(() => undefined);
  await browser.windows.update(windowId, { focused: true }).catch(() => undefined);
}

async function bringForward(noticeId: string): Promise<void> {
  const tabId = (await noticeTabs())[noticeId];
  const tab = tabId != null ? await browser.tabs.get(tabId).catch(() => null) : null;
  const [first] = await browser.windows.getAll({ windowTypes: ['normal'] }).catch(() => []);
  const windowId = tab?.windowId ?? first?.id;
  if (windowId != null) await restore(windowId);
  if (tab?.id != null) await goToTab(tab.id);
}

export function serveDeviceNotices(): void {
  onOpenNotice((noticeId) => void bringForward(noticeId));
}
