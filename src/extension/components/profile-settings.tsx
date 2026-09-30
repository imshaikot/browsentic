import { useState, type ReactNode } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';

import { Empty } from '@/extension/components/guardrail-settings';
import { Button } from '@/extension/components/ui/button';
import { Input } from '@/extension/components/ui/input';
import { Textarea } from '@/extension/components/ui/textarea';
import { usePreferences } from '@/lib/bridge/use-preferences';
import {
  normalizeProfile,
  PROFILE_FIELDS,
  PROFILE_LIMITS,
  sameProfile,
  type ProfileDetail,
  type ProfileField,
  type ProfileFieldId,
  type UserProfile,
} from '@/lib/settings/profile';
import { cn } from '@/lib/utils';

const GROUPS: { title: string; fields: ProfileFieldId[] }[] = [
  { title: 'You', fields: ['givenName', 'familyName', 'email', 'phone'] },
  { title: 'Address', fields: ['street', 'city', 'region', 'postalCode', 'country'] },
  { title: 'Work', fields: ['company', 'jobTitle'] },
];

const FIELD = Object.fromEntries(PROFILE_FIELDS.map((field) => [field.id, field])) as Record<ProfileFieldId, ProfileField>;

const MARKER = 'profile';

export function ProfileSettings() {
  const { paired, connected, preferences, busy, error, change } = usePreferences();
  const [draft, setDraft] = useState<UserProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const stored = preferences?.profile;

  if (!paired) {
    return <Empty>Pair this browser to give the agent your details. The Connection section has the steps.</Empty>;
  }
  if (!connected) {
    return <Empty>The daemon is offline. Your profile lives in its profile.json, so it loads when it reconnects.</Empty>;
  }
  if (!stored) {
    return <Empty>{error ?? 'Reading your profile…'}</Empty>;
  }

  const profile = draft ?? stored;
  const dirty = draft !== null && !sameProfile(draft, stored);
  const unlabelled = profile.details.some((detail) => detail.value.trim() && !detail.label.trim());
  const saving = busy === MARKER;

  const edit = (next: UserProfile) => {
    setSaved(false);
    setDraft(next);
  };
  const setField = (id: ProfileFieldId, value: string) => edit({ ...profile, fields: { ...profile.fields, [id]: value } });
  const setDetail = (index: number, next: ProfileDetail) =>
    edit({ ...profile, details: profile.details.map((detail, at) => (at === index ? next : detail)) });

  const save = async () => {
    if (!draft) return;
    if (await change({ kind: 'profile', profile: normalizeProfile(draft) }, MARKER)) {
      setDraft(null);
      setSaved(true);
    }
  };

  return (
    <form
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {GROUPS.map(({ title, fields }) => (
        <Group key={title} title={title}>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {fields.map((id) => {
              const { label, autocomplete, type = 'text', multiline } = FIELD[id];
              const common = {
                value: profile.fields[id] ?? '',
                autoComplete: autocomplete,
                maxLength: PROFILE_LIMITS.value,
                disabled: saving,
              };
              return (
                <Field key={id} label={label} wide={multiline}>
                  {multiline ? (
                    <Textarea rows={2} {...common} onChange={(event) => setField(id, event.target.value)} />
                  ) : (
                    <Input type={type} {...common} onChange={(event) => setField(id, event.target.value)} />
                  )}
                </Field>
              );
            })}
          </div>
        </Group>
      ))}

      <Group title="More details" note="Anything else a site might ask for — a loyalty number, a date of birth, a delivery note. Give each one a label the agent can match to a form field.">
        <div className="space-y-2.5 p-4">
          {profile.details.map((detail, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label="Label"
                placeholder="Label"
                className="w-36 shrink-0 sm:w-44"
                value={detail.label}
                maxLength={PROFILE_LIMITS.label}
                disabled={saving}
                aria-invalid={Boolean(detail.value.trim() && !detail.label.trim())}
                onChange={(event) => setDetail(index, { ...detail, label: event.target.value })}
              />
              <Input
                aria-label={detail.label.trim() || 'Value'}
                placeholder="Value"
                value={detail.value}
                maxLength={PROFILE_LIMITS.value}
                disabled={saving}
                onChange={(event) => setDetail(index, { ...detail, value: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${detail.label.trim() || 'this detail'}`}
                disabled={saving}
                onClick={() => edit({ ...profile, details: profile.details.filter((_, at) => at !== index) })}
              >
                <X />
              </Button>
            </div>
          ))}
          {profile.details.length < PROFILE_LIMITS.details && (
            <Button
              type="button"
              variant="subtle"
              size="sm"
              disabled={saving}
              onClick={() => edit({ ...profile, details: [...profile.details, { label: '', value: '' }] })}
            >
              <Plus /> Add a detail
            </Button>
          )}
        </div>
      </Group>

      <Group
        title="Instructions"
        note="Rules the agent keeps on every task, as firmly as its own. They cannot switch off Browsentic’s guardrails or skip an approval."
      >
        <div className="space-y-1.5 p-4">
          <Textarea
            aria-label="Instructions"
            className="min-h-28"
            placeholder={'Reply in British English.\nAlways choose the cheapest shipping.\nNever sign up for newsletters or accept optional cookies.'}
            value={profile.instructions}
            maxLength={PROFILE_LIMITS.instructions}
            disabled={saving}
            onChange={(event) => edit({ ...profile, instructions: event.target.value })}
          />
          <p className="text-right font-mono text-[10px] tracking-[0.1em] text-ink-faint">
            {profile.instructions.length} / {PROFILE_LIMITS.instructions}
          </p>
        </div>
      </Group>

      <p className="text-xs leading-relaxed text-ink-faint">
        Everything filled in here goes to the agent’s model with every side-panel run and scheduled task, so it uses these exact
        values instead of guessing. It is kept on this computer, in <span className="font-mono text-ink-dim">profile.json</span>{' '}
        beside the daemon’s config. Leave out passwords and card numbers — Browsentic seals those in the browser and never hands
        them to a model.
      </p>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ground-2/90 px-4 py-3 backdrop-blur">
        <p className={cn('min-w-0 flex-1 text-xs leading-relaxed', error ? 'text-destructive' : 'text-ink-faint')}>
          {error ??
            (unlabelled ? (
              'Give each detail a label before saving.'
            ) : dirty ? (
              'Unsaved changes.'
            ) : saved ? (
              <span className="inline-flex items-center gap-1.5 text-brand">
                <Check className="size-3.5" /> Saved. The next run uses it.
              </span>
            ) : (
              'Up to date.'
            ))}
        </p>
        <Button type="button" variant="ghost" size="sm" disabled={!draft || saving} onClick={() => setDraft(null)}>
          Discard
        </Button>
        <Button type="submit" size="sm" disabled={!dirty || unlabelled || saving}>
          {saving && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <header className="space-y-1">
        <h3 className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">{title}</h3>
        {note && <p className="text-xs leading-relaxed text-ink-faint">{note}</p>}
      </header>
      <div className="panel-card overflow-hidden rounded-xl">{children}</div>
    </section>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={cn('block space-y-1.5', wide && 'sm:col-span-2')}>
      <span className="text-xs font-medium text-ink-dim">{label}</span>
      {children}
    </label>
  );
}
