import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import type { RunEvent } from '@/lib/actions/protocol';
import { SITE_MAPPER_SKILL, type SiteMapDraft } from '@/lib/skills/site-map';
import { RUN_PORT, type RunCommand, type RunMessage } from './run-port';

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
  send: (text: string) => void;
  cancel: () => void;
  decide: (toolId: string, allow: boolean) => void;
  clear: () => void;
  /** A finished map waiting to be read and armed, or null. */
  draft: SiteMapDraft | null;
  /** Ask for the current site to be mapped. Explicit by design — never inferred from phrasing. */
  mapSite: () => void;
  activateMap: (exactHost?: boolean) => void;
  discardMap: () => void;
}

/**
 * Live view of the agent, for an extension page. Holds a port to the background worker, which
 * owns the daemon socket — pages come and go, the connection does not.
 */
export function useRun(): Run {
  const [items, setItems] = useState<RunItem[]>([]);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<SiteMapDraft | null>(null);
  const port = useRef<Browser.runtime.Port | null>(null);

  useEffect(() => {
    const connected = browser.runtime.connect({ name: RUN_PORT });
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
      } else setItems((previous) => reduce(previous, runMessage.event));
    });
    // The worker can be torn down; a page that outlives it must not hold a dead port.
    connected.onDisconnect.addListener(() => {
      if (port.current === connected) port.current = null;
    });

    return () => {
      port.current = null;
      connected.disconnect();
    };
  }, []);

  const post = useCallback((command: RunCommand) => port.current?.postMessage(command), []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setItems((previous) => [...previous, { kind: 'user', id: nextId(), text: trimmed }]);
      setRunning(true);
      // Resolve the tab here rather than in the worker: this page belongs to one window, so
      // `currentWindow` is unambiguous, and the worker's one-run-at-a-time guard stays sync.
      // The id travels too — a mapping run pins itself to this tab for its whole crawl.
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) =>
          post({
            op: 'instruct',
            text: trimmed,
            context: tab?.url ? { url: tab.url, tabId: tab.id } : undefined,
          }),
        )
        .catch(() => post({ op: 'instruct', text: trimmed }));
    },
    [post],
  );

  const clear = useCallback(() => {
    setItems([]);
    post({ op: 'reset' });
  }, [post]);

  return {
    items,
    running,
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
    cancel: useCallback(() => post({ op: 'cancel' }), [post]),
    decide: useCallback(
      (toolId: string, allow: boolean) => {
        setItems((previous) => patchTool(previous, toolId, { awaiting: false }));
        post({ op: 'decision', toolId, allow });
      },
      [post],
    ),
    clear,
  };
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

let counter = 0;
const nextId = () => `item-${counter++}`;
