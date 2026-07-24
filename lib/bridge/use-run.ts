import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import type { RunEvent } from '@/lib/actions/protocol';
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
    };

export interface Run {
  items: RunItem[];
  running: boolean;
  send: (text: string) => void;
  cancel: () => void;
  decide: (toolId: string, allow: boolean) => void;
  clear: () => void;
}

/**
 * Live view of the agent, for an extension page. Holds a port to the background worker, which
 * owns the daemon socket — pages come and go, the connection does not.
 */
export function useRun(): Run {
  const [items, setItems] = useState<RunItem[]>([]);
  const [running, setRunning] = useState(false);
  const port = useRef<Browser.runtime.Port | null>(null);

  useEffect(() => {
    const connected = browser.runtime.connect({ name: RUN_PORT });
    port.current = connected;

    connected.onMessage.addListener((message) => {
      const runMessage = message as RunMessage;
      if (runMessage.op === 'active') setRunning(runMessage.runId !== null);
      else setItems((previous) => reduce(previous, runMessage.event));
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
      post({ op: 'instruct', text: trimmed });
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
    case 'started':
      return [...items, { kind: 'notice', id: nextId(), tone: 'info', text: `Loaded skill: ${event.skill}` }];

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
      return [...items, { kind: 'tool', id: event.toolId, action: event.action, input: event.input }];

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
