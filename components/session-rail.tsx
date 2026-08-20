import { useState } from 'react';
import { ChevronDown, Layers, X } from 'lucide-react';
import type { TabSession } from '@/lib/bridge/tab-sessions';
import { cn } from '@/lib/utils';

export function SessionRail({
  sessions,
  activeSessionId,
  onFocus,
  onEnd,
}: {
  sessions: TabSession[];
  activeSessionId: string | null;
  onFocus: (sessionId: string) => void;
  onEnd: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (!sessions.length) return null;

  const running = sessions.filter((session) => session.runId).length;

  return (
    <div className="enters shrink-0 border-b border-line px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase transition-colors hover:text-ink"
      >
        <Layers className="size-3 shrink-0" />
        <span className="flex-1 text-left">
          Sessions · {sessions.length}
          {running > 0 && <span className="text-brand"> · {running} running</span>}
        </span>
        <ChevronDown className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1">
          {sessions.map((session) => (
            <SessionRailRow
              key={session.sessionId}
              session={session}
              current={session.sessionId === activeSessionId}
              onFocus={onFocus}
              onEnd={onEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRailRow({
  session,
  current,
  onFocus,
  onEnd,
}: {
  session: TabSession;
  current: boolean;
  onFocus: (sessionId: string) => void;
  onEnd: (sessionId: string) => void;
}) {
  const subtabs = session.tabIds.length - 1;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors',
        current ? 'border-brand/35 bg-brand/8' : 'border-line bg-ground/40 hover:border-line-strong',
      )}
    >
      <button
        type="button"
        onClick={() => onFocus(session.sessionId)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={session.url}
      >
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            session.runId ? 'glow-dot animate-pulse bg-brand text-brand' : 'bg-ink-faint',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink">{session.title}</span>
          <span className="block font-mono text-[10px] text-ink-faint">
            {session.turns} {session.turns === 1 ? 'message' : 'messages'}
            {subtabs > 0 && ` · +${subtabs} tab${subtabs === 1 ? '' : 's'}`}
            {session.host && ` · ${session.host}`}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => onEnd(session.sessionId)}
        aria-label={`End the session on ${session.title}`}
        title="End this session"
        className="shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-surface hover:text-ink"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
