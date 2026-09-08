import type { ThemeId } from '@/lib/bridge/theme';

export const TOAST_CHANNEL = 'browsentic/toast';

export const TOAST_DURATION_MS = 10_000;

export const MAX_TOASTS = 3;

export type ToastTone = 'live' | 'warn';

export interface ToastView {
  toastId: string;
  theme: ThemeId;
  tone: ToastTone;
  title: string;
  body: string;
  durationMs: number;
  /** The tab a click should land on. Absent when the tab is gone — the card is then only dismissible. */
  tabId?: number;
}

export type ToastCommand =
  | { channel: typeof TOAST_CHANNEL; op: 'show'; view: ToastView }
  | { channel: typeof TOAST_CHANNEL; op: 'hide'; toastId?: string };

export type ToastRequest = { channel: typeof TOAST_CHANNEL; op: 'activate'; tabId: number };

export function isToastCommand(message: unknown): message is ToastCommand {
  if (typeof message !== 'object' || message === null) return false;
  const frame = message as { channel?: unknown; op?: unknown };
  return frame.channel === TOAST_CHANNEL && (frame.op === 'show' || frame.op === 'hide');
}

export function isToastRequest(message: unknown): message is ToastRequest {
  if (typeof message !== 'object' || message === null) return false;
  const frame = message as { channel?: unknown; op?: unknown; tabId?: unknown };
  return frame.channel === TOAST_CHANNEL && frame.op === 'activate' && typeof frame.tabId === 'number';
}
