import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import type { MonitorState } from '@/lib/monitor/events';
import type { RecordingState } from '@/lib/recordings/events';
import { SITE_MAPPER_SKILL, type SiteMapDraft } from '@/lib/skills/site-map';
import { attachPreview, notice, reduce, type RunItem } from './run-items';
import { RUN_PORT, type RunCommand, type RunMessage } from './run-port';
import { useActiveTab } from './use-active-tab';
import { useTabSessions } from './use-tab-sessions';
import type { TabSession } from './tab-sessions';

const RECONNECT_MS = 1_000;

const EXTERNAL_VIEW = 'external';

export type { RunItem };

export interface Run {
  items: RunItem[];
  running: boolean;
  sessionId: string | null;
  sessions: TabSession[];
  send: (text: string) => void;
  cancel: () => void;
  decide: (toolId: string, allow: boolean, remember?: boolean) => void;
  clear: () => void;
  restore: (sessionId: string) => Promise<void>;
  focusSession: (sessionId: string) => void;
  endSession: (sessionId: string) => void;
  draft: SiteMapDraft | null;
  mapSite: () => void;
  activateMap: (exactHost?: boolean) => void;
  discardMap: () => void;
  recording: RecordingState | null;
  startRecording: (captureValues: boolean) => void;
  stopRecording: () => void;
  monitors: MonitorState[];
  stopMonitor: (monitorId: string) => void;
}

