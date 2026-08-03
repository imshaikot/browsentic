import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatEta, type MonitorState } from '@/lib/monitor/events';

export function MonitorBar({ state, onStop }: { state: MonitorState; onStop: () => void }) {
  const elapsed = useElapsed(state.startedAt);
  const left = Math.max(0, state.timeoutMs - elapsed);
  const percent = state.percent != null ? Math.round(state.percent) : null;

  return (
    <div className="mb-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-2.5">
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-sky-500" />
        <span className="min-w-0 truncate text-xs font-medium">Watching {state.label ?? state.host}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{clock(elapsed)}</span>
        <span className="flex-1 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {percent != null ? `${percent}%` : ''}
        </span>
        <Button
          size="sm"
          className="h-6 shrink-0 bg-sky-600 px-2 text-xs text-white shadow-xs hover:bg-sky-700"
          onClick={onStop}
        >
          <Square className="size-3 fill-current" /> Stop
        </Button>
      </div>
      {percent != null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sky-500/15">
          <div className="h-full rounded-full bg-sky-500 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{statusLine(state, left)}</p>
    </div>
  );
}

function statusLine(state: MonitorState, left: number): string {
  if (state.stalledForMs != null) return `No change for ${clock(state.stalledForMs)}.`;
  if (state.percent != null && state.etaMs != null) return `${Math.round(state.percent)}% · ${formatEta(state.etaMs)} left`;
  const lastLog = state.logs.at(-1)?.text;
  return lastLog ?? `Stops automatically in ${clock(left)}.`;
}

function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, now - startedAt);
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
