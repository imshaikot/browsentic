import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';

import { GuardrailPolicy } from '@/extension/components/guardrail-policy';
import { BRIDGE_CHANNEL, type ActionResult } from '@/lib/actions/protocol';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import type { GuardrailValue } from '@/lib/settings/guardrails';
import type { PreferenceChange, Preferences } from '@/lib/settings/preferences';

export function GuardrailSettings() {
  const daemon = useDaemonState();
  const connected = daemon?.connected ?? false;
  const settings = daemon?.preferences?.guardrails;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(async (request: { op: 'preferences' } | { op: 'setPreference'; change: PreferenceChange }, marker: string) => {
    setBusy(marker);
    setError(null);
    const result = (await browser.runtime
      .sendMessage({ channel: BRIDGE_CHANNEL, ...request })
      .catch(() => null)) as ActionResult<Preferences> | null;
    setBusy(null);
    if (!result?.ok) setError(result?.error.message ?? 'The daemon did not answer.');
  }, []);

  useEffect(() => {
    if (connected && !settings) void ask({ op: 'preferences' }, 'load');
  }, [connected, settings, ask]);

  const write = (setting: string, value: GuardrailValue) =>
    void ask({ op: 'setPreference', change: { kind: 'guardrail', setting, value } }, setting);

  if (!daemon?.paired) {
    return <Empty>Pair this browser to see what the agent is allowed to do. The Connection section has the steps.</Empty>;
  }
  if (!connected) {
    return <Empty>The daemon is offline. Guardrails live in its config file, so they load when it reconnects.</Empty>;
  }
  if (!settings) {
    return <Empty>{error ?? 'Reading the policy…'}</Empty>;
  }

  return (
    <GuardrailPolicy
      settings={settings}
      busy={busy}
      error={error}
      onWrite={write}
      onReload={() => void ask({ op: 'preferences' }, 'load')}
    />
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="panel-card rounded-xl px-6 py-10 text-center text-sm leading-relaxed text-ink-faint">{children}</p>;
}
