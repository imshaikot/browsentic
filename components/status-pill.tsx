import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { activeRunner } from '@/lib/agents/catalog';
import type { DaemonState } from '@/lib/bridge/socket';
import { cn } from '@/lib/utils';

export type StatusTone = 'off' | 'pending' | 'live' | 'busy' | 'listening' | 'warn';

export type StatusBlocker = 'unpaired' | 'offline' | 'agent';

export interface Status {
  tone: StatusTone;
  label: string;
  /** The link is up and the chosen agent can run — everything else is disabled without it. */
  ready: boolean;
  blocker?: StatusBlocker;
}

/** One reading of the link, the agent and the run — the header pill on both surfaces. */
export function describeStatus(
  daemon: DaemonState | null,
  { running, listening }: { running?: boolean; listening?: boolean } = {},
): Status {
  const agentReady = activeRunner(daemon?.agent)?.ready !== false;
  const ready = (daemon?.connected ?? false) && agentReady;

  if (!daemon?.paired) return { tone: 'off', label: 'Not paired', ready, blocker: 'unpaired' };
  if (!daemon.connected) return { tone: 'pending', label: 'Reconnecting', ready, blocker: 'offline' };
  if (!agentReady) return { tone: 'warn', label: 'Agent blocked', ready, blocker: 'agent' };
  if (running) return { tone: 'busy', label: 'Working', ready };
  if (listening) return { tone: 'listening', label: 'Listening', ready };
  return { tone: 'live', label: 'Online', ready };
}

const DOT: Record<StatusTone, string> = {
  off: 'bg-ink-faint/50',
  pending: 'glow-dot animate-pulse bg-amber text-amber',
  live: 'glow-dot bg-lime text-lime',
  busy: 'glow-dot animate-pulse bg-brand text-brand',
  listening: 'glow-dot animate-pulse bg-magenta text-magenta',
  warn: 'glow-dot bg-ember text-ember',
};

const TEXT: Record<StatusTone, string> = {
  off: 'text-ink-faint',
  pending: 'text-amber',
  live: 'text-ink-dim',
  busy: 'text-brand',
  listening: 'text-magenta',
  warn: 'text-ember',
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return <span className={cn('size-1.5 shrink-0 rounded-full', DOT[tone], className)} />;
}

export function StatusPill({
  tone,
  children,
  onClick,
  expanded,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  onClick?: () => void;
  expanded?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <StatusDot tone={tone} />
      <span className="min-w-0 truncate">{children}</span>
      {onClick && (
        <ChevronDown
          className={cn('size-3 shrink-0 text-ink-faint transition-transform', expanded && 'rotate-180')}
        />
      )}
    </>
  );

  const shell = cn(
    'inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-ground-2/70 px-2.5 py-1',
    'font-mono text-[10px] tracking-[0.12em] uppercase',
    TEXT[tone],
    className,
  );

  if (!onClick) return <span className={shell}>{body}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={cn(shell, 'transition-colors hover:border-brand/40 hover:bg-surface/60')}
    >
      {body}
    </button>
  );
}
