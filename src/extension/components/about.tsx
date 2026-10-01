import { useState, type ReactNode } from 'react';
import { BookOpen, Bug, Check, Copy, ExternalLink, LifeBuoy, Lightbulb, ScrollText, Star, type LucideIcon } from 'lucide-react';
import { browser } from 'wxt/browser';

import { Logo } from '@/extension/components/brand';
import { Row, SettingsGroup } from '@/extension/components/extension-settings';
import { Button } from '@/extension/components/ui/button';
import { AUTHOR, LINKS, STAR_ASK, bugReportUrl, describeVersions } from '@/lib/about';
import { useAbout } from '@/lib/bridge/use-about';

export function About() {
  const { versions, agent } = useAbout();
  const environment = describeVersions(versions);

  return (
    <div className="space-y-8">
      <div className="panel-card flex flex-wrap items-center gap-4 rounded-xl p-5">
        <Logo className="size-11 shrink-0 text-brand" />
        <div className="min-w-48 flex-1">
          <p className="font-display text-lg font-semibold tracking-tight text-ink">Browsentic</p>
          <p className="text-xs text-ink-faint">
            v{browser.runtime.getManifest().version} · your browser’s superpower · free and open source, MIT
          </p>
        </div>
        <div className="flex gap-2">
          <ExternalButton href={LINKS.site}>browsentic.com</ExternalButton>
          <ExternalButton href={LINKS.repository}>Source</ExternalButton>
        </div>
      </div>

      <SettingsGroup title="Made by">
        <Row title={AUTHOR} note="Builds and maintains Browsentic.">
          <ExternalButton href={LINKS.author}>GitHub profile</ExternalButton>
        </Row>
        <Row title="Star it on GitHub" note={STAR_ASK}>
          <ExternalButton href={LINKS.repository} variant="default" icon={Star}>
            Star
          </ExternalButton>
        </Row>
      </SettingsGroup>

      <SettingsGroup
        title="Versions"
        note="What this browser is running. Report a bug opens GitHub’s issue form with these filled in; nothing is sent until you submit it there."
      >
        {versions.map(({ label, value }) => (
          <Row key={label} title={label}>
            <span className="font-mono text-xs text-ink-dim select-text">{value}</span>
          </Row>
        ))}
        <div className="flex flex-wrap gap-2 px-4 py-3">
          <CopyButton value={environment} />
          <ExternalButton href={bugReportUrl({ environment, agent })} icon={Bug}>
            Report a bug
          </ExternalButton>
          <ExternalButton href={LINKS.feature} icon={Lightbulb}>
            Suggest a feature
          </ExternalButton>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Help">
        <LinkRow href={LINKS.guide} icon={BookOpen} title="Guide" note="Installing, pairing, the agents, and every feature step by step." />
        <LinkRow href={LINKS.troubleshooting} icon={LifeBuoy} title="Troubleshooting" note="Symptom, cause and fix for setup, pairing, agents and pages." />
        <LinkRow href={LINKS.changelog} icon={ScrollText} title="Release notes" note="What changed in each version." />
      </SettingsGroup>
    </div>
  );
}

function ExternalButton({
  href,
  variant = 'outline',
  icon: Icon = ExternalLink,
  children,
}: {
  href: string;
  variant?: 'outline' | 'default';
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Button asChild variant={variant} size="sm">
      <a href={href} target="_blank" rel="noreferrer">
        <Icon /> {children}
      </a>
    </Button>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void copy()}>
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

function LinkRow({ href, icon: Icon, title, note }: { href: string; icon: LucideIcon; title: string; note: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-surface/60">
      <Icon className="size-4 shrink-0 text-brand" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">{note}</span>
      </span>
      <ExternalLink className="size-3.5 shrink-0 text-ink-faint transition-colors group-hover:text-ink-dim" />
    </a>
  );
}
