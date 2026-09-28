import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

import { BRIDGE_CHANNEL, type ActionResult } from '@/lib/actions/protocol';
import type { PreferenceChange, Preferences } from '@/lib/settings/preferences';
import { useDaemonState } from './use-daemon-state';

type PreferenceRequest = { op: 'preferences' } | { op: 'setPreference'; change: PreferenceChange };

/**
 * The settings the daemon last pushed to this browser, and a way to change them, for a settings
 * screen. `busy` names what is in flight — `load`, or the marker a change was sent with.
 */
export function usePreferences() {
  const daemon = useDaemonState();
  const connected = daemon?.connected ?? false;
  const preferences = daemon?.preferences;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(async (request: PreferenceRequest, marker: string) => {
    setBusy(marker);
    setError(null);
    const result = (await browser.runtime
      .sendMessage({ channel: BRIDGE_CHANNEL, ...request })
      .catch(() => null)) as ActionResult<Preferences> | null;
    setBusy(null);
    if (!result?.ok) setError(result?.error.message ?? 'The daemon did not answer.');
    return result?.ok === true;
  }, []);

  useEffect(() => {
    if (connected && !preferences) void ask({ op: 'preferences' }, 'load');
  }, [connected, preferences, ask]);

  const reload = useCallback(() => ask({ op: 'preferences' }, 'load'), [ask]);
  const change = useCallback((next: PreferenceChange, marker: string) => ask({ op: 'setPreference', change: next }, marker), [ask]);

  return { paired: daemon?.paired ?? false, connected, preferences, busy, error, reload, change };
}
