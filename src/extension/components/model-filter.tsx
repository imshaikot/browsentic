import { useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { Input } from '@/extension/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The model picker for a CLI that lists more models than a dropdown can show: the curated ones it
 * really has first, then everything else behind a filter. It unfolds in place, below its row.
 */
export function ModelFilter({
  value,
  ids,
  suggested,
  pinned,
  disabled,
  onModel,
}: {
  value: string | null;
  ids: string[];
  suggested: string[];
  pinned: string | null;
  disabled: boolean;
  onModel: (model: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const matches = (id: string) => id.toLowerCase().includes(needle);
  const top = suggested.filter(matches);
  const rest = ids.filter((id) => !suggested.includes(id) && matches(id));

  const pick = (model: string | null) => {
    setOpen(false);
    setQuery('');
    if (model !== value) onModel(model);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-expanded={open}
        className={cn(
          'flex h-6 min-w-0 flex-1 items-center justify-between gap-1.5 rounded-md border border-line bg-surface/60 px-2 font-mono text-[10px] text-ink-dim transition-colors',
          'enabled:hover:border-line-strong enabled:hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className="min-w-0 truncate">{value ?? 'Default'}</span>
        <ChevronDown className={cn('size-3 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="basis-full space-y-1 rounded-lg border border-line-strong bg-surface p-1">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
              if (event.key === 'Enter' && (top[0] ?? rest[0])) pick(top[0] ?? rest[0]);
            }}
            placeholder={`Filter ${ids.length} models`}
            aria-label="Filter models"
            className="h-6 px-2 font-mono text-[10px]"
          />
          <div className="max-h-48 overflow-y-auto overscroll-contain font-mono text-[10px]">
            {!needle && <Option selected={value === null} onPick={() => pick(null)}>Default</Option>}
            {pinned && matches(pinned) && (
              <Option selected={value === pinned} onPick={() => pick(pinned)}>
                {pinned} <span className="text-ink-faint">· not listed</span>
              </Option>
            )}
            <Group title="Suggested" ids={top} value={value} onPick={pick} />
            <Group title={top.length ? 'All models' : null} ids={rest} value={value} onPick={pick} />
            {!top.length && !rest.length && <p className="px-2 py-1 text-ink-faint">No model matches “{query.trim()}”.</p>}
          </div>
        </div>
      )}
    </>
  );
}

function Group({
  title,
  ids,
  value,
  onPick,
}: {
  title: string | null;
  ids: string[];
  value: string | null;
  onPick: (model: string) => void;
}) {
  if (!ids.length) return null;
  return (
    <div role="group" aria-label={title ?? undefined}>
      {title && <p className="px-2 pt-1.5 pb-0.5 text-[9px] tracking-[0.14em] text-ink-faint uppercase">{title}</p>}
      {ids.map((id) => (
        <Option key={id} selected={id === value} onPick={() => onPick(id)}>
          {id}
        </Option>
      ))}
    </div>
  );
}

function Option({ selected, onPick, children }: { selected: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'relative flex w-full items-center rounded-md py-1 pr-6 pl-2 text-left text-ink-dim transition-colors',
        'hover:bg-brand/15 hover:text-brand focus-visible:bg-brand/15 focus-visible:text-brand focus-visible:outline-none',
        selected && 'text-brand',
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      {selected && <Check className="absolute right-1.5 size-3" />}
    </button>
  );
}
