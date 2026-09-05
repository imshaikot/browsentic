import { Check } from 'lucide-react';

import { THEMES, type ThemeId } from '@/lib/bridge/theme';
import { cn } from '@/lib/utils';

const ACCENTS = ['bg-brand', 'bg-ember', 'bg-lime', 'bg-amber'];

export function ThemePicker({ theme, onSelect }: { theme: ThemeId; onSelect: (theme: ThemeId) => void }) {
  return (
    <section className="space-y-2">
      <h3 className="font-mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">Appearance</h3>
      <p className="text-[11px] leading-relaxed text-ink-faint">
        One click repaints the panel and the popup. Each tile is drawn in the theme it offers, so what you see is
        what you get.
      </p>

      <div className="grid grid-cols-2 gap-1.5">
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
                'rounded-lg border bg-ground p-2 text-left transition-colors',
                active ? 'border-brand/60' : 'border-line hover:border-line-strong',
              )}
            >
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1 space-y-1 rounded-md bg-surface px-1.5 py-1.5">
                  <div className="h-1 w-9/12 rounded-full bg-ink/75" />
                  <div className="h-1 w-6/12 rounded-full bg-ink/30" />
                  <div className="flex gap-1 pt-1">
                    {ACCENTS.map((accent) => (
                      <span key={accent} className={cn('size-2 rounded-full', accent)} />
                    ))}
                  </div>
                </div>
                <span
                  className={cn(
                    'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full',
                    active ? 'bg-brand text-ground' : 'border border-line-strong',
                  )}
                >
                  {active && <Check className="size-2.5" strokeWidth={3} />}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] font-medium text-ink">{name}</p>
              <p className="text-[10px] leading-snug text-ink-faint">{note}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