export function useRun(): Run {
  const [draft, setDraft] = useState<SiteMapDraft | null>(null);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [monitors, setMonitors] = useState<MonitorState[]>([]);
  const [bySession, setBySession] = useState<Record<string, RunItem[]>>({});
  const port = useRef<Browser.runtime.Port | null>(null);

  const tab = useActiveTab();
  const sessions = useTabSessions();
  const displayed = useMemo(
    () => (tab.tabId == null ? null : (sessions.find((s) => s.tabIds.includes(tab.tabId!)) ?? null)),
    [sessions, tab.tabId],
  );
  const sessionId = displayed?.sessionId ?? null;

  const write = useCallback((key: string, change: (items: RunItem[]) => RunItem[]) => {
    setBySession((previous) => ({ ...previous, [key]: change(previous[key] ?? []) }));
  }, []);

  const forget = useCallback((...keys: string[]) => {
    setBySession((previous) => {
      const next = { ...previous };
      for (const key of keys) delete next[key];
      return next;
    });
  }, []);

  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (!live) return;
      let connected: Browser.runtime.Port;
      try {
        connected = browser.runtime.connect({ name: RUN_PORT });
      } catch {
        retry = setTimeout(connect, RECONNECT_MS);
        return;
      }
      port.current = connected;

      connected.onMessage.addListener((message) => {
        const runMessage = message as RunMessage;
        if (runMessage.op === 'mapDraft') setDraft(runMessage.draft);
        else if (runMessage.op === 'mapSettled') {
          setDraft((current) => (current?.stagingId === runMessage.stagingId ? null : current));
          if (!runMessage.ok && runMessage.message) {
            write(EXTERNAL_VIEW, (items) => [...items, notice('error', runMessage.message!)]);
          }
        } else if (runMessage.op === 'recording') setRecording(runMessage.state);
        else if (runMessage.op === 'monitor') {
          const state = runMessage.state;
          setMonitors((previous) => {
            const others = previous.filter((m) => m.monitorId !== state.monitorId);
            return state.phase === 'watching' ? [...others, state] : others;
          });
        } else if (runMessage.op === 'items') {
          write(runMessage.sessionId ?? EXTERNAL_VIEW, () => runMessage.items);
        } else if (runMessage.op === 'item') {
          write(runMessage.sessionId ?? EXTERNAL_VIEW, (items) => [...items, runMessage.item]);
        } else if (runMessage.op === 'preview') {
          write(runMessage.sessionId ?? EXTERNAL_VIEW, (items) => attachPreview(items, runMessage.preview));
        } else {
          write(runMessage.sessionId ?? EXTERNAL_VIEW, (items) => reduce(items, runMessage.event));
        }
      });

      connected.onDisconnect.addListener(() => {
        if (port.current === connected) port.current = null;
        if (live) retry = setTimeout(connect, RECONNECT_MS);
      });
    };

    connect();
    return () => {
      live = false;
      clearTimeout(retry);
      const open = port.current;
      port.current = null;
      open?.disconnect();
    };
  }, [write]);

  const post = useCallback((command: RunCommand): boolean => {
    const open = port.current;
    if (!open) return false;
    try {
      open.postMessage(command);
      return true;
    } catch {
      port.current = null;
      return false;
    }
  }, []);

  useEffect(() => {
    if (sessionId) post({ op: 'replay', sessionId });
  }, [sessionId, post]);

  const items = useMemo(() => {
    const own = sessionId ? (bySession[sessionId] ?? []) : [];
    const external = bySession[EXTERNAL_VIEW] ?? [];
    return external.length ? [...own, ...external] : own;
  }, [sessionId, bySession]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || tab.tabId == null) return;
      post({
        op: 'instruct',
        text: trimmed,
        tab: { tabId: tab.tabId, url: tab.url, windowId: tab.windowId, title: tab.title },
      });
    },
    [post, tab],
  );

  const focusSession = useCallback((target: string) => {
    const session = sessions.find((s) => s.sessionId === target);
    if (!session) return;
    void (async () => {
      if (session.windowId >= 0) await browser.windows.update(session.windowId, { focused: true }).catch(() => undefined);
      await browser.tabs.update(session.currentTabId, { active: true }).catch(() => undefined);
    })();
  }, [sessions]);

  const restore = useCallback(
    async (target: string) => {
      if (tab.tabId == null) return;
      const live = sessions.find((s) => s.sessionId === target);
      if (live) return focusSession(target);
      post({
        op: 'restore',
        sessionId: target,
        tab: { tabId: tab.tabId, url: tab.url, windowId: tab.windowId, title: tab.title },
      });
    },
    [post, sessions, tab, focusSession],
  );

  return {
    items,
    running: displayed?.runId != null,
    sessionId,
    sessions,
    send,
    draft,
    mapSite: useCallback(() => send(`@${SITE_MAPPER_SKILL} map this site`), [send]),
    activateMap: useCallback(
      (exactHost?: boolean) => {
        if (draft) post({ op: 'activateMap', stagingId: draft.stagingId, exactHost });
      },
      [draft, post],
    ),
    discardMap: useCallback(() => {
      if (draft) post({ op: 'discardMap', stagingId: draft.stagingId });
    }, [draft, post]),
    recording,
    startRecording: useCallback(
      (captureValues: boolean) => {
        post({ op: 'startRecording', captureValues });
      },
      [post],
    ),
    stopRecording: useCallback(() => {
      post({ op: 'stopRecording' });
    }, [post]),
    monitors,
    stopMonitor: useCallback(
      (monitorId: string) => {
        post({ op: 'stopMonitor', monitorId });
      },
      [post],
    ),
    cancel: useCallback(() => {
      if (sessionId) post({ op: 'cancel', sessionId });
    }, [post, sessionId]),
    decide: useCallback(
      (toolId: string, allow: boolean, remember?: boolean) => {
        if (sessionId) post({ op: 'decision', sessionId, toolId, allow, remember });
      },
      [post, sessionId],
    ),
    clear: useCallback(() => {
      if (!sessionId) return;
      forget(sessionId, EXTERNAL_VIEW);
      post({ op: 'endSession', sessionId });
    }, [post, sessionId, forget]),
    endSession: useCallback(
      (target: string) => {
        forget(target);
        post({ op: 'endSession', sessionId: target });
      },
      [post, forget],
    ),
    restore,
    focusSession,
  };
}
