import { browser } from 'wxt/browser';
import { TASK_APPROVAL_WAIT_MS, type RunOutcome, type TaskResult } from '@/lib/schedules/task';
import type { ToastTone } from '@/lib/toast/events';
import type { TaskTag } from './tab-sessions';
import { goToTab, hideToast, showToast, showToastOn } from './toast';

const NOTIFICATION_PREFIX = 'browsentic-task:';
const DETAIL_CHARS = 90;

const OUTCOME_WORDS: Record<RunOutcome, string> = {
  ok: 'finished',
  failed: 'failed',
  cancelled: 'stopped',
  missed: 'missed',
  skipped: 'skipped',
};

export interface TaskNotice {
  tone: ToastTone;
  title: string;
  body: string;
}

export function taskNoticeFor(tag: Pick<TaskTag, 'name' | 'notify'>, result: TaskResult): TaskNotice | null {
  const ok = result.outcome === 'ok';
  if (tag.notify === 'never' || (tag.notify === 'failure' && ok)) return null;
  return {
    tone: ok ? 'live' : 'warn',
    title: ok ? tag.name : `${tag.name} ${OUTCOME_WORDS[result.outcome]}`,
    body: (ok ? result.headline : result.reason) ?? `The scheduled run ${OUTCOME_WORDS[result.outcome]}.`,
  };
}

export async function announceTask(tag: TaskTag, result: TaskResult, tabId?: number): Promise<void> {
  const notice = taskNoticeFor(tag, result);
  if (!notice) return;
  const shown = await showToast({ toastId: `task:${tag.id}:${Date.now()}`, ...notice, tabId: tag.keepTab ? tabId : undefined }, tabId);
  if (!shown) await notify(`${NOTIFICATION_PREFIX}${tag.id}`, notice.title, notice.body);
}

interface HeldApproval {
  sessionId: string;
  toolId: string;
  tabId: number;
  shownOn: number | null;
}

const approvals = new Map<string, HeldApproval>();

const toastIdFor = (toolId: string) => `approval:${toolId}`;

const clip = (text: string) => (text.length > DETAIL_CHARS ? `${text.slice(0, DETAIL_CHARS - 1)}…` : text);

export function approvalDetail(input: unknown): string | undefined {
  const args = input as { url?: unknown; target?: { text?: unknown; selector?: unknown } } | null;
  const shown = [args?.url, args?.target?.text, args?.target?.selector].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  return shown ? clip(shown.trim()) : undefined;
}

export async function askTaskApproval(request: {
  sessionId: string;
  toolId: string;
  taskName: string;
  action: string;
  input: unknown;
  site?: string;
  tabId: number;
}): Promise<void> {
  const toastId = toastIdFor(request.toolId);
  const action = request.action.replace(/^page\./, '');
  const title = `“${request.taskName}” needs your OK`;
  const shownOn = await showToastOn(
    {
      toastId,
      tone: 'warn',
      title,
      body: 'A scheduled run is waiting on this. With no answer in ten minutes, it is declined.',
      tabId: request.tabId,
      approval: {
        action,
        detail: approvalDetail(request.input),
        site: request.site,
        expiresAt: Date.now() + TASK_APPROVAL_WAIT_MS,
      },
    },
    request.tabId,
  );
  approvals.set(toastId, { sessionId: request.sessionId, toolId: request.toolId, tabId: request.tabId, shownOn });
  if (shownOn === null) {
    await notify(
      `${NOTIFICATION_PREFIX}${toastId}`,
      title,
      `${action}${request.site ? ` on ${request.site}` : ''} — open its tab and answer in the side panel.`,
    );
  }
}

/** Only the page the card was drawn on can answer it, and only once. */
export function takeApprovalAnswer(toastId: string, fromTabId: number | undefined): { sessionId: string; toolId: string } | null {
  const held = approvals.get(toastId);
  if (!held || held.shownOn === null || held.shownOn !== fromTabId) return null;
  approvals.delete(toastId);
  return { sessionId: held.sessionId, toolId: held.toolId };
}

export function dropTaskApproval(toolId: string): void {
  const toastId = toastIdFor(toolId);
  const held = approvals.get(toastId);
  approvals.delete(toastId);
  if (held?.shownOn != null) hideToast(toastId, held.shownOn);
}

export function serveTaskNotices(): void {
  browser.notifications?.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    void browser.notifications.clear(notificationId).catch(() => undefined);
    const held = approvals.get(notificationId.slice(NOTIFICATION_PREFIX.length));
    if (held) void goToTab(held.tabId);
  });
}

async function notify(id: string, title: string, message: string): Promise<void> {
  await browser.notifications?.create(id, { type: 'basic', iconUrl: largestIcon(), title, message }).catch(() => undefined);
}

function largestIcon(): string {
  const icons = browser.runtime.getManifest().icons ?? {};
  const [largest] = Object.keys(icons)
    .map(Number)
    .sort((a, b) => b - a);
  return icons[largest] ?? '';
}
