import type { ThemeId } from '@/lib/bridge/theme';

export const TOAST_CHANNEL = 'browsentic/toast';

export const TOAST_DURATION_MS = 10_000;

export const MAX_TOASTS = 3;

export type ToastTone = 'live' | 'warn';

export const APPROVAL_ARMED_AFTER_MS = 800;

export interface ToastApproval {
  /** The page tool's short name, as the side panel's approval card shows it. */
  action: string;
  detail?: string;
  site?: string;
  expiresAt: number;
}

export interface ToastView {
  toastId: string;
  theme: ThemeId;
  tone: ToastTone;
  title: string;
  body: string;
  durationMs: number;
  /** The tab a click should land on. Absent when the tab is gone — the card is then only dismissible. */
  tabId?: number;
  /** Turns the card into an approval: it stays until answered or expired, and its buttons answer the run. */
  approval?: ToastApproval;
}

export type ToastCommand =
  | { channel: typeof TOAST_CHANNEL; op: 'show'; view: ToastView }
  | { channel: typeof TOAST_CHANNEL; op: 'hide'; toastId?: string };

export type ToastRequest =
  | { channel: typeof TOAST_CHANNEL; op: 'activate'; tabId: number }
  | { channel: typeof TOAST_CHANNEL; op: 'answer'; toastId: string; allow: boolean; remember: boolean };

export function isToastCommand(message: unknown): message is ToastCommand {
  if (typeof message !== 'object' || message === null) return false;
  const frame = message as { channel?: unknown; op?: unknown };
  return frame.channel === TOAST_CHANNEL && (frame.op === 'show' || frame.op === 'hide');
}

export function isToastRequest(message: unknown): message is ToastRequest {
  if (typeof message !== 'object' || message === null) return false;
  const frame = message as { channel?: unknown; op?: unknown; tabId?: unknown; toastId?: unknown; allow?: unknown };
  if (frame.channel !== TOAST_CHANNEL) return false;
  if (frame.op === 'activate') return typeof frame.tabId === 'number';
  return frame.op === 'answer' && typeof frame.toastId === 'string' && typeof frame.allow === 'boolean';
}
