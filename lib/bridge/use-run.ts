import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { screenshot } from '@/lib/actions/page/screenshot';
import { BRIDGE_CHANNEL, type RunEvent } from '@/lib/actions/protocol';
import type { MonitorState } from '@/lib/monitor/events';
import type { RecordingState } from '@/lib/recordings/events';
import { SITE_MAPPER_SKILL, type SiteMapDraft } from '@/lib/skills/site-map';
import { redactInput } from './redact';
import { RUN_PORT, type RunCommand, type RunMessage } from './run-port';
import type { ScreenshotPreview } from './screenshot-preview';
import { isNaming, listSessions, putSession, readTranscript, titleDueAt, type SessionFields } from './session-store';

const RECONNECT_MS = 1_000;

const PERSIST_DEBOUNCE_MS = 800;

export type RunItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'notice'; id: string; tone: 'info' | 'error'; text: string }
  | {
      kind: 'tool';
      id: string;
      action: string;
      input: unknown;
      summary?: string;
      ok?: boolean;
      awaiting?: boolean;
      source?: 'local' | 'external';
      preview?: ScreenshotPreview;
    };

export interface Run {
  items: RunItem[];
  running: boolean;
  sessionId: string;
  send: (text: string) => void;
  cancel: () => void;
  decide: (toolId: string, allow: boolean) => void;
  clear: () => void;
  restore: (sessionId: string) => Promise<void>;
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

type SessionState = SessionFields;

const freshSession = (): SessionState => {
  const now = Date.now();
  return { id: crypto.randomUUID(), turns: 0, createdAt: now, updatedAt: now };
};

export function useRun({ persist = false }: { persist?: boolean } = {}): Run {
  const [items, setItems] = useState<RunItem[]>([]);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<SiteMapDraft | null>(null);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [monitors, setMonitors] = useState<MonitorState[]>([]);
  const port = useRef<Browser.runtime.Port | null>(null);

  const session = useRef<SessionState>(freshSession());
  const latestItems = useRef<RunItem[]>(items);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [sessionId, setSessionId] = useState(session.current.id);

  const flush = useCallback(async () => {
    clearTimeout(flushTimer.current);
    if (!persist || !latestItems.current.length) return;
    session.current.updatedAt = Date.now();
    await putSession({ ...session.current }, latestItems.current);
  }, [persist]);

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
        if (runMessage.op === 'active') setRunning(runMessage.runId !== null);
        else if (runMessage.op === 'mapDraft') setDraft(runMessage.draft);
        else if (runMessage.op === 'mapSettled') {
          setDraft((current) => (current?.stagingId === runMessage.stagingId ? null : current));
          if (!runMessage.ok && runMessage.message) {
            setItems((previous) => [
              ...previous,
              { kind: 'notice', id: nextId(), tone: 'error', text: runMessage.message! },
            ]);
          }
        } else if (runMessage.op === 'recording') setRecording(runMessage.state);
        else if (runMessage.op === 'monitor') {
          const state = runMessage.state;
          if (state.phase === 'watching') {
            setMonitors((previous) => {
              const others = previous.filter((m) => m.monitorId !== state.monitorId);
              return [...others, state];
            });
          } else {
            setMonitors((previous) => previous.filter((m) => m.monitorId !== state.monitorId));
            const notice = monitorNotice(state);
            setItems((previous) => [...previous, { kind: 'notice', id: nextId(), ...notice }]);
          }
        } else if (runMessage.op === 'preview') {
          setItems((previous) => attachPreview(previous, runMessage.preview));
        } else {
          if (runMessage.event.kind === 'session') {
            session.current.claudeSessionId = runMessage.event.claudeSessionId ?? undefined;
          }
          setItems((previous) => reduce(previous, runMessage.event));
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
  }, []);

