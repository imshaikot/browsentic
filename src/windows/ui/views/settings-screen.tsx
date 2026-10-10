import { AlignLeft, BookOpen, ShieldCheck, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SETTINGS_SECTIONS, type Model, type SettingsSection, type State } from '../model';
import { ActivityView } from './activity';
import { AgentsView } from './agents';
import { LogsView } from './logs';
import { SettingsView } from './settings';
import { SkillsView } from './skills';

const SECTION: Record<SettingsSection, { label: string; icon: LucideIcon; view: typeof SettingsView }> = {
  general: { label: 'General', icon: SlidersHorizontal, view: SettingsView },
  agents: { label: 'Agents', icon: Sparkles, view: AgentsView },
  skills: { label: 'Skills', icon: BookOpen, view: SkillsView },
  activity: { label: 'Activity', icon: ShieldCheck, view: ActivityView },
  logs: { label: 'Logs', icon: AlignLeft, view: LogsView },
};

/** Settings, with the pages that once had tabs of their own, picked from a sidebar that stays put while a page scrolls. */
export function SettingsScreen({ model, state }: { model: Model; state: State }) {
  const View = SECTION[state.settingsSection].view;
  return (
    <div className="flex items-start gap-7">
      <nav aria-label="Settings sections" className="sticky top-16 flex w-42 shrink-0 flex-col gap-0.5">
        {SETTINGS_SECTIONS.map((section) => {
          const { label, icon: Icon } = SECTION[section];
          const active = state.settingsSection === section;
          return (
            <button
              key={section}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => model.openSettings(section)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active ? 'bg-brand/12 text-brand' : 'text-ink-faint hover:bg-surface/60 hover:text-ink-dim',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </nav>
      <div key={state.settingsSection} className="enter min-w-0 flex-1">
        <View model={model} state={state} />
      </div>
    </div>
  );
}
