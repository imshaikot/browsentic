import { useCallback, useEffect, useState } from 'react';
import { Loader2, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { browser } from 'wxt/browser';

import { Switch } from '@/extension/components/ui/switch';
import { BRIDGE_CHANNEL, type ActionResult } from '@/lib/actions/protocol';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import {
  EFFECT_LABEL,
  FENCE_SETTING,
  UNATTENDED_SETTING,
  type GuardrailSettings,
  type GuardrailToggle,
  type GuardrailValue,
  type RuleEffect,
} from '@/lib/settings/guardrails';
import { cn } from '@/lib/utils';

const EFFECTS: RuleEffect[] = ['allow', 'confirm', 'deny'];

export function SettingsPanel() {
  const daemon = useDaemonState();
  const connected = daemon?.connected ?? false;
  const [settings, setSettings] = useState<GuardrailSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(async (request: object, marker: string) => {
    setBusy(marker);
    setError(null);
    const result = (await browser.runtime
      .sendMessage({ channel: BRIDGE_CHANNEL, ...request })
      .catch(() => null)) as ActionResult<GuardrailSettings> | null;
    setBusy(null);
    if (result?.ok) setSettings(result.data);
    else setError(result?.error.message ?? 'The daemon did not answer.');
  }, []);

  useEffect(() => {
    if (connected) void ask({ op: 'guardrails' }, 'load');
  }, [connected, ask]);

  const write = (setting: string, value: GuardrailValue) =>
    void ask({ op: 'setGuardrail', setting, value }, setting);

  if (!daemon?.paired) {
    return <Empty>Pair a browser to see what this agent is allowed to do.</Empty>;
  }
  if (!connected) {
    return <Empty>The daemon is offline. Settings live in its config file, so they load when it reconnects.</Empty>;
  }
  if (!settings) {
    return <Empty>{error ?? 'Reading the policy…'}</Empty>;
  }

  return (
    <div className="space-y-5 px-3 pb-6">
      <header className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">Guardrails</h2>
          <button
            type="button"
            onClick={() => void ask({ op: 'guardrails' }, 'load')}
            disabled={busy !== null}
            className="flex items-center gap-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase transition-colors hover:text-brand disabled:opacity-40"
          >
            <RefreshCw className={cn('size-3', busy === 'load' && 'animate-spin')} /> Reload
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          A row left off uses the default Browsentic ships. Turning one on writes an override to{' '}
          <span className="font-mono text-[10px] text-ink-dim">{settings.configPath}</span> and nothing else. A run
          takes its policy when it starts, so a change here applies to the next one.
        </p>
      </header>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <section className="space-y-1.5">
        {settings.rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} busy={busy === rule.id} onWrite={write} />
        ))}
      </section>

      <section className="space-y-1.5">
        <h3 className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">Everything else</h3>

        <Row
          title="Fence page text"
          note="Wraps every page result in a marker telling the model it is reading data, never instructions."
          state={settings.fence.overridden ? (settings.fence.enabled ? 'On' : 'Off') : 'On (default)'}
          on={settings.fence.overridden}
          busy={busy === FENCE_SETTING}
          onToggle={(next) => write(FENCE_SETTING, next ? settings.fence.enabled : null)}
        >
          {settings.fence.overridden && (
            <Segmented
              options={[
                { value: true, label: 'Fence' },
                { value: false, label: 'Do not fence' },
              ]}
              value={settings.fence.enabled}
              onSelect={(next) => write(FENCE_SETTING, next)}
            />
          )}
        </Row>

        <Row
          title="Callers with nobody to ask"
          note="An MCP client outside the side panel cannot answer a prompt. This is what its “Ask” decisions become."
          state={settings.unattended.overridden ? EFFECT_LABEL[settings.unattended.effect] : 'Block (default)'}
          on={settings.unattended.overridden}
          busy={busy === UNATTENDED_SETTING}
          onToggle={(next) => write(UNATTENDED_SETTING, next ? settings.unattended.effect : null)}
        >
          {settings.unattended.overridden && (
            <Segmented
              options={[
                { value: 'deny', label: 'Block' },
                { value: 'allow', label: 'Allow' },
              ]}
              value={settings.unattended.effect}
              onSelect={(next) => write(UNATTENDED_SETTING, next)}
            />
          )}
        </Row>

        <div className="rounded-md border border-line bg-surface/30 px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-3 text-brand" />
            <span className="text-[11px] font-medium text-ink">Credential sealing</span>
            <span className="ml-auto font-mono text-[9px] tracking-[0.1em] text-brand uppercase">Always on</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
            Passwords, keys, tokens and cookies are replaced by a placeholder before a result leaves the browser.
            There is no switch: it is what keeps a plaintext credential off the socket in the first place.
          </p>
        </div>

        {settings.hosts.length > 0 && (
          <div className="rounded-md border border-line bg-surface/30 px-2.5 py-2">
            <span className="text-[11px] font-medium text-ink">Standing host allowlist</span>
            <p className="mt-1 font-mono text-[10px] leading-relaxed break-all text-ink-dim">
              {settings.hosts.join(' · ')}
            </p>
            <p className="mt-1 text-[11px] text-ink-faint">Added to every run’s scope. Edited in config.json.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function RuleRow({
  rule,
  busy,
  onWrite,
}: {
  rule: GuardrailToggle;
  busy: boolean;
  onWrite: (setting: string, value: GuardrailValue) => void;
}) {
  if (rule.locked) {
    return (
      <div className="rounded-md border border-line bg-surface/20 px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-ink-dim">{rule.title}</span>
          <span className="ml-auto flex items-center gap-1 font-mono text-[9px] tracking-[0.1em] text-ink-faint uppercase">
            <Lock className="size-2.5" />
            {EFFECT_LABEL[rule.fallback]}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{rule.reason}</p>
      </div>
    );
  }

  const effect = rule.override ?? rule.fallback;
  return (
    <Row
      title={rule.title}
      note={rule.reason}
      state={rule.override ? EFFECT_LABEL[rule.override] : `${EFFECT_LABEL[rule.fallback]} (default)`}
      on={rule.override !== undefined}
      busy={busy}
      onToggle={(next) => onWrite(rule.id, next ? effect : null)}
    >
      {rule.override !== undefined && (
        <Segmented
          options={EFFECTS.map((value) => ({ value, label: EFFECT_LABEL[value] }))}
          value={rule.override}
          onSelect={(next) => onWrite(rule.id, next)}
        />
      )}
    </Row>
  );
}

function Row({
  title,
  note,
  state,
  on,
  busy,
  onToggle,
  children,
}: {
  title: string;
  note: string;
  state: string;
  on: boolean;
  busy: boolean;
  onToggle: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-md border px-2.5 py-2 transition-colors', on ? 'border-brand/30 bg-brand/5' : 'border-line bg-surface/20')}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-ink">{title}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-[0.1em] text-ink-faint uppercase">{state}</span>
          {busy ? (
            <Loader2 className="size-3 animate-spin text-ink-faint" />
          ) : (
            <Switch checked={on} label={`Override ${title}`} onChange={onToggle} />
          )}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{note}</p>
      {children}
    </div>
  );
}

function Segmented<T extends string | boolean>({
  options,
  value,
  onSelect,
}: {
  options: { value: T; label: string }[];
  value: T;
  onSelect: (next: T) => void;
}) {
  return (
    <div className="mt-2 flex gap-1">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onSelect(option.value)}
          aria-pressed={option.value === value}
          className={cn(
            'flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors',
            option.value === value ? 'bg-brand/20 text-brand' : 'bg-surface text-ink-faint hover:text-ink-dim',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-[11px] leading-relaxed text-ink-faint">{children}</p>;
}
