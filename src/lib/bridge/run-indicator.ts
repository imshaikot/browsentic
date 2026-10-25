import { browser } from 'wxt/browser';
import { INDICATOR_CHANNEL, INDICATOR_COLOR } from '@/lib/indicator/events';
import { syncRail } from './rail';
import { tellTab } from './tab-message';
import { readTabSessions } from './tab-sessions';

type BadgeAction = {
  setBadgeText: (details: { tabId?: number; text: string }) => Promise<void> | void;
  setBadgeBackgroundColor: (details: { tabId?: number; color: string }) => Promise<void> | void;
};

const BUSY_BADGE = '●';

const marked = new Set<number>();

/** Chrome's toolbar key is `action`; Firefox MV2 calls the same surface `browserAction`. */
function badgeAction(): BadgeAction | null {
  const api = browser as unknown as { action?: BadgeAction; browserAction?: BadgeAction };
  return (import.meta.env.FIREFOX ? api.browserAction : api.action) ?? null;
}

export async function syncRunIndicator(): Promise<void> {
  const busy = new Set<number>();
  for (const session of Object.values(await readTabSessions())) {
    if (session.runId) for (const tabId of session.tabIds) busy.add(tabId);
  }
  await Promise.all([
    ...[...busy].filter((tabId) => !marked.has(tabId)).map((tabId) => paint(tabId, true)),
    ...[...marked].filter((tabId) => !busy.has(tabId)).map((tabId) => paint(tabId, false)),
  ]);
  await syncRail();
}

export function forgetTab(tabId: number): void {
  marked.delete(tabId);
}

async function paint(tabId: number, busy: boolean): Promise<void> {
  if (busy) marked.add(tabId);
  else marked.delete(tabId);

  const action = badgeAction();
  if (action) {
    try {
      await action.setBadgeBackgroundColor({ tabId, color: INDICATOR_COLOR });
      await action.setBadgeText({ tabId, text: busy ? BUSY_BADGE : '' });
    } catch {
      marked.delete(tabId);
    }
  }

  await tellTab(tabId, { channel: INDICATOR_CHANNEL, op: busy ? 'busy' : 'idle' });
}
