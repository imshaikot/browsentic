import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAX_RECORDING_MS, type RecordingState } from '@/lib/recordings/events';

export function RecordingBar({ state, onStop }: { state: RecordingState; onStop: () => void }) {
  const elapsed = useElapsed(state.startedAt);
  const left = Math.max(0, MAX_RECORDING_MS - elapsed);

  return (
    <div className="mb-2 rounded-md border border-red-500/40 bg-red-500/5 p-2.5">
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
        <span className="text-xs font-medium">Recording {state.host}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{clock(elapsed)}</span>
        <span className="flex-1 text-[11px] text-muted-foreground">
          {state.events} {state.events === 1 ? 'step' : 'steps'}
        </span>
        <Button
          size="sm"
          className="h-6 shrink-0 bg-red-600 px-2 text-xs text-white shadow-xs hover:bg-red-700"
          onClick={onStop}
        >
          <Square className="size-3 fill-current" /> Stop
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
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
