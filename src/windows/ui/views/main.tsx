import { Globe, Info, Power, Settings, Smartphone, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TABS, type Model, type State, type Tab } from '../model';
import { AboutView } from './about';
import { AndroidView } from './android';
import { BrowsersView } from './browsers';
import { OverviewView } from './overview';
import { SettingsScreen } from './settings-screen';

const TAB: Record<Tab, { label: string; icon: LucideIcon; view: typeof OverviewView; badge?: string }> = {
  overview: { label: 'Overview', icon: Power, view: OverviewView },
  browsers: { label: 'Browsers', icon: Globe, view: BrowsersView },
  android: { label: 'Android', icon: Smartphone, view: AndroidView, badge: 'Experimental' },
  settings: { label: 'Settings', icon: Settings, view: SettingsScreen },
  about: { label: 'About', icon: Info, view: AboutView },
};

export function MainView({ model, state }: { model: Model; state: State }) {
  const View = TAB[state.tab].view;
  return (
    <div className="relative h-full">
      <div className="h-full overflow-y-auto [scrollbar-width:none]">
        <div key={state.tab} className={cn('enter mx-auto px-7 pt-16 pb-9', state.tab === 'settings' ? 'max-w-[1076px]' : 'max-w-[880px]')}>
          <View model={model} state={state} />
        </div>
      </div>
      <TabCapsule model={model} state={state} />
    </div>
  );
}

/** The view switcher floats at the top centre, Ctrl+1…Ctrl+5. */
function TabCapsule({ model, state }: { model: Model; state: State }) {
  return (
    <nav className="absolute top-1.5 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-full border border-line bg-surface/80 p-1 shadow-[0_6px_18px_rgb(0_0_0/0.25)] backdrop-blur-md">
      {TABS.map((tab, index) => {
        const { label, icon: Icon, badge } = TAB[tab];
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
            {badge && (
              <span
                className={cn(
                  'rounded-sm border px-1 font-mono text-[9px] tracking-wider uppercase',
                  selected ? 'border-ground/50 text-ground' : 'border-amber/50 text-amber',
                )}
              >
                {badge}
              </span>
            )}
            {tab === 'overview' && state.update && <span className={cn('size-1.5 rounded-full', selected ? 'bg-ground' : 'bg-brand')} />}
          </button>
        );
      })}
    </nav>
  );
}
