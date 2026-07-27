import { AlertTriangle, Bot, Check, Info, User, Wrench, X, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { RunItem } from '@/lib/bridge/use-run';
import { cn } from '@/lib/utils';

interface RunTimelineProps {
  items: RunItem[];
  onDecide: (toolId: string, allow: boolean) => void;
}

/** The transcript: what the user asked, what the agent said, and every action it took. */
export function RunTimeline({ items, onDecide }: RunTimelineProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {items.map((item) =>
        item.kind === 'tool' ? (
          <ToolRow key={item.id} item={item} onDecide={onDecide} />
        ) : item.kind === 'notice' ? (
          <Notice key={item.id} item={item} />
        ) : (
          <Bubble key={item.id} item={item} />
        ),
      )}
    </div>
  );
}

function Bubble({ item }: { item: Extract<RunItem, { kind: 'user' | 'assistant' }> }) {
  const isAssistant = item.kind === 'assistant';
  return (
    <div className={cn('flex gap-2', !isAssistant && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          isAssistant
            ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {isAssistant ? <Bot className="size-4" /> : <User className="size-4" />}
      </div>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap',
          isAssistant ? 'rounded-tl-sm bg-muted' : 'rounded-tr-sm bg-primary text-primary-foreground',
        )}
      >
        {item.text}
      </div>
    </div>
  );
}

function ToolRow({
  item,
  onDecide,
}: {
  item: Extract<RunItem, { kind: 'tool' }>;
  onDecide: (toolId: string, allow: boolean) => void;
}) {
  return (
    <div className="ml-9 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs">
        <StatusIcon ok={item.ok} awaiting={item.awaiting} />
        <span className="font-mono text-muted-foreground">{item.action.replace(/^page\./, '')}</span>
        {item.source === 'local' && (
          <Zap className="size-3 shrink-0 text-amber-500" aria-label="Handled in the browser" />
        )}
        {item.summary && (
          <span className={cn('truncate', item.ok === false ? 'text-destructive' : 'text-muted-foreground')}>
            {item.summary}
          </span>
        )}
      </div>

      {item.awaiting && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
          <p className="flex-1 text-xs">Allow this action?</p>
          <Button size="sm" variant="outline" className="h-7" onClick={() => onDecide(item.id, false)}>
            Deny
          </Button>
          <Button size="sm" className="h-7" onClick={() => onDecide(item.id, true)}>
            Allow
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ ok, awaiting }: { ok?: boolean; awaiting?: boolean }) {
  if (awaiting) return <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />;
  if (ok === true) return <Check className="size-3.5 shrink-0 text-emerald-500" />;
  if (ok === false) return <X className="size-3.5 shrink-0 text-destructive" />;
  // Still running: no verdict yet.
  return <Wrench className="size-3.5 shrink-0 animate-pulse text-muted-foreground" />;
}

function Notice({ item }: { item: Extract<RunItem, { kind: 'notice' }> }) {
  const isError = item.tone === 'error';
  return (
    <div
      className={cn(
        'ml-9 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs',
        isError ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground',
      )}
    >
      {isError ? (
        <AlertTriangle className="mt-px size-3.5 shrink-0" />
      ) : (
        <Info className="mt-px size-3.5 shrink-0" />
      )}
      <span className="min-w-0 break-words">{item.text}</span>
    </div>
  );
}
