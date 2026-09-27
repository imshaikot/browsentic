import { Check } from 'lucide-react';

import { THEMES, type ThemeId } from '@/lib/bridge/theme';
import { cn } from '@/lib/utils';

const ACCENTS = ['bg-brand', 'bg-ember', 'bg-lime', 'bg-amber'];

export function ThemePicker({ theme, onSelect }: { theme: ThemeId; onSelect: (theme: ThemeId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {THEMES.map(({ id, name, note }) => {
        const active = id === theme;
        return (
          <button
            key={id}
            type="button"
            data-theme={id}
            onClick={() => onSelect(id)}
            aria-pressed={active}
            className={cn(
              'group rounded-xl border bg-ground p-3 text-left transition-colors',
              active ? 'border-brand/60 glow-brand' : 'border-line hover:border-line-strong',
            )}
          >
            <div className="dot-grid space-y-1.5 rounded-lg border border-line bg-surface p-3">
              <div className="h-1.5 w-9/12 rounded-full bg-ink/75" />
              <div className="h-1.5 w-6/12 rounded-full bg-ink/30" />
              <div className="h-1.5 w-8/12 rounded-full bg-ink/20" />
              <div className="flex gap-1.5 pt-2">
                {ACCENTS.map((accent) => (
                  <span key={accent} className={cn('size-2.5 rounded-full', accent)} />
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <p className="flex-1 text-sm font-medium text-ink">{name}</p>
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full',
                  active ? 'bg-brand text-ground' : 'border border-line-strong',
                )}
              >
                {active && <Check className="size-3" strokeWidth={3} />}
              </span>
            </div>
            <p className="mt-0.5 text-xs leading-snug text-ink-faint">{note}</p>
          </button>
        );
      })}
    </div>
  );
}
