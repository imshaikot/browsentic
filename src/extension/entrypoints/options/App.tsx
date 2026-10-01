import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Ban, Link2, Puzzle, ShieldCheck, Sparkles, UserRound, type LucideIcon } from 'lucide-react';
import { browser } from 'wxt/browser';

import { AgentPicker } from '@/extension/components/agent-picker';
import { BlockedSitesSettings } from '@/extension/components/blocked-sites-settings';
import { Wordmark } from '@/extension/components/brand';
import { DaemonLink } from '@/extension/components/daemon-link';
import { ExtensionSettings, SettingsGroup } from '@/extension/components/extension-settings';
import { GuardrailSettings } from '@/extension/components/guardrail-settings';
import { ProfileSettings } from '@/extension/components/profile-settings';
import { StatusPill, describeStatus } from '@/extension/components/status-pill';
import { ThemePicker } from '@/extension/components/theme-picker';
import { useDaemonState } from '@/lib/bridge/use-daemon-state';
import { useTheme } from '@/lib/bridge/use-theme';
import { cn } from '@/lib/utils';

type SectionId = 'extension' | 'profile' | 'guardrails' | 'blocked' | 'agent' | 'connection';

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; blurb: string; View: ComponentType }[] = [
  {
    id: 'extension',
    label: 'Extension',
    icon: Puzzle,
    blurb: 'How the extension looks and how you reach it. Every paired browser and the desktop app share the look; the right-click menu, the shortcuts and the rest belong to this browser.',
    View: Extension,
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: UserRound,
    blurb: 'What the agent may use about you — for forms, sign-ups and checkouts — and rules it keeps to on every task. Anything filled in here reaches the model with each run, so it uses these exact values instead of guessing.',
    View: ProfileSettings,
  },
  {
    id: 'guardrails',
    label: 'Guardrails',
    icon: ShieldCheck,
    blurb: 'What the agent may do without asking you first. A run takes its policy when it starts, so a change applies to the next one. The desktop app’s Settings tab edits the same rows.',
    View: GuardrailSettings,
  },
  {
    id: 'blocked',
    label: 'Blocked sites',
    icon: Ban,
    blurb: 'Sites Browsentic will never read or act on — no agent, schedule or saved tool can override it. Kept in this browser only; the daemon, the agent and the desktop app cannot see or change it.',
    View: BlockedSitesSettings,
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: Sparkles,
    blurb: 'Which agent CLI the side panel drives, and on which model. A switch here or in the desktop app reaches every paired browser.',
    View: Agent,
  },
  {
    id: 'connection',
    label: 'Connection',
    icon: Link2,
    blurb: 'The link between this browser and the Browsentic daemon on this computer.',
    View: Connection,
  },
];

const isSection = (value: string): value is SectionId => SECTIONS.some((section) => section.id === value);

function readSection(): SectionId {
  const id = window.location.hash.slice(1);
  return isSection(id) ? id : 'extension';
}

function useSection(): SectionId {
  const [section, setSection] = useState(readSection);
  useEffect(() => {
    const follow = () => setSection(readSection());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  return section;
}

export default function App() {
  const daemon = useDaemonState();
  const section = useSection();
  const status = describeStatus(daemon);
  const current = SECTIONS.find(({ id }) => id === section)!;

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 z-10 border-b border-line bg-ground-2/85 backdrop-blur md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex flex-col gap-3 px-4 pt-3 pb-2 md:h-full md:gap-8 md:px-5 md:py-6">
          <div className="flex items-center gap-2">
            <Wordmark className="flex-1" />
            <StatusPill tone={status.tone} className="md:hidden">
              {status.label}
            </StatusPill>
          </div>

          <nav
            aria-label="Settings sections"
            className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] md:flex-col md:overflow-visible [&::-webkit-scrollbar]:hidden"
          >
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const active = id === section;
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors md:rounded-lg md:py-2 md:text-sm',
                    active ? 'bg-brand/12 text-brand' : 'text-ink-faint hover:bg-surface/60 hover:text-ink-dim',
                  )}
                >
                  <Icon className="size-3.5 md:size-4" />
                  {label}
                </a>
              );
            })}
          </nav>

          <footer className="mt-auto hidden space-y-2 md:block">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            <p className="font-mono text-[10px] tracking-[0.1em] text-ink-faint">
              v{browser.runtime.getManifest().version}
            </p>
          </footer>
        </div>
      </aside>

      <main className="dot-grid min-w-0 flex-1">
        <div className="mx-auto max-w-2xl px-4 py-8 md:px-10 md:py-14">
          <header className="space-y-2">
            <p className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">Settings</p>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{current.label}</h1>
            <p className="text-sm leading-relaxed text-ink-dim">{current.blurb}</p>
          </header>
          <div key={section} className="enters mt-8">
            <current.View />
          </div>
        </div>
      </main>
    </div>
  );
}

function Extension() {
  const [theme, setTheme] = useTheme();
  const daemon = useDaemonState();

  return (
    <div className="space-y-8">
      <SettingsGroup
        title="Appearance"
        card={false}
        note={
          daemon?.connected
            ? 'Kept in the daemon’s config, so every paired browser and the desktop app see the change at once.'
            : 'Kept in this browser for now, and handed to the daemon the next time it connects.'
        }
      >
        <ThemePicker theme={theme} onSelect={setTheme} />
      </SettingsGroup>
      <ExtensionSettings />
    </div>
  );
}

function Agent() {
  const daemon = useDaemonState();
  if (!daemon?.paired) {
    return (
      <Card>
        <p className="py-6 text-center text-sm leading-relaxed text-ink-faint">
          Pair this browser first — the agent runs beside the daemon, not in here.{' '}
          <a href="#connection" className="text-brand hover:underline">
            Set up the connection
          </a>
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <AgentPicker />
    </Card>
  );
}

function Connection() {
  return (
    <div className="space-y-4">
      <Card>
        <DaemonLink />
      </Card>
      <p className="text-xs leading-relaxed text-ink-faint">
        On a Mac, the Browsentic app’s Browsers tab also hands out pairing codes and lists every paired browser.
      </p>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="panel-card rounded-xl p-5">{children}</div>;
}
