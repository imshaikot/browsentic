import { browser } from 'wxt/browser';
import { injectContentScript } from '@/lib/actions/client';
import {
  TOAST_CHANNEL,
  TOAST_DURATION_MS,
  isToastRequest,
  type ToastCommand,
  type ToastTone,
  type ToastView,
} from '@/lib/toast/events';
import { readTheme } from './theme';

const NO_CONTENT_SCRIPT = 'Receiving end does not exist';

export interface ToastNotice {
  toastId: string;
  tone: ToastTone;
  title: string;
  body: string;
  tabId?: number;
}

/**
 * Draws a notice on the page the user is actually looking at, falling back to the window
 * that owns `nearTabId` when the focused one cannot host it. Answers false when no page
 * would take it — a chrome:// tab, the Web Store, a window with nothing open — which is
 * the caller's cue to fall back to an OS notification.
 */
export async function showToast(notice: ToastNotice, nearTabId?: number): Promise<boolean> {
  const view: ToastView = { ...notice, theme: await readTheme(), durationMs: TOAST_DURATION_MS };
  const command: ToastCommand = { channel: TOAST_CHANNEL, op: 'show', view };
  for (const tabId of await candidates(nearTabId)) {
    if (await post(tabId, command)) return true;
  }
  return false;
}

async function candidates(nearTabId?: number): Promise<number[]> {
  const ids: number[] = [];
  const add = (id: number | undefined) => {
    if (id != null && !ids.includes(id)) ids.push(id);
  };

  const [focused] = await browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  add(focused?.id);

  if (nearTabId == null) return ids;
  const home = await browser.tabs.get(nearTabId).catch(() => null);
  if (home?.windowId == null) return ids;
  const [sibling] = await browser.tabs.query({ active: true, windowId: home.windowId }).catch(() => []);
  add(sibling?.id);
  return ids;
}

async function post(tabId: number, command: ToastCommand): Promise<boolean> {
  const send = async () =>
    ((await browser.tabs.sendMessage(tabId, command)) as { ok?: boolean } | undefined)?.ok === true;
  try {
    return await send();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(NO_CONTENT_SCRIPT)) return false;
    if (!(await injectContentScript(tabId))) return false;
    return send().catch(() => false);
  }
}

export function serveToast(): void {
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isToastRequest(message)) return;
    void goToTab(message.tabId);
    sendResponse({ ok: true });
  });
}

async function goToTab(tabId: number): Promise<void> {
  const tab = await browser.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab?.windowId == null) return;
  await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
}
