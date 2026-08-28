import { useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, Clapperboard, History, MessagesSquare, SlidersHorizontal, type LucideIcon } from 'lucide-react';

import { type PanelTab } from '@/lib/rail/events';
import { cn } from '@/lib/utils';

export type { PanelTab };

export type PanelCounts = Partial<Record<PanelTab, number>>;

export const TABS: { id: PanelTab; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: 'Chat', icon: MessagesSquare },
  { id: 'history', label: 'History', icon: History },
  { id: 'skills', label: 'Skills', icon: BookOpen },
  { id: 'recordings', label: 'Recordings', icon: Clapperboard },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

/** Every label, then only the open tab's, then none — whichever the strip has room for. */
type Fit = 'full' | 'active' | 'icons';

export function PanelNav({
  tab,
  counts,
  onSelect,
}: {
  tab: PanelTab;
  counts: PanelCounts;
  onSelect: (tab: PanelTab) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const [fit, setFit] = useState<Fit>('full');
  const needed = useRef({ full: 0, active: 0 });
  const tally = TABS.map(({ id }) => counts[id] ?? 0).join('·');

  useLayoutEffect(() => {
    const element = nav.current;
    if (!element) return;
    let live = true;

    /* A width is only knowable while it is on screen, so each fit records its own and
       steps one rung down; stepping back up waits for the width it already learned. */
    const measure = () => {
      if (!live) return;
      const room = element.clientWidth;
      if (fit !== 'icons') needed.current[fit] = contentWidth(element);
      const { full, active } = needed.current;
      if (full > 0 && room >= full) setFit('full');
      else if (fit === 'full') setFit('active');
      else setFit(room >= active ? 'active' : 'icons');
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    void document.fonts.ready.then(measure);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [fit, tab, tally]);

  return (
    <nav
      ref={nav}
      aria-label="Panel sections"
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id;
        const count = counts[id] ?? 0;
        const labelled = fit === 'full' || (fit === 'active' && active);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            title={labelled ? undefined : label}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors',
              active ? 'bg-brand/12 text-brand' : 'text-ink-faint hover:bg-surface/60 hover:text-ink-dim',
            )}
          >
            <Icon className="size-3.5" />
            {labelled && label}
            {count > 0 &&
              (labelled ? (
                <span
                  className={cn(
                    'rounded-full px-1 font-mono text-[9px] tabular-nums',
                    active ? 'bg-brand/20' : 'bg-surface text-ink-faint',
                  )}
                >
                  {count}
                </span>
              ) : (
                <span
                  className={cn(
                    'absolute top-1 right-1 size-1.5 rounded-full',
                    active ? 'bg-brand/70' : 'bg-ink-faint/60',
                  )}
                />
              ))}
          </button>
        );
      })}
    </nav>
  );
}

function contentWidth(element: HTMLElement) {
  const style = getComputedStyle(element);
  const gap = parseFloat(style.columnGap) || 0;
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const children = Array.from(element.children);
  const span = children.reduce((width, child) => width + child.getBoundingClientRect().width, 0);
  return span + gap * Math.max(0, children.length - 1) + padding;
}
