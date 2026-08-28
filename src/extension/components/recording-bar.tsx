import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { Button } from '@/extension/components/ui/button';
import { MAX_RECORDING_MS, type RecordingState } from '@/lib/recordings/events';

export function RecordingBar({ state, onStop }: { state: RecordingState; onStop: () => void }) {
  const elapsed = useElapsed(state.startedAt);
  const left = Math.max(0, MAX_RECORDING_MS - elapsed);

  return (
    <div className="enters mb-2 rounded-xl border border-destructive/40 bg-destructive/8 p-2.5">
      <div className="flex items-center gap-2">
        <span className="glow-dot size-2 shrink-0 animate-pulse rounded-full bg-destructive text-destructive" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">Recording {state.host}</span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
          {clock(elapsed)} · {state.events} {state.events === 1 ? 'step' : 'steps'}
        </span>
        <Button size="sm" variant="ghost" className="shrink-0 text-destructive hover:text-destructive" onClick={onStop}>
          <Square className="size-3 fill-current" /> Stop
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        {state.warning ?? `Stops automatically in ${clock(left)}.`}
        {!state.captureValues && ' Typed values are not being saved.'}
      </p>
    </div>
  );
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
