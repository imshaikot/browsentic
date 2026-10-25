import { browser } from 'wxt/browser';
import type { TokenUsage } from '@/lib/actions/protocol';
import type { AgentKind } from '@/lib/agents/catalog';
import type { NotifyPolicy } from '@/lib/schedules/task';

export const TAB_SESSIONS_KEY = 'browsentic/tabSessions';

export const MAX_ACTIVE_SESSIONS = 8;

export interface PendingApproval {
  toolId: string;
  action: string;
  input: unknown;
  site?: string;
}

export interface TaskTag {
  id: string;
  runId: string;
  name: string;
  keepTab: boolean;
  notify: NotifyPolicy;
  startedAt: number;
  previous?: string;
  /** Reported to the daemon, so closing the tab afterwards is not a cancellation. */
  done?: boolean;
}

export interface TabSession {
  sessionId: string;
  mainTabId: number;
  /** Every tab the conversation spans: the main tab, the tabs the user put in it, and the tabs its runs reached. */
  tabIds: number[];
  /** The tabs the user put here themselves: the one it began on and every one they added. */
  userTabIds: number[];
  /** The tabs its runs or its task opened, the only ones a finished task closes. */
  openedTabIds: number[];
  /** Where this session's next untargeted action lands. */
  currentTabId: number;
  windowId: number;
  title: string;
  url?: string;
  host?: string;
  runId: string | null;
  agent?: AgentKind;
  agentSessionId?: string;
  /** The agent's own token counts, as of its most recent report. */
  usage?: TokenUsage;
  turns: number;
  createdAt: number;
  lastActivityAt: number;
  pendingApproval?: PendingApproval;
  /** Files whose reports the running turn carries, marked handed over once it finishes. */
  handing?: string[];
  /** Set when a schedule opened this conversation; it files to the task's runs, not History. */
  task?: TaskTag;
  /** Set when this conversation lives on the phone tab: its url and title are the phone's, and its tools act on the phone. */
  phone?: { serial: string };
}

export type TabSessionMap = Record<string, TabSession>;

export interface TabAnchor {
  tabId: number;
  url?: string;
  windowId?: number;
  title?: string;
}

let cache: TabSessionMap | null = null;
let queue: Promise<unknown> = Promise.resolve();

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export async function readTabSessions(): Promise<TabSessionMap> {
  if (cache) return cache;
  const stored = await browser.storage.session.get(TAB_SESSIONS_KEY);
  cache = (stored[TAB_SESSIONS_KEY] as TabSessionMap | undefined) ?? {};
  return cache;
}

export function mutateTabSessions<T>(change: (map: TabSessionMap) => T | Promise<T>): Promise<T> {
  return locked(async () => {
    const map = { ...(await readTabSessions()) };
    const outcome = await change(map);
    cache = map;
    await browser.storage.session.set({ [TAB_SESSIONS_KEY]: map });
    return outcome;
  });
}

export async function sessionForTab(tabId: number): Promise<TabSession | null> {
  const map = await readTabSessions();
  return Object.values(map).find((session) => session.tabIds.includes(tabId)) ?? null;
}

export async function sessionForRun(runId: string): Promise<TabSession | null> {
  const map = await readTabSessions();
  return Object.values(map).find((session) => session.runId === runId) ?? null;
}

export type Ensured = { ok: true; session: TabSession } | { ok: false; message: string };

export async function ensureSessionForTab(anchor: TabAnchor): Promise<Ensured> {
  return mutateTabSessions((map) => {
    const existing = Object.values(map).find((session) => session.tabIds.includes(anchor.tabId));
    if (existing) {
      existing.lastActivityAt = Date.now();
      if (anchor.url && anchor.tabId === existing.currentTabId) {
        existing.url = anchor.url;
        existing.host = hostOf(anchor.url) ?? existing.host;
      }
      if (anchor.title && anchor.tabId === existing.mainTabId) existing.title = anchor.title;
      return { ok: true, session: existing } as Ensured;
    }
    if (Object.keys(map).length >= MAX_ACTIVE_SESSIONS) {
      return {
        ok: false,
        message: `${MAX_ACTIVE_SESSIONS} tab sessions are already open — close one of those tabs, or end a session, before starting another.`,
      } as Ensured;
    }
    const now = Date.now();
    const session: TabSession = {
      sessionId: crypto.randomUUID(),
      mainTabId: anchor.tabId,
      tabIds: [anchor.tabId],
      userTabIds: [anchor.tabId],
      openedTabIds: [],
      currentTabId: anchor.tabId,
      windowId: anchor.windowId ?? -1,
      title: anchor.title ?? hostOf(anchor.url) ?? 'This tab',
      url: anchor.url,
      host: hostOf(anchor.url),
      runId: null,
      turns: 0,
      createdAt: now,
      lastActivityAt: now,
    };
    map[session.sessionId] = session;
    return { ok: true, session } as Ensured;
  });
}

/**
 * A conversation from History, back on the tab the user opened it on. It takes over the tabs of the
 * idle conversation it replaces there, so tabs the user gathered stay together.
 */
