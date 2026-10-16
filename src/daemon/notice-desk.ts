/**
 * Holds the notices a browser hands over until the Browsentic app takes them. A notice is taken only
 * while an app that may show notifications is watching; otherwise the browser is told no at once and
 * shows its own card. Nothing here is written to disk: a notice is worth showing for minutes, not more.
 */

import type { DeviceNotice, QueuedNotice } from '@/lib/notices';

const KEEP_MS = 5 * 60_000;
const QUEUE_MAX = 20;
/** Which browser each recent notice came from, so a click reaches it after the app has taken the notice. */
const ROUTES_MAX = 50;

export interface NoticeDesk {
  watch(watcher: object, allowed: boolean): void;
  unwatch(watcher: object): void;
  canShow(): boolean;
  watchers(): object[];
  /** True when an app will show it. */
  offer(notice: DeviceNotice, from: { id: string; browser?: string }): boolean;
  take(): QueuedNotice[];
  /** The browser a notice came from. */
  routeOf(noticeId: string): string | undefined;
}

export function noticeDesk({ changed, now = Date.now }: { changed: () => void; now?: () => number }): NoticeDesk {
  const allowedBy = new Map<object, boolean>();
  let queue: QueuedNotice[] = [];
  const routes = new Map<string, string>();

  const canShow = () => [...allowedBy.values()].some(Boolean);

  return {
    watch: (watcher, allowed) => void allowedBy.set(watcher, allowed),
    unwatch: (watcher) => void allowedBy.delete(watcher),
    canShow,
    watchers: () => [...allowedBy.keys()],
    offer(notice, from) {
      if (!canShow()) return false;
      queue = [...queue.filter((queued) => queued.id !== notice.id), { ...notice, browser: from.browser, at: now() }].slice(-QUEUE_MAX);
      routes.delete(notice.id);
      routes.set(notice.id, from.id);
      for (const oldest of [...routes.keys()].slice(0, Math.max(0, routes.size - ROUTES_MAX))) routes.delete(oldest);
      changed();
      return true;
    },
    take() {
      const fresh = queue.filter((queued) => now() - queued.at < KEEP_MS);
      queue = [];
      return fresh;
    },
    routeOf: (noticeId) => routes.get(noticeId),
  };
}
