import type { ReactNode } from 'react';

import { GuardrailPolicy } from '@/extension/components/guardrail-policy';
import { usePreferences } from '@/lib/bridge/use-preferences';
import type { GuardrailValue } from '@/lib/settings/guardrails';

export function GuardrailSettings() {
  const { paired, connected, preferences, busy, error, reload, change } = usePreferences();
  const settings = preferences?.guardrails;

  const write = (setting: string, value: GuardrailValue) => void change({ kind: 'guardrail', setting, value }, setting);

  if (!paired) {
    return <Empty>Pair this browser to see what the agent is allowed to do. The Connection section has the steps.</Empty>;
  }
  if (!connected) {
    return <Empty>The daemon is offline. Guardrails live in its config file, so they load when it reconnects.</Empty>;
  }
  if (!settings) {
    return <Empty>{error ?? 'Reading the policy…'}</Empty>;
  }

  return <GuardrailPolicy settings={settings} busy={busy} error={error} onWrite={write} onReload={() => void reload()} />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="panel-card rounded-xl px-6 py-10 text-center text-sm leading-relaxed text-ink-faint">{children}</p>;
}
