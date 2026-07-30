import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { BRIDGE_CHANNEL, type RunEvent } from '@/lib/actions/protocol';
import { SITE_MAPPER_SKILL, type SiteMapDraft } from '@/lib/skills/site-map';
import { RUN_PORT, type RunCommand, type RunMessage } from './run-port';
import { isNaming, listSessions, putSession, readTranscript, titleDueAt, type SessionFields } from './session-store';

/** How long to wait before redialling the worker after it went away. */
const RECONNECT_MS = 1_000;

/**
 * How long the transcript may sit unwritten. `text` events arrive token by token, so writing on
 * every change would be one `storage.local.set` per token. The cost of the delay is bounded: every
 * run end forces a flush, so only closing the panel mid-stream can lose anything, and only the last
 * window of it.
 */
const PERSIST_DEBOUNCE_MS = 800;

/** One rendered row of the transcript. Tool rows mutate in place as their result arrives. */
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
      /** True while the run is blocked waiting for the user to allow or deny this call. */
      awaiting?: boolean;
      /** Set when the extension took this step itself, without involving the agent. */
      source?: 'local';
    };

export interface Run {
  items: RunItem[];
  running: boolean;
  /** The conversation on screen, so the history list can mark which row is already open. */
  sessionId: string;
  send: (text: string) => void;
  cancel: () => void;
  decide: (toolId: string, allow: boolean) => void;
  /** Close out the conversation and start a fresh one. The old one stays in the session library. */
  clear: () => void;
  /** Reopen a saved conversation: its rows, its agent memory, and the page it was left on. */
  restore: (sessionId: string) => Promise<void>;
  /** A finished map waiting to be read and armed, or null. */
  draft: SiteMapDraft | null;
  /** Ask for the current site to be mapped. Explicit by design — never inferred from phrasing. */
  mapSite: () => void;
  activateMap: (exactHost?: boolean) => void;
  discardMap: () => void;
}

/** The panel's live copy of the session record it is writing. See `SessionFields`. */
type SessionState = SessionFields;

const freshSession = (): SessionState => {
  const now = Date.now();
  return { id: crypto.randomUUID(), turns: 0, createdAt: now, updatedAt: now };
};

/**
 * Live view of the agent, for an extension page. Holds a port to the background worker, which
 * owns the daemon socket — pages come and go, the connection does not.
 *
 * With `persist`, the conversation is also saved to the session library as it happens, and this
 * hook becomes the owner of its Claude Code session id — which is what lets a restored conversation
 * carry on rather than start over. Off by default: the popup fires one instruction and closes, so it
 * would only ever mint half a session, and the panel it hands over to would mint another.
 *
 * A newly mounted panel always starts a new conversation rather than adopting the last one. Closing
 * the panel mid-conversation therefore does not resume on reopen — but nothing is lost, the session
 * is one click away in the history list.
 */
