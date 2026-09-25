import { browser } from 'wxt/browser';
import { injectContentScript } from '@/lib/actions/client';
import {
  TOAST_CHANNEL,
  TOAST_DURATION_MS,
  isToastRequest,
  type ToastCommand,
  type ToastApproval,
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
  approval?: ToastApproval;
}

type AnswerListener = (toastId: string, allow: boolean, remember: boolean, fromTabId: number | undefined) => void;

let answerListener: AnswerListener | null = null;

export function onToastAnswer(listener: AnswerListener): void {
  answerListener = listener;
}

/**
 * Draws a notice on the page the user is actually looking at, falling back to the window
 * that owns `nearTabId` when the focused one cannot host it. Answers false when no page
 * would take it — a chrome:// tab, the Web Store, a window with nothing open — which is
 * the caller's cue to fall back to an OS notification.
 */
export async function showToast(notice: ToastNotice, nearTabId?: number): Promise<boolean> {
  return (await showToastOn(notice, nearTabId)) !== null;
}

/** Which tab took the card, so an answer can be checked against the page it was actually drawn on. */
export async function showToastOn(notice: ToastNotice, nearTabId?: number): Promise<number | null> {
  const view: ToastView = { ...notice, theme: await readTheme(), durationMs: TOAST_DURATION_MS };
  const command: ToastCommand = { channel: TOAST_CHANNEL, op: 'show', view };
  for (const tabId of await candidates(nearTabId)) {
    if (await post(tabId, command)) return tabId;
  }
  return null;
}

export function hideToast(toastId: string, tabId: number): void {
  void post(tabId, { channel: TOAST_CHANNEL, op: 'hide', toastId });
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
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isToastRequest(message)) return;
    if (message.op === 'answer') answerListener?.(message.toastId, message.allow, message.remember === true, sender.tab?.id);
    else void goToTab(message.tabId);
    sendResponse({ ok: true });
  });
}

export async function goToTab(tabId: number): Promise<void> {
  const tab = await browser.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab?.windowId == null) return;
  await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
}
