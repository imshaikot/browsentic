import { useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Ban, Check, CircleCheck, Pencil, Plus, X } from 'lucide-react';

import { SettingsGroup } from '@/extension/components/extension-settings';
import { Button } from '@/extension/components/ui/button';
import { Input } from '@/extension/components/ui/input';
import { useBlockedSites } from '@/lib/bridge/use-extension-settings';
import {
  BLOCKED_SITES_LIMITS,
  blockedBy,
  compileBlockedSites,
  describePattern,
  parseBlockedPattern,
} from '@/lib/settings/blocked-sites';
import { cn } from '@/lib/utils';

const EXAMPLES: [pattern: string, blocks: string][] = [
  ['mybank.com', 'the whole site, every subdomain and every page'],
  ['mail.example.com', 'that subdomain and anything below it'],
  ['example.com/admin', '/admin and everything under it — not /administrator'],
  ['github.com/*/settings', '* stands for anything, slashes included'],
  ['shop.*', 'the same name on any domain ending'],
  ['localhost:3000', 'one port; with no port, every port'],
];

type Admitted = { ok: true; pattern: string } | { ok: false; reason: string };

function admit(entry: string, patterns: readonly string[], replacing?: number): Admitted {
  const parsed = parseBlockedPattern(entry);
  if (!parsed.ok) return parsed;
  const clash = patterns.findIndex((pattern, index) => index !== replacing && pattern === parsed.pattern);
  if (clash !== -1) return { ok: false, reason: `${parsed.pattern} is already on the list.` };
  if (replacing === undefined && patterns.length >= BLOCKED_SITES_LIMITS.entries) {
    return { ok: false, reason: `The list holds up to ${BLOCKED_SITES_LIMITS.entries} patterns.` };
  }
  return { ok: true, pattern: parsed.pattern };
}

export function BlockedSitesSettings() {
  const [patterns, setPatterns] = useBlockedSites();

  return (
    <div className="space-y-8">
      <SettingsGroup
        title="Blocked"
        note="Every page that matches is off-limits: nothing is read, clicked, typed, screenshotted, recorded or watched there, and its tabs never show up in the agent’s tab list."
      >
        <AddPattern patterns={patterns} onAdd={(pattern) => setPatterns([...patterns, pattern])} />
        {patterns.length ? (
          patterns.map((pattern, index) => (
            <PatternRow
              key={pattern}
              pattern={pattern}
              admit={(entry) => admit(entry, patterns, index)}
              onSave={(next) => setPatterns(patterns.map((existing, at) => (at === index ? next : existing)))}
              onRemove={() => setPatterns(patterns.filter((_, at) => at !== index))}
            />
          ))
        ) : (
          <p className="px-4 py-6 text-center text-sm text-ink-faint">Nothing is blocked yet.</p>
        )}
      </SettingsGroup>

      <SettingsGroup title="Check a page" note="Paste an address to see whether Browsentic would act on it.">
        <Tester patterns={patterns} />
      </SettingsGroup>

      <SettingsGroup title="Writing a pattern">
        <dl className="divide-y divide-line">
          {EXAMPLES.map(([pattern, blocks]) => (
            <div key={pattern} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5">
              <dt className="w-44 shrink-0 font-mono text-xs text-ink">{pattern}</dt>
              <dd className="min-w-0 flex-1 text-xs leading-relaxed text-ink-dim">{blocks}</dd>
            </div>
          ))}
        </dl>
      </SettingsGroup>

      <p className="text-xs leading-relaxed text-ink-faint">
        Kept in this browser only and checked inside the extension before any page action runs, whoever asked for it — a
        side-panel run, an MCP client, a schedule, an instant command or a saved tool. The daemon, the agent and the desktop
        app can neither read this list nor change it. A site’s IP address or another of its domains is a different site and
        needs its own pattern.
      </p>
    </div>
  );
}

function AddPattern({ patterns, onAdd }: { patterns: readonly string[]; onAdd: (pattern: string) => void }) {
  const [entry, setEntry] = useState('');
  const [reason, setReason] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const admitted = admit(entry, patterns);
    if (!admitted.ok) {
      setReason(admitted.reason);
      return;
    }
    onAdd(admitted.pattern);
    setEntry('');
    setReason(null);
  }

  return (
    <form onSubmit={submit} className="space-y-1.5 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Site or pattern to block"
          placeholder="mybank.com, example.com/admin, github.com/*/settings"
          className="font-mono text-xs"
          value={entry}
          maxLength={BLOCKED_SITES_LIMITS.length}
          spellCheck={false}
          autoCapitalize="off"
          aria-invalid={Boolean(reason)}
          onChange={(event) => {
            setEntry(event.target.value);
            setReason(null);
          }}
        />
        <Button type="submit" size="sm" disabled={!entry.trim()}>
          <Plus /> Block
        </Button>
      </div>
      {reason && <p className="text-xs text-destructive">{reason}</p>}
    </form>
  );
}

function PatternRow({
  pattern,
  admit: check,
  onSave,
  onRemove,
}: {
  pattern: string;
  admit: (entry: string) => Admitted;
  onSave: (pattern: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  function save() {
    if (draft === null) return;
    const admitted = check(draft);
    if (!admitted.ok) {
      setReason(admitted.reason);
      return;
    }
    if (admitted.pattern !== pattern) onSave(admitted.pattern);
    setDraft(null);
    setReason(null);
  }

  function cancel() {
    setDraft(null);
    setReason(null);
  }

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      cancel();
    }
  }

  if (draft !== null) {
    return (
      <div className="space-y-1.5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Edit ${pattern}`}
            className="font-mono text-xs"
            value={draft}
            maxLength={BLOCKED_SITES_LIMITS.length}
            spellCheck={false}
            autoCapitalize="off"
            autoFocus
            aria-invalid={Boolean(reason)}
            onChange={(event) => {
              setDraft(event.target.value);
              setReason(null);
            }}
            onKeyDown={keys}
          />
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Save" onClick={save}>
            <Check />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={cancel}>
            <X />
          </Button>
        </div>
        {reason && <p className="text-xs text-destructive">{reason}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Ban className="size-3.5 shrink-0 text-amber" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs text-ink">{pattern}</p>
        <p className="mt-0.5 truncate text-[11px] text-ink-faint">{describePattern(pattern)}</p>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${pattern}`} onClick={() => setDraft(pattern)}>
        <Pencil />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Unblock ${pattern}`} onClick={onRemove}>
        <X />
      </Button>
    </div>
  );
}

function Tester({ patterns }: { patterns: readonly string[] }) {
  const [address, setAddress] = useState('');
  const compiled = useMemo(() => compileBlockedSites(patterns) ?? [], [patterns]);
  const url = asWebAddress(address);
  const match = url ? blockedBy(url, compiled) : null;

  return (
    <div className="space-y-2 px-4 py-3.5">
      <Input
        aria-label="Address to check"
        placeholder="https://www.example.com/admin/users"
        className="font-mono text-xs"
        value={address}
        spellCheck={false}
        autoCapitalize="off"
        onChange={(event) => setAddress(event.target.value)}
      />
      {address.trim() && (
        <p className={cn('flex items-center gap-1.5 text-xs', !url ? 'text-ink-faint' : match ? 'text-amber' : 'text-brand')}>
          {!url ? (
            'That is not a web address.'
          ) : match ? (
            <>
              <Ban className="size-3.5" /> Blocked by <span className="font-mono">{match}</span>
            </>
          ) : (
            <>
              <CircleCheck className="size-3.5" /> Not blocked — Browsentic can act here.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function asWebAddress(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^/]+:\d/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
