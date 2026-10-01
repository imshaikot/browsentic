import { BookOpen, Bug, ExternalLink, LifeBuoy, Lightbulb, MonitorCog, RotateCcw, ScrollText, Star, type LucideIcon } from 'lucide-react';

import { Logo } from '@/extension/components/brand';
import { AUTHOR, LINKS, STAR_ASK, bugReportUrl, describeAgent, describeVersions, type VersionRow } from '@/lib/about';
import { Card, CopyButton, PrimaryButton, QuietButton, SectionTitle } from '../components';
import type { Model, State } from '../model';

export function versionsOf(state: State): VersionRow[] {
  const { info, status, lock, stamp, node } = state;
  const daemonVersion = status?.daemonVersion ?? lock?.daemonVersion;
  const agent = describeAgent(state.agents);
  return [
    { label: 'App', value: info?.version ?? 'unknown' },
    { label: 'Command', value: info?.payload.installed ?? 'not installed' },
    { label: 'Daemon', value: daemonVersion ? [daemonVersion, status && `port ${status.port}`].filter(Boolean).join(' · ') : 'off' },
    status && { label: 'Protocol', value: String(status.protocolVersion) },
    {
      label: 'Extension',
      value: [stamp && `${stamp.version} unpacked`, status?.connected && status.extensionVersion ? `${status.extensionVersion} connected` : 'not connected']
        .filter(Boolean)
        .join(' · '),
    },
    agent && { label: 'Agent', value: agent },
    node && { label: 'Node.js', value: node.version },
    info && { label: 'System', value: `${info.system.name} · ${info.system.architecture}` },
  ].filter((row): row is VersionRow => !!row);
}

export function AboutView({ model, state }: { model: Model; state: State }) {
  const versions = versionsOf(state);
  const environment = describeVersions(versions);
  const open = (url: string) => () => void model.openUrl(url);

  return (
    <div className="space-y-4.5">
      <Card>
        <div className="flex items-center gap-4">
          <Logo className="size-12 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <SectionTitle title="Browsentic" subtitle={`${state.info?.version ?? ''} · your browser’s superpower · free and open source, Apache 2.0.`} />
          </div>
          <QuietButton icon={ExternalLink} onClick={open(LINKS.site)}>
            browsentic.com
          </QuietButton>
          <QuietButton icon={ExternalLink} onClick={open(LINKS.repository)}>
            Source
          </QuietButton>
        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <SectionTitle title={`Made by ${AUTHOR}`} subtitle="Builds and maintains Browsentic." />
            </div>
            <QuietButton icon={ExternalLink} onClick={open(LINKS.author)}>
              GitHub profile
            </QuietButton>
          </div>
          <div className="border-t border-line" />
          <div className="flex items-center gap-4">
            <Star className="size-5 shrink-0 text-amber" strokeWidth={2.5} />
            <div className="min-w-0 flex-1">
              <SectionTitle title="Star it on GitHub" subtitle={STAR_ASK} />
            </div>
            <PrimaryButton icon={Star} onClick={open(LINKS.repository)}>
              Star
            </PrimaryButton>
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-3.5">
          <SectionTitle
            title="Versions"
            subtitle="What this computer is running. Report a bug opens GitHub’s issue form with these filled in; nothing is sent until you submit it there."
          />
          <dl className="divide-y divide-line rounded-[10px] border border-line bg-ground-2">
            {versions.map(({ label, value }) => (
              <div key={label} className="flex items-center gap-4 px-3.5 py-2">
                <dt className="w-24 shrink-0 text-xs text-ink-dim">{label}</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink select-text">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton value={environment} />
            <QuietButton icon={Bug} onClick={open(bugReportUrl({ environment, agent: describeAgent(state.agents) }))}>
              Report a bug
            </QuietButton>
            <QuietButton icon={Lightbulb} onClick={open(LINKS.feature)}>
              Suggest a feature
            </QuietButton>
          </div>
        </div>
      </Card>

      <Card padded={false}>
        <div className="px-5 pt-5 pb-2">
          <SectionTitle title="Help" />
        </div>
        <HelpRow icon={BookOpen} title="Guide" detail="Installing, pairing, the agents, and every feature step by step." onClick={open(LINKS.guide)} />
        <HelpRow icon={MonitorCog} title="This app" detail="Every tab of this window, the tray, updates and uninstalling." onClick={open(LINKS.windowsApp)} />
        <HelpRow icon={LifeBuoy} title="Troubleshooting" detail="Symptom, cause and fix for setup, pairing, agents and pages." onClick={open(LINKS.troubleshooting)} />
        <HelpRow icon={ScrollText} title="Release notes" detail="What changed in each version." onClick={open(LINKS.changelog)} />
        <div className="border-t border-line px-5 py-3.5">
          <QuietButton icon={RotateCcw} onClick={() => model.showPreflight()}>
            Run the checks again
          </QuietButton>
        </div>
      </Card>
    </div>
  );
}

function HelpRow({ icon: Icon, title, detail, onClick }: { icon: LucideIcon; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex w-full items-center gap-3.5 border-t border-line px-5 py-3 text-left transition-colors hover:bg-surface-2/60">
      <Icon className="size-4 shrink-0 text-brand" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-xs text-ink-dim">{detail}</span>
      </span>
      <ExternalLink className="size-3.5 shrink-0 text-ink-faint transition-colors group-hover:text-ink-dim" />
    </button>
  );
}