export function useRun({ persist = false }: { persist?: boolean } = {}): Run {
  const [items, setItems] = useState<RunItem[]>([]);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<SiteMapDraft | null>(null);
  const port = useRef<Browser.runtime.Port | null>(null);

  // Refs, not state: the flush timer and the port listener both need the current values without
  // being re-created — and re-creating the port effect would drop the connection.
  const session = useRef<SessionState>(freshSession());
  const latestItems = useRef<RunItem[]>(items);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Mirrored as state only so switching conversations re-renders the history list's "open" mark.
  const [sessionId, setSessionId] = useState(session.current.id);

  /** Write the conversation now, cancelling any pending debounced write. */
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
        // Thrown outright once the extension context is gone (a reload or update). Keep trying:
        // this page is about to be torn down with it, and if it is not, the worker will be back.
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
        } else {
          // `session` names the Claude Code conversation this run landed in. It is not a row —
          // `reduce` passes it through — so record it here, where the session record lives.
          if (runMessage.event.kind === 'session') {
            session.current.claudeSessionId = runMessage.event.claudeSessionId ?? undefined;
          }
          setItems((previous) => reduce(previous, runMessage.event));
        }
      });

      // Chrome can tear the worker down under an open panel. Redialling is also what wakes it
      // back up, and the `active` message it answers with is how the panel re-learns whether
      // anything is still running — without this a page that lost its port keeps whatever
      // "working" state it happened to be in, with nothing able to correct it.
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

  // Debounced save of whatever is on screen. `latestItems` is updated here rather than in every
  // producer, so there is one place the flush timer and the unmount path read from.
  useEffect(() => {
    latestItems.current = items;
    if (!persist || !items.length) return;
    clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flush(), PERSIST_DEBOUNCE_MS);
  }, [items, persist, flush]);

  // Last write before this page goes away. Separate from the effect above, whose cleanup runs on
  // every keystroke and must only cancel the timer, never write.
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  /**
   * A run just ended. Refresh where the conversation is (the agent may have navigated since the
   * instruction was sent — this is the URL a restore returns to), get it on disk, then let the
   * worker name it if enough has been said since the last name.
   */
  const settle = useCallback(async () => {
    if (!persist || !latestItems.current.length) return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    if (tab?.url) {
      session.current.url = tab.url;
      session.current.host = hostOf(tab.url) ?? session.current.host;
    }
    // Before the request, not after: the worker reads the transcript back out of storage.
    await flush();
    const id = session.current.id;
    const stored = (await listSessions()).find((s) => s.id === id);
    if (!stored || isNaming(stored)) return;
    if (titleDueAt(stored.turns, stored.titledAtTurn) === null) return;
    void browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'nameSession', sessionId: id }).catch(() => {
      // The worker is down; the session is saved and usable, it just has no name yet.
    });
  }, [persist, flush]);

  // Only the falling edge — `active` also arrives on every reconnect, and re-settling on those
  // would re-query the tab and re-check the name for a conversation that has not moved.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void settle();
    wasRunning.current = running;
  }, [running, settle]);

  /** False when there was no live port to carry the command, so the caller can say so. */
  const post = useCallback((command: RunCommand): boolean => {
    const open = port.current;
    if (!open) return false;
    try {
      open.postMessage(command);
      return true;
    } catch {
      // Disconnected between the check and the send.
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
      // The stored id, so a conversation reopened from the library carries on instead of starting
      // over. Undefined until the daemon has confirmed one: an id Claude Code never created is not
      // resumable, and sending it would fail every run from here on.
      const claudeSessionId = session.current.claudeSessionId;
      const failed = () => lost('Lost the connection to the extension — that never went anywhere. Try again.');
      // Resolve the tab here rather than in the worker: this page belongs to one window, so
      // `currentWindow` is unambiguous, and the worker's one-run-at-a-time guard stays sync.
      // The id travels too — a mapping run pins itself to this tab for its whole crawl.
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
    // Save what is there before letting go of it, then mint a new conversation. The daemon is told
    // too: it keeps its own copy of the session id as a fallback for callers that send none.
    void flush().then(() => {
      session.current = freshSession();
      setSessionId(session.current.id);
    });
    setItems([]);
    post({ op: 'reset' });
  }, [post, flush]);

  const restore = useCallback(
    async (sessionId: string) => {
      // Swapping the transcript out from under a live run would leave its remaining events — and
      // its reply, mid-sentence — appending to the conversation just reopened, and saved into it.
      if (running) return;
      const meta = (await listSessions()).find((s) => s.id === sessionId);
      if (!meta) return;
      const transcript = await readTranscript(sessionId);
      await flush();

      // Only the panel-owned fields are adopted; the title and its bookkeeping stay the worker's.
      const { title: _title, titledAtTurn: _titled, namingAt: _naming, ...fields } = meta;
      session.current = fields;
      setSessionId(fields.id);
      setItems(
        transcript
          ? transcript.items
          : [{ kind: 'notice', id: nextId(), tone: 'error', text: 'That conversation’s messages are no longer stored.' }],
      );
      // Deliberately no `reset`: that would tell the daemon to forget the very conversation being
      // restored. Continuity comes from `claudeSessionId` riding along on the next instruction.

      // Put the tab back where the conversation was left. Routed through the bridge so it gets the
      // in-page-then-tabs-API fallback in `invoke.ts`, rather than reimplementing it here.
      if (meta.url && /^https?:$/.test(safeProtocol(meta.url))) {
        await browser.runtime
          .sendMessage({ channel: BRIDGE_CHANNEL, op: 'invoke', action: 'page.navigate', input: { url: meta.url } })
          .catch(() => {
            // Restoring the transcript is the point; a tab that would not move is not worth failing.
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
    // The `@` prefix is not decoration: the daemon refuses to enter mapping mode without it, so
    // an overheard phrase can never start a ten-minute crawl of the user's foreground tab.
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
    // The worker answers every cancel, one way or another (see `stopRun`), so the button never
    // has to guess. It only decides for itself when there is no port left to ask through.
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

/** The host of a URL for the session's site indication, or null when it has none to give. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** A URL's scheme, or the empty string when it does not parse — never throws at a call site. */
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
      // Name the site notes too: an uploaded skill changes what the agent does, so its being
      // in play should never be invisible.
      const overlays = event.overlays?.length ? ` + site notes: ${event.overlays.join(', ')}` : '';
      return [
        ...items,
        { kind: 'notice', id: nextId(), tone: 'info', text: `Loaded skill: ${event.skill}${overlays}` },
      ];
    }

    case 'text': {
      // Deltas append to the assistant row still being written; a tool call between two
      // paragraphs closes the first one, so the next delta starts a fresh row.
      const last = items.at(-1);
      if (last?.kind === 'assistant') {
        return [...items.slice(0, -1), { ...last, text: last.text + event.delta }];
      }
      return [...items, { kind: 'assistant', id: nextId(), text: event.delta }];
    }

    case 'tool':
      return [
        ...items,
        { kind: 'tool', id: event.toolId, action: event.action, input: event.input, source: event.source },
      ];

    case 'approval':
      return patchTool(items, event.toolId, { awaiting: true });

    case 'toolResult':
      return patchTool(items, event.toolId, { ok: event.ok, summary: event.summary, awaiting: false });

    // Bookkeeping for the session record, handled by the port listener. Nothing to draw.
    case 'session':
      return items;

    case 'done':
      // `end_turn` is the ordinary ending and needs no announcement; anything else does.
      return event.stopReason === 'end_turn'
        ? items
        : [...items, { kind: 'notice', id: nextId(), tone: 'info', text: `Stopped: ${event.stopReason}` }];

    case 'error':
      return [...items, { kind: 'notice', id: nextId(), tone: 'error', text: `${event.code}: ${event.message}` }];
  }
}

function patchTool(items: RunItem[], toolId: string, patch: Partial<Extract<RunItem, { kind: 'tool' }>>): RunItem[] {
  return items.map((item) => (item.kind === 'tool' && item.id === toolId ? { ...item, ...patch } : item));
}

// A uuid rather than a counter: rows now outlive the page that made them, so a restored transcript
// and the run that follows it are two producers of ids at once, and a counter would have the second
// one reusing the first's — patching, or replacing, a row from the conversation just reopened.
const nextId = () => crypto.randomUUID();
