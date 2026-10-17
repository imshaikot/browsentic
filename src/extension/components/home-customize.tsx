import type { ReactNode } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { browser } from 'wxt/browser';

import { Switch } from '@/extension/components/ui/switch';
import { useTheme } from '@/lib/bridge/use-theme';
import type { NewTabChoice } from '@/lib/settings/new-tab';
import { THEMES } from '@/lib/settings/theme';
import { cn } from '@/lib/utils';

export function HomeCustomize({
  choice,
  onChange,
  onTurnOff,
}: {
  choice: NewTabChoice;
  onChange: (next: NewTabChoice) => void;
  /** Switching Home off hands this tab on as well, so the change shows at once. */
  onTurnOff: () => void;
}) {
  const [theme, setTheme] = useTheme();
  const hidden = choice.hidden.length;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-xs font-medium text-ink-dim">Theme</h2>
        <div className="grid grid-cols-4 gap-2">
          {THEMES.map(({ id, name }) => {
            const active = id === theme;
            return (
              <button
                key={id}
                type="button"
                data-theme={id}
                aria-pressed={active}
                onClick={() => setTheme(id)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border bg-ground px-1 pt-2.5 pb-2 transition-colors',
                  active ? 'glow-brand border-brand/60' : 'border-line hover:border-line-strong',
                )}
              >
                <span className="relative grid size-6 place-items-center rounded-full bg-surface-2">
                  <span className="size-3 rounded-full bg-brand" />
                  {active && (
                    <span className="absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full bg-brand text-ground">
                      <Check className="size-2.5" strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-ink">{name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="divide-y divide-line rounded-xl border border-line">
        <Toggle
          title="Frequent sites"
          note={
            hidden ? (
              <>
                {hidden} hidden.{' '}
                <button type="button" onClick={() => onChange({ ...choice, hidden: [] })} className="text-brand hover:underline">
                  Show them again
                </button>
              </>
            ) : (
              'The sites you visit most, as the browser ranks them.'
            )
          }
        >
          <Switch checked={choice.sites} label="Show frequent sites" onChange={(sites) => onChange({ ...choice, sites })} />
        </Toggle>
        <Toggle title="Browsentic Home" note="Off, new tabs open the browser’s own page again.">
          <Switch checked label="Open Browsentic Home on new tabs" onChange={onTurnOff} />
        </Toggle>
      </div>

      <button
        type="button"
        onClick={() => void browser.runtime.openOptionsPage()}
        className="inline-flex items-center gap-1.5 text-xs text-ink-faint transition-colors hover:text-brand"
      >
        <SlidersHorizontal className="size-3" /> All settings
      </button>
    </div>
  );
}

function Toggle({ title, note, children }: { title: string; note: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{note}</p>
      </div>
      <div className="pt-1">{children}</div>
    </div>
  );
}