  useEffect(() => {
    latestItems.current = items;
    if (!persist || !items.length) return;
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flush(), PERSIST_DEBOUNCE_MS);
  }, [items, persist, flush]);

  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  const settle = useCallback(async () => {
    if (!persist || !latestItems.current.length) return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    if (tab?.url) {
      session.current.url = tab.url;
      session.current.host = hostOf(tab.url) ?? session.current.host;
    }
    await flush();
    const id = session.current.id;
    const stored = (await listSessions()).find((s) => s.id === id);
    if (!stored || isNaming(stored)) return;
    if (titleDueAt(stored.turns, stored.titledAtTurn) === null) return;
    void browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'nameSession', sessionId: id }).catch(() => {
    });
  }, [persist, flush]);

  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void settle();
    wasRunning.current = running;
  }, [running, settle]);

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

  const lost = useCallback((text: string) => {
    setRunning(false);
    setItems((previous) => [...previous, { kind: 'notice', id: nextId(), tone: 'error', text }]);
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setItems((previous) => [...previous, { kind: 'user', id: nextId(), text: trimmed }]);
      setRunning(true);
      session.current.turns += 1;
      const claudeSessionId = session.current.claudeSessionId;
      const failed = () => lost('Lost the connection to the extension — that never went anywhere. Try again.');
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => {
          if (tab?.url) {
            session.current.url = tab.url;
            session.current.host = hostOf(tab.url) ?? session.current.host;
          }
          const context = tab?.url ? { url: tab.url, tabId: tab.id, claudeSessionId } : { claudeSessionId };
          if (!post({ op: 'instruct', text: trimmed, context })) failed();
        })
        .catch(() => {
          if (!post({ op: 'instruct', text: trimmed, context: { claudeSessionId } })) failed();
        });
    },
    [post, lost],
  );

  const clear = useCallback(() => {
    void flush().then(() => {
      session.current = freshSession();
      setSessionId(session.current.id);
    });
    setItems([]);
    post({ op: 'reset' });
  }, [post, flush]);

  const restore = useCallback(
    async (sessionId: string) => {
      if (running) return;
      const meta = (await listSessions()).find((s) => s.id === sessionId);
      if (!meta) return;
      const transcript = await readTranscript(sessionId);
      await flush();

      const { title: _title, titledAtTurn: _titled, namingAt: _naming, ...fields } = meta;
      session.current = fields;
      setSessionId(fields.id);
      setItems(
        transcript
          ? transcript.items
          : [{ kind: 'notice', id: nextId(), tone: 'error', text: 'That conversation’s messages are no longer stored.' }],
      );

      if (meta.url && /^https?:$/.test(safeProtocol(meta.url))) {
        await browser.runtime
          .sendMessage({ channel: BRIDGE_CHANNEL, op: 'invoke', action: 'page.navigate', input: { url: meta.url } })
          .catch(() => {
          });
      }
    },
    [flush, running],
  );

  return {
    items,
    running,
    sessionId,
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
      if (!post({ op: 'cancel' })) lost('Lost the connection to the extension, so this run is no longer being watched.');
    }, [post, lost]),
    decide: useCallback(
      (toolId: string, allow: boolean) => {
        setItems((previous) => patchTool(previous, toolId, { awaiting: false }));
        post({ op: 'decision', toolId, allow });
      },
      [post],
    ),
    clear,
    restore,
  };
}

function monitorNotice(state: MonitorState): { tone: 'info' | 'error'; text: string } {
  const name = state.label ?? state.host;
  const elapsed = clock(state.elapsedMs);
  switch (state.phase) {
    case 'done':
      return { tone: 'info', text: `Monitor “${name}” finished after ${elapsed}.` };
    case 'stopped':
      return { tone: 'info', text: `Monitor “${name}” stopped.` };
    case 'timeout':
      return { tone: 'error', text: `Monitor “${name}” gave up after ${elapsed} without completing.` };
    case 'tab-closed':
      return { tone: 'error', text: `Monitor “${name}” ended — the tab was closed.` };
    default:
      return { tone: 'error', text: `Monitor “${name}” ended — ${state.message ?? 'the tab left the watched site.'}` };
  }
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

function reduce(items: RunItem[], event: RunEvent): RunItem[] {
  switch (event.kind) {
    case 'started': {
      const overlays = event.overlays?.length ? ` + site notes: ${event.overlays.join(', ')}` : '';
      return [
        ...items,
        { kind: 'notice', id: nextId(), tone: 'info', text: `Loaded skill: ${event.skill}${overlays}` },
      ];
    }

    case 'text': {
      const last = items.at(-1);
      if (last?.kind === 'assistant') {
        return [...items.slice(0, -1), { ...last, text: last.text + event.delta }];
      }
      return [...items, { kind: 'assistant', id: nextId(), text: event.delta }];
    }

    case 'tool':
      return [
        ...items,
        {
          kind: 'tool',
          id: event.toolId,
          action: event.action,
          input: redactInput(event.action, event.input),
          source: event.source,
        },
      ];

    case 'approval':
      return patchTool(items, event.toolId, { awaiting: true });

    case 'toolResult':
      return patchTool(items, event.toolId, { ok: event.ok, summary: event.summary, awaiting: false });

    case 'session':
      return items;

    case 'done':
      return event.stopReason === 'end_turn'
        ? items
        : [...items, { kind: 'notice', id: nextId(), tone: 'info', text: `Stopped: ${event.stopReason}` }];

    case 'error':
      return [...items, { kind: 'notice', id: nextId(), tone: 'error', text: `${event.code}: ${event.message}` }];
  }
}

function attachPreview(items: RunItem[], preview: ScreenshotPreview): RunItem[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === 'tool' && item.action === screenshot.name && !item.preview) {
      const next = [...items];
      next[i] = { ...item, preview };
      return next;
    }
  }
  return items;
}

function patchTool(items: RunItem[], toolId: string, patch: Partial<Extract<RunItem, { kind: 'tool' }>>): RunItem[] {
  return items.map((item) => (item.kind === 'tool' && item.id === toolId ? { ...item, ...patch } : item));
}

const nextId = () => crypto.randomUUID();
