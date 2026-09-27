import { AlignLeft, BookOpen, Globe, Power, Settings, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TABS, type Model, type State, type Tab } from '../model';
import { ActivityView } from './activity';
import { AgentsView } from './agents';
import { BrowsersView } from './browsers';
import { LogsView } from './logs';
import { OverviewView } from './overview';
import { SettingsView } from './settings';
import { SkillsView } from './skills';

const TAB: Record<Tab, { label: string; icon: LucideIcon; view: typeof OverviewView }> = {
  overview: { label: 'Overview', icon: Power, view: OverviewView },
  browsers: { label: 'Browsers', icon: Globe, view: BrowsersView },
  agents: { label: 'Agents', icon: Sparkles, view: AgentsView },
  skills: { label: 'Skills', icon: BookOpen, view: SkillsView },
  activity: { label: 'Activity', icon: ShieldCheck, view: ActivityView },
  logs: { label: 'Logs', icon: AlignLeft, view: LogsView },
  settings: { label: 'Settings', icon: Settings, view: SettingsView },
};

export function MainView({ model, state }: { model: Model; state: State }) {
  const View = TAB[state.tab].view;
  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto [scrollbar-width:none]">
        <div key={state.tab} className="enter mx-auto max-w-[880px] px-7 pt-16 pb-9">
          <View model={model} state={state} />
        </div>
      </div>
      <TabCapsule model={model} state={state} />
    </div>
  );
}

/** The view switcher floats at the top centre, Ctrl+1…Ctrl+7. */
function TabCapsule({ model, state }: { model: Model; state: State }) {
  return (
    <nav className="absolute top-1.5 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-full border border-line bg-surface/80 p-1 shadow-[0_6px_18px_rgb(0_0_0/0.25)] backdrop-blur-md">
      {TABS.map((tab, index) => {
        const { label, icon: Icon } = TAB[tab];
        const selected = state.tab === tab;
        return (
          <button
            key={tab}
            type="button"
            title={`${label} (Ctrl+${index + 1})`}
            aria-current={selected ? 'page' : undefined}
            onClick={() => model.setTab(tab)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.75 text-xs font-medium transition-colors',
              selected ? 'bg-brand text-ground' : 'text-ink-dim hover:text-ink',
            )}
          >
            <Icon className="size-3" strokeWidth={2.5} />
            {label}
            {tab === 'overview' && state.update && <span className={cn('size-1.5 rounded-full', selected ? 'bg-ground' : 'bg-brand')} />}
          </button>
        );
      })}
    </nav>
  );
}
