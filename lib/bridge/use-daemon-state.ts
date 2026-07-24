import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { DAEMON_STATE_KEY, type DaemonState } from './socket';

/** Live view of the background worker's link to the MCP daemon, for extension pages. */
export function useDaemonState(): DaemonState | null {
  const [state, setState] = useState<DaemonState | null>(null);

  useEffect(() => {
    let current = true;
    void browser.storage.session
      .get(DAEMON_STATE_KEY)
      .then((stored) => current && setState((stored[DAEMON_STATE_KEY] as DaemonState) ?? null));

    const listener = (changes: Record<string, { newValue?: unknown }>) => {
      if (DAEMON_STATE_KEY in changes) setState((changes[DAEMON_STATE_KEY].newValue as DaemonState) ?? null);
    };
    browser.storage.session.onChanged.addListener(listener);
    return () => {
      current = false;
      browser.storage.session.onChanged.removeListener(listener);
    };
  }, []);

  return state;
}
