import { browser } from 'wxt/browser';
import type { AgentKind } from '@/lib/agents/catalog';

export const TAB_SESSIONS_KEY = 'browsentic/tabSessions';

export const MAX_ACTIVE_SESSIONS = 8;

export interface PendingApproval {
  toolId: string;
  action: string;
  input: unknown;
  site?: string;
}

export interface TabSession {
  sessionId: string;
  mainTabId: number;
  /** The main tab plus every tab this session's runs opened. */
  tabIds: number[];
  /** Where this session's next untargeted action lands. */
  currentTabId: number;
  windowId: number;
  title: string;
  url?: string;
  host?: string;
  runId: string | null;
  agent?: AgentKind;
  agentSessionId?: string;
  turns: number;
  createdAt: number;
  lastActivityAt: number;
  pendingApproval?: PendingApproval;
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
      if (anchor.url) {
        existing.url = anchor.url;
        existing.host = hostOf(anchor.url) ?? existing.host;
      }
      if (anchor.title) existing.title = anchor.title;
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

export function bindStoredSession(
  fields: { sessionId: string; turns: number; agent?: AgentKind; agentSessionId?: string; url?: string; title?: string },
  anchor: TabAnchor,
): Promise<TabSession> {
  return mutateTabSessions((map) => {
    for (const [id, session] of Object.entries(map)) {
      if (session.tabIds.includes(anchor.tabId) && !session.runId) delete map[id];
    }
    const now = Date.now();
    const session: TabSession = {
      sessionId: fields.sessionId,
      mainTabId: anchor.tabId,
      tabIds: [anchor.tabId],
      currentTabId: anchor.tabId,
      windowId: anchor.windowId ?? -1,
      title: fields.title ?? anchor.title ?? hostOf(fields.url) ?? 'This tab',
      url: fields.url ?? anchor.url,
      host: hostOf(fields.url ?? anchor.url),
      runId: null,
      agent: fields.agent,
      agentSessionId: fields.agentSessionId,
      turns: fields.turns,
      createdAt: now,
      lastActivityAt: now,
    };
    map[session.sessionId] = session;
    return session;
  });
}

export function adoptSubtab(sessionId: string, tabId: number, activate: boolean): Promise<void> {
  return mutateTabSessions((map) => {
    const session = map[sessionId];
    if (!session) return;
    for (const other of Object.values(map)) {
      if (other.sessionId === sessionId) continue;
      other.tabIds = other.tabIds.filter((id) => id !== tabId);
    }
    if (!session.tabIds.includes(tabId)) session.tabIds.push(tabId);
    if (activate) session.currentTabId = tabId;
    session.lastActivityAt = Date.now();
  });
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

export function releaseTab(tabId: number): Promise<{ closed: TabSession | null; shrunk: TabSession | null }> {
  return mutateTabSessions((map) => {
    for (const session of Object.values(map)) {
      if (!session.tabIds.includes(tabId)) continue;
      if (session.mainTabId === tabId) {
        delete map[session.sessionId];
        return { closed: session, shrunk: null };
      }
      session.tabIds = session.tabIds.filter((id) => id !== tabId);
      if (session.currentTabId === tabId) session.currentTabId = session.mainTabId;
      return { closed: null, shrunk: session };
    }
    return { closed: null, shrunk: null };
  });
}

export function remapTab(from: number, to: number): Promise<void> {
  return mutateTabSessions((map) => {
    for (const session of Object.values(map)) {
      if (!session.tabIds.includes(from)) continue;
      session.tabIds = session.tabIds.map((id) => (id === from ? to : id));
      if (session.mainTabId === from) session.mainTabId = to;
      if (session.currentTabId === from) session.currentTabId = to;
    }
  });
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}
