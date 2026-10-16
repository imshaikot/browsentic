import { useCallback, useEffect } from 'react';
import { browser } from 'wxt/browser';
import { BRIDGE_CHANNEL, type ActionResult } from '@/lib/actions/protocol';
import type { DaemonState } from './socket';

const BETWEEN_WAITS_MS = 3_000;
/** Each ask starts the native host; after this the background's own minute alarm keeps asking. */
const WAIT_AT_MOST_MS = 10 * 60_000;

const ask = (options: { gesture?: boolean; wait?: boolean } = {}) =>
  browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'autoPair', ...options }) as Promise<ActionResult>;

/**
 * While a page that shows the link is open and this browser is not paired, it asks to pair whenever
 * the page comes into view, and holds the ask open while someone decides in the app or a terminal, so
 * the page connects the moment they allow it. `connect` is the click that lets a disconnected or
 * turned-down browser try again.
 */
export function useAutoPair(daemon: DaemonState | null): { connect: () => Promise<void> } {
  const unpaired = !!daemon && !daemon.paired;
  const waiting = unpaired && !!daemon?.pairing?.wait;

  useEffect(() => {
    if (!unpaired) return;
    const inView = () => {
      if (document.visibilityState === 'visible') void ask().catch(() => undefined);
    };
    inView();
    document.addEventListener('visibilitychange', inView);
    return () => document.removeEventListener('visibilitychange', inView);
  }, [unpaired]);

  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const until = Date.now() + WAIT_AT_MOST_MS;
    void (async () => {
      while (live && Date.now() < until) {
        await ask({ wait: true }).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, BETWEEN_WAITS_MS));
      }
    })();
    return () => {
      live = false;
    };
  }, [waiting]);

  const connect = useCallback(async () => {
    await ask({ gesture: true }).catch(() => undefined);
  }, []);

  return { connect };
}
