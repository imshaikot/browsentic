import { AGENTS, activeRunner, type AgentState } from '@/lib/agents/catalog';

const REPOSITORY = 'https://github.com/imshaikot/browsentic';

export const LINKS = {
  author: 'https://github.com/imshaikot',
  repository: REPOSITORY,
  site: 'https://browsentic.com',
  guide: 'https://browsentic.com/docs/guide/',
  troubleshooting: 'https://browsentic.com/docs/guide/troubleshooting/',
  windowsApp: 'https://browsentic.com/docs/guide/windows-app/',
  changelog: 'https://browsentic.com/changelog/',
  feature: `${REPOSITORY}/issues/new?template=capability.yml`,
} as const;

export const AUTHOR = 'imshaikot';

export const STAR_ASK =
  'Browsentic is free and open source — no API key, no subscription, no account. A star on GitHub is how the next person finds it.';

export interface VersionRow {
  label: string;
  value: string;
}

export const describeVersions = (rows: readonly VersionRow[]): string =>
  rows.map(({ label, value }) => `${label} ${value}`).join(' · ');

const RELEASE = /\d+(?:\.\d+)+(?:[-+][\w.]+)?/;

export function describeAgent(state: AgentState | undefined): string | undefined {
  const runner = activeRunner(state);
  if (!runner) return undefined;
  const release = runner.version && (runner.version.match(RELEASE)?.[0] ?? runner.version);
  return [AGENTS[runner.kind]?.label ?? runner.kind, release].filter(Boolean).join(' ');
}

export function bugReportUrl({ environment, agent }: { environment: string; agent?: string }): string {
  const fields = new URLSearchParams({ template: 'bug_report.yml', environment, ...(agent ? { agent } : {}) });
  return `${REPOSITORY}/issues/new?${fields}`;
}