export function bindStoredSession(
  fields: {
    sessionId: string;
    turns: number;
    agent?: AgentKind;
    agentSessionId?: string;
    usage?: TokenUsage;
    url?: string;
    title?: string;
  },
  anchor: TabAnchor,
  replaced?: Pick<TabSession, 'tabIds' | 'userTabIds' | 'openedTabIds'> | null,
): Promise<TabSession> {
  return mutateTabSessions((map) => {
    for (const [id, session] of Object.entries(map)) {
      if (session.tabIds.includes(anchor.tabId) && !session.runId) delete map[id];
    }
    const held = new Set(Object.values(map).flatMap((session) => session.tabIds));
    const inherited = (replaced?.tabIds ?? []).filter((tabId) => tabId !== anchor.tabId && !held.has(tabId));
    const now = Date.now();
    const session: TabSession = {
      sessionId: fields.sessionId,
      mainTabId: anchor.tabId,
      tabIds: [anchor.tabId, ...inherited],
      userTabIds: [anchor.tabId, ...inherited.filter((tabId) => replaced?.userTabIds.includes(tabId))],
      openedTabIds: inherited.filter((tabId) => replaced?.openedTabIds.includes(tabId)),
      currentTabId: anchor.tabId,
      windowId: anchor.windowId ?? -1,
      title: fields.title ?? anchor.title ?? hostOf(fields.url) ?? 'This tab',
      url: fields.url ?? anchor.url,
      host: hostOf(fields.url ?? anchor.url),
      runId: null,
      agent: fields.agent,
      agentSessionId: fields.agentSessionId,
      usage: fields.usage,
      turns: fields.turns,
      createdAt: now,
      lastActivityAt: now,
    };
    map[session.sessionId] = session;
    return session;
  });
}

/** A tab one of the conversation's runs reached: `opened` when the run opened it, which makes it one a finished task closes. */
export function adoptSubtab(sessionId: string, tabId: number, { activate, opened }: { activate: boolean; opened: boolean }): Promise<void> {
  return mutateTabSessions((map) => {
    const session = map[sessionId];
    if (!session) return;
    for (const other of Object.values(map)) {
      if (other.sessionId !== sessionId && other.tabIds.includes(tabId)) leave(other, tabId, []);
    }
    if (!session.tabIds.includes(tabId)) session.tabIds.push(tabId);
    if (opened && !session.openedTabIds.includes(tabId)) session.openedTabIds.push(tabId);
    if (activate) session.currentTabId = tabId;
    session.lastActivityAt = Date.now();
  });
}

/** When the user sends from one of the conversation's tabs, that tab is the one they mean. Never while a run is going. */
export function focusTab(sessionId: string, anchor: TabAnchor): Promise<TabSession | null> {
  return mutateTabSessions((map) => {
    const session = map[sessionId];
    if (!session || session.runId || session.currentTabId === anchor.tabId || !session.tabIds.includes(anchor.tabId)) {
      return session ?? null;
    }
    session.currentTabId = anchor.tabId;
    if (anchor.url) {
      session.url = anchor.url;
      session.host = hostOf(anchor.url);
    }
    return session;
  });
}

export type AddRefusal = 'running' | 'phone' | 'task';

export interface TabsAdded {
  added: number[];
  refused: { tabId: number; reason: AddRefusal }[];
  /** Conversations left with no tab once theirs moved here, to be filed to History. */
  absorbed: TabSession[];
}

/**
 * Tabs the user put in a conversation. A tab another idle conversation holds moves here, and that
 * conversation keeps its other tabs or, left with none, is handed back to be filed away.
 */
export function addTabs(sessionId: string, tabIds: readonly number[]): Promise<TabsAdded | null> {
  return mutateTabSessions((map) => {
    const session = map[sessionId];
    if (!session || session.phone) return null;
    const outcome: TabsAdded = { added: [], refused: [], absorbed: [] };
    for (const tabId of new Set(tabIds)) {
      const holder = Object.values(map).find((other) => other.tabIds.includes(tabId));
      if (holder && holder !== session) {
        const reason = refusalOf(holder);
        if (reason) {
          outcome.refused.push({ tabId, reason });
          continue;
        }
        if (holder.tabIds.length === 1) {
          delete map[holder.sessionId];
          outcome.absorbed.push(holder);
        } else {
          leave(holder, tabId, fallbacksOf(holder, tabId));
        }
      }
      if (!session.tabIds.includes(tabId)) session.tabIds.push(tabId);
      if (!session.userTabIds.includes(tabId)) {
        session.userTabIds.push(tabId);
        outcome.added.push(tabId);
      }
      session.openedTabIds = session.openedTabIds.filter((id) => id !== tabId);
    }
    if (outcome.added.length) session.lastActivityAt = Date.now();
    return outcome;
  });
}

export type TabRemoval = 'removed' | 'running' | 'last' | 'missing';

/** The user took a tab out of a conversation. The tab stays open, with no conversation of its own. */
export function removeTab(sessionId: string, tabId: number): Promise<TabRemoval> {
  return mutateTabSessions((map) => {
    const session = map[sessionId];
    if (!session?.tabIds.includes(tabId)) return 'missing';
    if (session.runId) return 'running';
    if (session.tabIds.length === 1) return 'last';
    leave(session, tabId, fallbacksOf(session, tabId));
    session.lastActivityAt = Date.now();
    return 'removed';
  });
}

