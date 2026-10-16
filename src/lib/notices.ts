/**
 * Notices the browser hands to the Browsentic app, which shows them as the computer's own notifications
 * while the browser is behind other windows or minimized. The browser keeps its own card and its own
 * notification for everything else: no app, notifications not allowed, or the browser in front.
 */

/** The first protocol with `notice`, `noticeAck` and `openNotice`. */
export const NOTICE_PROTOCOL = 24;

export type NoticeKind = 'monitor' | 'task' | 'timer';

export type NoticeTone = 'live' | 'warn';

export interface DeviceNotice {
  /** Stable for one event, so the app replaces rather than stacks a repeat. */
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  tone: NoticeTone;
}

export interface QueuedNotice extends DeviceNotice {
  /** The browser it came from, as the app lists it. */
  browser?: string;
  at: number;
}

const TITLE_MAX = 120;
const BODY_MAX = 400;
const KINDS: readonly NoticeKind[] = ['monitor', 'task', 'timer'];

export function asDeviceNotice(value: unknown): DeviceNotice | null {
  const notice = value as Partial<Record<keyof DeviceNotice, unknown>> | null;
  if (!notice || typeof notice.id !== 'string' || !notice.id || notice.id.length > 120) return null;
  if (typeof notice.title !== 'string' || typeof notice.body !== 'string') return null;
  if (!KINDS.includes(notice.kind as NoticeKind)) return null;
  return {
    id: notice.id,
    kind: notice.kind as NoticeKind,
    title: notice.title.slice(0, TITLE_MAX),
    body: notice.body.slice(0, BODY_MAX),
    tone: notice.tone === 'warn' ? 'warn' : 'live',
  };
}
