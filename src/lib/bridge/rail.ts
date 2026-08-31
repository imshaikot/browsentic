import { browser } from 'wxt/browser';
import {
  RAIL_CHANNEL,
  isRailRequest,
  type RailTone,
  type RailView,
} from '@/lib/rail/events';
import { listRecordings } from './recording-store';
import { listSessions } from './session-store';
import { listSkillMeta } from './skill-store';
import { PANEL_COLLAPSED_KEY, PANEL_TAB_KEY, readPanelCollapsed, readPanelTab } from './panel-view';
import { openSidePanel } from './side-panel';
import { readTabSessions } from './tab-sessions';
import type { DaemonState } from './socket';

const DAEMON_KEY = 'browsentic/daemon';

export async function setPanelCollapsed(collapsed: boolean): Promise<void> {
  await browser.storage.local.set({ [PANEL_COLLAPSED_KEY]: collapsed });
  await syncRail();
}

let inFlight: Promise<void> | null = null;
let restated = false;
let showing: boolean | null = null;

/**
 * Paints the minimized panel onto every tab, or clears it from every tab. Broadcasting
 * rather than tracking which tabs carry it is what makes this survive the worker dying
 * mid-collapse — module state would come back empty and strand a rail on the page. The
 * first sync of a worker's life always broadcasts for that reason; only a repeated clear
 * is skipped.
 */
export function syncRail(): Promise<void> {
  if (inFlight) {
    restated = true;
    return inFlight;
  }
  inFlight = (async () => {
    do {
      restated = false;
      await paintRail();
    } while (restated);
    inFlight = null;
  })();
  return inFlight;
}

/**
 * The panel disappeared without minimizing — closed natively, so no rail should survive it.
 * Forgetting `showing` forces the hide onto every tab, including any that missed an earlier
 * broadcast. A collapsed panel is different: the rail is the panel then, and it stays.
 */
export async function clearStrandedRail(): Promise<void> {
  if (await readPanelCollapsed()) return;
  showing = null;
  await syncRail();
}

async function paintRail(): Promise<void> {
  const collapsed = await readPanelCollapsed();
  if (!collapsed && showing === false) return;

  const command = collapsed
    ? { channel: RAIL_CHANNEL, op: 'show' as const, view: await describeRail() }
    : { channel: RAIL_CHANNEL, op: 'hide' as const };

  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((tab) => post(tab.id, tab.discarded, command)));
  showing = collapsed;
}

/** A tab that has just finished loading lost its rail with the old document. */
async function paintTab(tabId: number): Promise<void> {
  if (!(await readPanelCollapsed())) return;
  await post(tabId, false, { channel: RAIL_CHANNEL, op: 'show', view: await describeRail() });
}

function post(tabId: number | undefined, discarded: boolean | undefined, command: unknown) {
  if (tabId == null || discarded) return undefined;
  return browser.tabs.sendMessage(tabId, command).catch(() => undefined);
}

async function describeRail(): Promise<RailView> {
  const [daemon, sessions, skills, recordings, tabSessions, tab, side] = await Promise.all([
    readDaemon(),
    listSessions(),
    listSkillMeta(),
    listRecordings(),
    readTabSessions(),
    readPanelTab(),
    readSide(),
  ]);

  const live = Object.values(tabSessions).filter((session) => session.runId).length;
  const status = describeTone(daemon, live > 0);

  return {
    tab,
    side,
    running: live,
    tone: status.tone,
    status: status.label,
    counts: { history: sessions.length, skills: skills.length, recordings: recordings.length },
  };
}

/** The panel's own reading, minus the parts (voice, agent readiness) the rail has no room for. */
function describeTone(daemon: DaemonState | null, running: boolean): { tone: RailTone; label: string } {
  if (!daemon?.paired) return { tone: 'off', label: 'Not paired' };
  if (!daemon.connected) return { tone: 'pending', label: 'Reconnecting' };
  if (running) return { tone: 'busy', label: 'Working' };
  return { tone: 'live', label: 'Online' };
}

async function readDaemon(): Promise<DaemonState | null> {
  const stored = await browser.storage.session.get(DAEMON_KEY);
  return (stored[DAEMON_KEY] as DaemonState | undefined) ?? null;
}

async function readSide(): Promise<'left' | 'right'> {
  if (import.meta.env.FIREFOX) return 'left';
  const api = browser.sidePanel as unknown as { getLayout?: () => Promise<{ side?: string }> };
  if (!api.getLayout) return 'right';
  try {
    const layout = await api.getLayout();
    return layout.side === 'left' ? 'left' : 'right';
  } catch {
    return 'right';
  }
}

export function serveRail(): void {
  browser.runtime.onMessage.addListener((message, sender) => {
    if (!isRailRequest(message)) return;
    const { id: tabId, windowId } = sender.tab ?? {};
    if (tabId == null || windowId == null) return;

    if (message.op === 'sync') {
      void paintTab(tabId);
      return Promise.resolve({ ok: true });
    }

    /* The click that reached us is the only user gesture the panel will get — spend it
       before any await, or `open()` rejects and the rail becomes a dead button. The rail
       is not cleared here: the panel clears it itself once it is actually up, so a refused
       open leaves the rail on screen instead of dropping the user into nothing. */
    void openSidePanel(windowId).catch(() => undefined);
    void browser.storage.local.set({ [PANEL_TAB_KEY]: message.tab });

    return Promise.resolve({ ok: true });
  });

  browser.tabs.onUpdated.addListener((tabId, changed) => {
    if (changed.status === 'complete') void paintTab(tabId);
  });
  browser.storage.local.onChanged.addListener((changes) => {
    if (PANEL_COLLAPSED_KEY in changes || PANEL_TAB_KEY in changes) void syncRail();
  });
  browser.storage.session.onChanged.addListener((changes) => {
    if (DAEMON_KEY in changes) void syncRail();
  });
}
