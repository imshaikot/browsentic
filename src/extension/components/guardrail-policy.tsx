import type { ReactNode } from 'react';
import { Loader2, Lock, RefreshCw, ShieldCheck } from 'lucide-react';

import { Switch } from '@/extension/components/ui/switch';
import {
  EFFECT_LABEL,
  FENCE_SETTING,
  UNATTENDED_SETTING,
  type GuardrailSettings as Policy,
  type GuardrailToggle,
  type GuardrailValue,
  type RuleEffect,
} from '@/lib/settings/guardrails';
import { cn } from '@/lib/utils';

const EFFECTS: RuleEffect[] = ['allow', 'confirm', 'deny'];

export function GuardrailPolicy({
  settings,
  busy,
  error,
  onWrite: write,
  onReload,
}: {
  settings: Policy;
  busy: string | null;
  error: string | null;
  onWrite: (setting: string, value: GuardrailValue) => void;
  onReload: () => void;
}) {
  const editable = settings.rules.filter((rule) => !rule.locked);
  const locked = settings.rules.filter((rule) => rule.locked);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span>
          Overrides are written to <span className="font-mono text-ink-dim">{settings.configPath}</span>
        </span>
        <button
          type="button"
          onClick={onReload}
          disabled={busy !== null}
          className="ml-auto flex items-center gap-1 font-mono text-[10px] tracking-[0.14em] uppercase transition-colors hover:text-brand disabled:opacity-40"
        >
          <RefreshCw className={cn('size-3', busy === 'load' && 'animate-spin')} /> Reload
        </button>
      </div>

      {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      <Group title="Rules" note="Each row starts on the default Browsentic ships. Switch one on to choose Allow, Ask or Block for it.">
        {editable.map((rule) => (
          <RuleRow key={rule.id} rule={rule} busy={busy === rule.id} onWrite={write} />
        ))}
      </Group>

      <Group title="Everything else">
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
        {settings.hosts.length > 0 && (
          <Fact title="Standing host allowlist" note="Added to every run’s scope. Edited in config.json.">
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed break-all text-ink-dim">{settings.hosts.join(' · ')}</p>
          </Fact>
        )}
      </Group>

      <Group title="Not switches" note="Shown so you know they are there. Hand-editing config.json still works, for whoever genuinely means it.">
        <Fact
          icon={<ShieldCheck className="size-3.5 text-brand" />}
          title="Credential sealing"
          badge="Always on"
          note="Passwords, keys, tokens and cookies are replaced by a placeholder before a result leaves the browser. It is what keeps a plaintext credential off the socket in the first place."
        />
        {locked.map((rule) => (
          <Fact
            key={rule.id}
            icon={<Lock className="size-3 text-ink-faint" />}
            title={rule.title}
            badge={EFFECT_LABEL[rule.fallback]}
            note={rule.reason}
          />
        ))}
      </Group>
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

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <header className="space-y-1">
        <h3 className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">{title}</h3>
        {note && <p className="text-xs leading-relaxed text-ink-faint">{note}</p>}
      </header>
      <div className="panel-card divide-y divide-line overflow-hidden rounded-xl">{children}</div>
    </section>
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
  children?: ReactNode;
}) {
  return (
    <div className={cn('flex gap-6 px-4 py-3.5 transition-colors', on && 'bg-brand/5')}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{note}</p>
        {children}
      </div>
      <div className="flex shrink-0 items-start gap-2.5 pt-0.5">
        <span className={cn('font-mono text-[10px] tracking-[0.1em] uppercase', on ? 'text-brand' : 'text-ink-faint')}>
          {state}
        </span>
        {busy ? (
          <Loader2 className="size-4 animate-spin text-ink-faint" />
        ) : (
          <Switch checked={on} label={`Override ${title}`} onChange={onToggle} />
        )}
      </div>
    </div>
  );
}

function Fact({
  icon,
  title,
  badge,
  note,
  children,
}: {
  icon?: ReactNode;
  title: string;
  badge?: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-ink-dim">{title}</span>
        {badge && <span className="ml-auto font-mono text-[10px] tracking-[0.1em] text-ink-faint uppercase">{badge}</span>}
      </div>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-faint">{note}</p>
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
    <div className="mt-2.5 inline-flex gap-0.5 rounded-lg border border-line bg-ground-2 p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onSelect(option.value)}
          aria-pressed={option.value === value}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            option.value === value ? 'bg-brand/20 text-brand' : 'text-ink-faint hover:text-ink-dim',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
