import { useEffect, useState } from 'react';
import { Radar, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatEta, type MonitorState } from '@/lib/monitor/events';

export function MonitorBar({ state, onStop }: { state: MonitorState; onStop: () => void }) {
  const elapsed = useElapsed(state.startedAt);
  const left = Math.max(0, state.timeoutMs - elapsed);
  const percent = state.percent != null ? Math.round(state.percent) : null;

  return (
    <div className="enters mb-2 rounded-xl border border-magenta/35 bg-magenta/8 p-2.5">
      <div className="flex items-center gap-2">
        <Radar className="size-3.5 shrink-0 animate-pulse text-magenta" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
          Watching {state.label ?? state.host}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
          {clock(elapsed)}
          {percent != null && ` · ${percent}%`}
        </span>
        <Button size="sm" variant="ghost" className="shrink-0 text-magenta hover:text-magenta" onClick={onStop}>
          <Square className="size-3 fill-current" /> Stop
        </Button>
      </div>
      {percent != null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-magenta/15">
          <div
            className="glow-dot h-full rounded-full bg-magenta text-magenta transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{statusLine(state, left)}</p>
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
