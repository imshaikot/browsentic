import { useRef, useState } from 'react';
import { BookOpen, Check, Compass, Globe, Loader2, Upload, X } from 'lucide-react';
import { browser } from 'wxt/browser';

import { BRIDGE_CHANNEL } from '@/lib/actions/protocol';
import { Badge } from '@/extension/components/ui/badge';
import { Button } from '@/extension/components/ui/button';
import { Input } from '@/extension/components/ui/input';
import { putSkill, type StoredSkillMeta } from '@/lib/bridge/skill-store';
import { useStoredSkills } from '@/lib/bridge/use-stored-skills';
import {
  draftFromFile,
  hostMatchesDomains,
  hostnameOf,
  normalizeDomain,
  validateSkillDraft,
  type SkillDraft,
} from '@/lib/skills/format';
import { cn } from '@/lib/utils';

export function SkillsPanel({
  tabUrl,
  connected,
  onMapSite,
  mapping,
}: {
  tabUrl: string;
  connected: boolean;
  onMapSite: () => void;
  mapping: boolean;
}) {
  const skills = useStoredSkills();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [domainText, setDomainText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const host = hostnameOf(tabUrl);
  const mappable = connected && !mapping && /^https?:/.test(tabUrl);
  const alreadyMapped = skills.some(
    (skill) => skill.origin === 'generated' && hostMatchesDomains(host, skill.domains),
  );

  async function onPickFile() {
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const parsed = draftFromFile(await file.text(), file.name);
    setDraft(parsed);
    setDomainText(parsed.domains.join(', '));
    setError(null);
  }

  async function onSave() {
    if (!draft) return;
    const domains = domainText.split(',').map(normalizeDomain).filter(Boolean);
    const checked = validateSkillDraft({ ...draft, domains });
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    const skill = checked.draft;
    const id = crypto.randomUUID();
    const meta: StoredSkillMeta = {
      id,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      domains: skill.domains,
      status: 'pending',
      addedAt: Date.now(),
    };
    await putSkill(meta, { id, body: skill.body, triggers: skill.triggers });
    await browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'saveSkill', skillId: id });
    setDraft(null);
    setError(null);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      <p className="text-[11px] leading-relaxed text-ink-dim">
        Notes about a site — where things are, how its lists load — that join the agent’s instructions only while you
        are on that site. Let the agent write them for you, or upload your own markdown.
      </p>

      {!draft && (
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            onClick={onMapSite}
            disabled={!mappable}
            title={mappable ? `Map ${host}` : 'Open an http(s) page, with no run in progress'}
          >
            {mapping ? <Loader2 className="animate-spin" /> : <Compass />}
            <span className="truncate">{alreadyMapped ? 'Re-map' : 'Map'} this site</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload /> Upload notes
          </Button>
        </div>
      )}

      {draft ? (
        <SkillForm
          draft={draft}
          domainText={domainText}
          error={error}
          connected={connected}
          onChange={(patch) => {
            setDraft({ ...draft, ...patch });
            setError(null);
          }}
          onDomainText={(value) => {
            setDomainText(value);
            setError(null);
          }}
          onCancel={() => {
            setDraft(null);
            setError(null);
          }}
          onSave={() => void onSave()}
        />
      ) : (
        <SkillList skills={skills} host={host} />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown"
        className="hidden"
        onChange={() => void onPickFile()}
      />
    </div>
  );
}

function SkillForm({
  draft,
  domainText,
  error,
  connected,
  onChange,
  onDomainText,
  onCancel,
  onSave,
}: {
  draft: SkillDraft;
  domainText: string;
  error: string | null;
  connected: boolean;
  onChange: (patch: Partial<SkillDraft>) => void;
  onDomainText: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const isSite = draft.category === 'site-exploration';
  return (
    <div className="panel-card flex flex-col gap-2 rounded-xl p-2.5">
      <p className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">New skill</p>
      <Input
        value={draft.name}
        onChange={(e) => onChange({ name: e.target.value.toLowerCase() })}
        placeholder="skill-name"
        aria-label="Skill name"
        className="h-8 font-mono text-xs"
      />
      <Input
        value={draft.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="What is this for?"
        aria-label="Skill description"
        className="h-8 text-xs"
      />

      <div className="flex gap-1.5">
        <Button
          variant={isSite ? 'outline' : 'default'}
          size="sm"
          className="flex-1"
          onClick={() => onChange({ category: 'general' })}
        >
          General
        </Button>
        <Button
          variant={isSite ? 'default' : 'outline'}
          size="sm"
          className="flex-1"
          onClick={() => onChange({ category: 'site-exploration' })}
        >
          <Globe /> Site notes
        </Button>
      </div>

      {isSite && (
        <Input
          value={domainText}
          onChange={(e) => onDomainText(e.target.value)}
          placeholder="acme.com, admin.acme.com"
          aria-label="Domains this skill applies to"
          className="h-8 font-mono text-xs"
        />
      )}

      <p className="line-clamp-3 rounded-lg border border-line bg-ground/70 px-2 py-1.5 text-[11px] leading-relaxed text-ink-faint">
        {draft.body || 'This file has no instructions in it.'}
      </p>

      {error && (
        <p className="rounded-lg border border-amber/40 bg-amber/10 px-2 py-1.5 text-[11px] text-amber">{error}</p>
      )}

      <div className="flex gap-1.5">
        <Button variant="ghost" size="sm" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" className="flex-1" onClick={onSave} disabled={!connected}>
          <Check /> Save skill
        </Button>
      </div>
      {!connected && <p className="text-center text-[10px] text-ink-faint">Pair the browser to save skills.</p>}
    </div>
  );
}

function SkillList({ skills, host }: { skills: StoredSkillMeta[]; host: string }) {
  if (skills.length === 0) {
    return (
      <div className="dot-grid fade-bottom rounded-xl border border-line px-3 py-6 text-center">
        <BookOpen className="mx-auto size-5 text-ink-faint" />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          No skills yet. Mapping a site writes one for you; uploading a markdown file adds your own.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {skills.map((skill) => (
        <SkillRow key={skill.id} skill={skill} host={host} />
      ))}
    </div>
  );
}

function SkillRow({ skill, host }: { skill: StoredSkillMeta; host: string }) {
  const activeHere = skill.category === 'site-exploration' && hostMatchesDomains(host, skill.domains);
  const generated = skill.origin === 'generated';
  const Icon = generated ? Compass : BookOpen;
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border px-2.5 py-2 text-xs',
        activeHere ? 'border-brand/35 bg-brand/8' : 'border-line bg-ground/40',
      )}
    >
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', activeHere ? 'text-brand' : 'text-ink-faint')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-ink">{skill.name}</span>
          {generated && <Badge variant="outline">mapped</Badge>}
          {activeHere && <Badge>on this site</Badge>}
        </div>
        {skill.domains.length > 0 && (
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink-faint">{skill.domains.join(', ')}</p>
        )}
        {skill.description && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-dim">{skill.description}</p>
        )}
        {skill.status === 'pending' && (
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
            <Loader2 className="size-3 animate-spin" /> Saving…
          </span>
        )}
        {skill.status === 'error' && (
          <span className="mt-0.5 block text-[11px] text-destructive">{skill.error ?? 'Could not save'}</span>
        )}
      </div>
      <button
        type="button"
        onClick={() =>
          void browser.runtime.sendMessage({ channel: BRIDGE_CHANNEL, op: 'removeSkill', skillId: skill.id })
        }
        aria-label={`Remove ${skill.name}`}
        className="mt-0.5 shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
