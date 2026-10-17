import { Check, PanelRight, TriangleAlert, X } from 'lucide-react';

import { Markdown } from '@/extension/components/markdown';
import { Button } from '@/extension/components/ui/button';
import { injectCode } from '@/lib/actions/page/inject-code';
import { toolName, type RunSummary } from '@/lib/home/run-summary';
import { cn } from '@/lib/utils';

/** Home's view of its own conversation: the latest request and where it stands. The side panel holds the rest. */
export function RunCard({
  summary,
  onOpenPanel,
  onDecide,
  onDismiss,
}: {
  summary: Exclude<RunSummary, { phase: 'idle' }>;
  /** Absent in a browser with no side panel. */
  onOpenPanel?: () => void;
  onDecide: (toolId: string, allow: boolean) => void;
  onDismiss: () => void;
}) {
  const live = summary.phase === 'working' || summary.phase === 'approval' || (summary.phase === 'reply' && summary.live);
  return (
    <section
      aria-live="polite"
      aria-label="This tab’s conversation"
      className={cn('panel-card enters relative overflow-hidden rounded-2xl', live && 'sweep')}
    >
      <header className="flex items-start gap-3 px-4 pt-3.5">
        <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium text-ink">{summary.asked}</p>
        {!live && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="End this conversation"
            title="End this conversation"
            className="-mt-0.5 shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        )}
      </header>

      <div className="px-4 pt-2 pb-3.5">
        <Body summary={summary} onOpenPanel={onOpenPanel} onDecide={onDecide} />
      </div>

      {onOpenPanel && summary.phase !== 'approval' && (
        <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
          <span className="text-[11px] text-ink-faint">Every step is in the side panel.</span>
          <button
            type="button"
            onClick={onOpenPanel}
            className="inline-flex items-center gap-1.5 text-xs text-ink-dim transition-colors hover:text-brand"
          >
            <PanelRight className="size-3.5" /> Open the side panel
          </button>
        </footer>
      )}
    </section>
  );
}

function Body({
  summary,
  onOpenPanel,
  onDecide,
}: {
  summary: Exclude<RunSummary, { phase: 'idle' }>;
  onOpenPanel?: () => void;
  onDecide: (toolId: string, allow: boolean) => void;
}) {
  switch (summary.phase) {
    case 'working':
      return (
        <p className="flex min-w-0 items-center gap-2 text-xs text-ink-dim">
          <span className="flex shrink-0 items-center gap-1">
            {[0, 1, 2].map((dot) => (
              <span key={dot} className="think-dot size-1.5 rounded-full bg-brand" />
            ))}
          </span>
          {summary.step ? (
            <span className="min-w-0 truncate">
              <span className="font-mono text-[11px] text-ink">{toolName(summary.step)}</span>
              {summary.step.summary && <span className="text-ink-faint"> · {summary.step.summary}</span>}
            </span>
          ) : (
            'Thinking'
          )}
        </p>
      );
    case 'approval': {
      const code = summary.step.action === injectCode.name;
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ember/45 bg-ember/10 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-ink">
            {code ? 'The agent wrote code it wants to run.' : 'Allow this action?'}{' '}
            <span className="font-mono text-[11px] text-ink-dim">
              {toolName(summary.step)}
              {summary.step.site && ` on ${summary.step.site}`}
            </span>
          </p>
          {code ? (
            onOpenPanel && (
              <Button size="sm" variant="outline" onClick={onOpenPanel}>
                Review it in the side panel
              </Button>
            )
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => onDecide(summary.step.id, false)}>
                Deny
              </Button>
              <Button size="sm" onClick={() => onDecide(summary.step.id, true)}>
                Allow
              </Button>
            </>
          )}
        </div>
      );
    }
    case 'reply':
      return (
        <div className="max-h-[22rem] overflow-y-auto pr-1">
          <Markdown text={summary.reply} streaming={summary.live} className="text-sm leading-relaxed text-ink-dim" />
        </div>
      );
    case 'failed':
      return (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-destructive">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{summary.message}</span>
        </p>
      );
    case 'done':
      return (
        <p className="flex min-w-0 items-center gap-2 text-xs text-ink-dim">
          <Check className="size-3.5 shrink-0 text-lime" />
          <span className="min-w-0 truncate">
            Done{summary.step && <span className="font-mono text-[11px]"> · {toolName(summary.step)}</span>}
          </span>
        </p>
      );
  }
}