function refusalOf(session: TabSession): AddRefusal | null {
  if (session.runId) return 'running';
  if (session.phone) return 'phone';
  return session.task ? 'task' : null;
}

/**
 * Who carries the conversation on when its main tab goes: the tab the agent was on if the user put it
 * there, then the user's other tabs, then any tab the runs reached but did not open themselves.
 */
export function heirsOf(session: TabSession, leaving: number): number[] {
  const chosen = session.userTabIds.includes(session.currentTabId) ? [session.currentTabId] : [];
  const reached = session.tabIds.filter((tabId) => !session.openedTabIds.includes(tabId));
  return [...new Set([...chosen, ...session.userTabIds, ...reached])].filter(
    (tabId) => tabId !== leaving && session.tabIds.includes(tabId),
  );
}

/** Taking a tab out by hand leaves the conversation somewhere to be, its runs' own tabs included. */
const fallbacksOf = (session: TabSession, leaving: number): number[] => [
  ...heirsOf(session, leaving),
  ...session.tabIds.filter((tabId) => tabId !== leaving),
];

/** Takes a tab out of a conversation. False when the main tab left and none of `heirs` could take its place. */
function leave(session: TabSession, tabId: number, heirs: readonly number[]): boolean {
  const drop = (ids: number[]) => ids.filter((id) => id !== tabId);
  session.tabIds = drop(session.tabIds);
  session.userTabIds = drop(session.userTabIds);
  session.openedTabIds = drop(session.openedTabIds);
  if (session.mainTabId === tabId) {
    const heir = heirs.find((id) => session.tabIds.includes(id));
    if (heir === undefined) return false;
    session.mainTabId = heir;
    if (!session.userTabIds.includes(heir)) session.userTabIds.push(heir);
  }
  if (session.currentTabId === tabId) session.currentTabId = session.mainTabId;
  return true;
}

export function setCurrentTab(sessionId: string, tabId: number): Promise<void> {
  return mutateTabSessions((map) => {
    const session = map[sessionId];
    if (!session || !session.tabIds.includes(tabId)) return;
    session.currentTabId = tabId;
    session.lastActivityAt = Date.now();
  });
}

export function patchSession(sessionId: string, patch: Partial<TabSession>): Promise<void> {
  return mutateTabSessions((map) => {
    const session = map[sessionId];
    if (!session) return;
    Object.assign(session, patch, { lastActivityAt: Date.now() });
  });
}

export function dropSession(sessionId: string): Promise<TabSession | null> {
  return mutateTabSessions((map) => {
    const session = map[sessionId] ?? null;
    delete map[sessionId];
    return session;
  });
}

export interface Released {
  /** The conversation ended with its tab. */
  closed: TabSession | null;
  /** It lost one of its other tabs. */
  shrunk: TabSession | null;
  /** Its main tab went and another of the user's tabs carries it on. */
  handed: TabSession | null;
  /** The tab was the one the agent was working in. */
  wasCurrent: boolean;
}

/**
 * A closed tab leaves its conversation. When it was the main tab, the first of `alive` that is one of
 * its heirs takes over; with none, or for a task's or the phone's conversation, the conversation ends.
 */
export function releaseTab(tabId: number, alive: readonly number[] = []): Promise<Released> {
  return mutateTabSessions((map) => {
    for (const session of Object.values(map)) {
      if (!session.tabIds.includes(tabId)) continue;
      const wasCurrent = session.currentTabId === tabId;
      const main = session.mainTabId === tabId;
      const heirs = session.task || session.phone ? [] : heirsOf(session, tabId).filter((id) => alive.includes(id));
      if (!leave(session, tabId, heirs)) {
        delete map[session.sessionId];
        return { closed: session, shrunk: null, handed: null, wasCurrent };
      }
      return { closed: null, shrunk: main ? null : session, handed: main ? session : null, wasCurrent };
    }
    return { closed: null, shrunk: null, handed: null, wasCurrent: false };
  });
}

export function remapTab(from: number, to: number): Promise<void> {
  return mutateTabSessions((map) => {
    for (const session of Object.values(map)) {
      if (!session.tabIds.includes(from)) continue;
      const swap = (ids: number[]) => ids.map((id) => (id === from ? to : id));
      session.tabIds = swap(session.tabIds);
      session.userTabIds = swap(session.userTabIds);
      session.openedTabIds = swap(session.openedTabIds);
      if (session.mainTabId === from) session.mainTabId = to;
      if (session.currentTabId === from) session.currentTabId = to;
    }
  });
}

/** A site's host. Browsentic's own pages have none: Chrome hides their address, and Firefox shows the extension's id where a host would be. */
export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol, host } = new URL(url);
    return /^https?:$/.test(protocol) ? host || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** The page a turn is about, as the Bridge scopes the run: a site, or nowhere in particular, as on a blank tab. */
export const siteUrlOf = (url: string | undefined): string | undefined => (hostOf(url) ? url : undefined);
