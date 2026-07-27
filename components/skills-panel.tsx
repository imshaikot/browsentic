import { useRef, useState } from 'react';
import { BookOpen, Check, Compass, Globe, Loader2, Upload, X } from 'lucide-react';
import { browser } from 'wxt/browser';

import { BRIDGE_CHANNEL } from '@/lib/actions/protocol';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

/**
 * The library of skills the user has uploaded. A skill is markdown the agent is given as part
 * of its system prompt; a site-exploration one carries the domains it applies to and engages
 * only on those, which is what makes it safe to keep several around at once.
 *
 * Uploads live in `storage.local` and are pushed to the daemon, which writes them into its
 * skills directory — nothing here ever reaches the repo.
 */
export function SkillsPanel({
  tabUrl,
  connected,
  onMapSite,
  mapping,
}: {
  tabUrl: string;
  connected: boolean;
  /** Start a mapping run for the current tab. Absent when the surface cannot host one. */
  onMapSite?: () => void;
  /** True while any run is active — one at a time, and a crawl takes minutes. */
  mapping?: boolean;
}) {
  const skills = useStoredSkills();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [domainText, setDomainText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const host = hostnameOf(tabUrl);
  const mappable = !!onMapSite && connected && !mapping && /^https?:/.test(tabUrl);
  const alreadyMapped = skills.some(
    (skill) => skill.origin === 'generated' && hostMatchesDomains(host, skill.domains),
  );

  async function onPickFile() {
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (input) input.value = ''; // let the same file be picked again later
    if (!file) return;
    // Markdown is text — read it as text, and let the form fill in whatever the file omits.
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
    <div className="mb-2 rounded-md border bg-muted/30 p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-xs font-medium">Skills</span>
        {!draft && (
          <>
            {onMapSite && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={onMapSite}
                disabled={!mappable}
                // Naming the host makes the consent unambiguous: this drives that site for minutes.
                title={mappable ? `Map ${host}` : 'Open an http(s) page, with no run in progress'}
              >
                <Compass className="size-3" /> {alreadyMapped ? 'Re-map' : 'Map'} {host || 'site'}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => fileInputRef.current?.click()}>
              <Upload className="size-3" /> Upload
            </Button>
          </>
        )}
      </div>

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

/** Everything the daemon needs, prefilled from the file's own front matter where it had any. */
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
    <div className="flex flex-col gap-2">
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

      <div className="flex gap-1">
        <Button
          variant={isSite ? 'outline' : 'default'}
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={() => onChange({ category: 'general' })}
        >
          General
        </Button>
        <Button
          variant={isSite ? 'default' : 'outline'}
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={() => onChange({ category: 'site-exploration' })}
        >
          <Globe className="size-3" /> Site notes
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

      <p className="line-clamp-3 rounded bg-background/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {draft.body || 'This file has no instructions in it.'}
      </p>

      {error && (
        <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">{error}</p>
      )}

      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" className="h-7 flex-1 text-xs" onClick={onSave} disabled={!connected}>
          <Check className="size-3" /> Save skill
        </Button>
      </div>
      {!connected && (
        <p className="text-center text-[10px] text-muted-foreground">Pair the browser to save skills.</p>
      )}
    </div>
  );
}

function SkillList({ skills, host }: { skills: StoredSkillMeta[]; host: string }) {
  if (skills.length === 0) {
    return (
      <p className="px-1 py-1 text-[11px] leading-relaxed text-muted-foreground">
        Upload a markdown file of notes about a site — where things are, how its lists load — and tag it with that
        site&apos;s domain. It joins the agent&apos;s instructions whenever you are on that site, and stays out of the
        way everywhere else.
      </p>
    );
  }
  return (
    <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
      {skills.map((skill) => (
        <SkillRow key={skill.id} skill={skill} host={host} />
      ))}
    </div>
  );
}

function SkillRow({ skill, host }: { skill: StoredSkillMeta; host: string }) {
  // The one thing worth knowing at a glance: is this skill in play on the tab I am looking at?
  const activeHere = skill.category === 'site-exploration' && hostMatchesDomains(host, skill.domains);
  const generated = skill.origin === 'generated';
  const Icon = generated ? Compass : BookOpen;
  return (
    <div className="flex items-start gap-2 rounded-md border bg-background/60 px-2.5 py-1.5 text-xs">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', activeHere ? 'text-emerald-500' : 'text-muted-foreground')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{skill.name}</span>
          {generated && (
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]">
              mapped
            </Badge>
          )}
          {activeHere && (
            <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
              on this site
            </Badge>
          )}
        </div>
        {skill.domains.length > 0 && (
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{skill.domains.join(', ')}</p>
        )}
        {skill.description && (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{skill.description}</p>
        )}
        {skill.status === 'pending' && (
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
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
        className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
