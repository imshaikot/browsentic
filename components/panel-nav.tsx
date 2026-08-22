import { BookOpen, Clapperboard, History, MessagesSquare, SlidersHorizontal, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export type PanelTab = 'chat' | 'history' | 'skills' | 'recordings' | 'settings';

const TABS: { id: PanelTab; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: 'Chat', icon: MessagesSquare },
  { id: 'history', label: 'History', icon: History },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'recordings', label: 'Recordings', icon: Clapperboard },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

export function PanelNav({
  tab,
  counts,
  onSelect,
}: {
  tab: PanelTab;
  counts: Partial<Record<PanelTab, number>>;
  onSelect: (tab: PanelTab) => void;
}) {
  return (
    <nav
      aria-label="Panel sections"
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id;
        const count = counts[id] ?? 0;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors',
              active
                ? 'bg-brand/12 text-brand'
                : 'text-ink-faint hover:bg-surface/60 hover:text-ink-dim',
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {count > 0 && (
              <span
                className={cn(
                  'rounded-full px-1 font-mono text-[9px] tabular-nums',
                  active ? 'bg-brand/20' : 'bg-surface text-ink-faint',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
