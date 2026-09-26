import { useEffect, useState } from 'react';
import { ArrowLeft, ScrollText } from 'lucide-react';
import { Button } from '@/extension/components/ui/button';
import { RunTimeline } from '@/extension/components/run-timeline';
import { OUTCOMES, clock, useNow } from '@/extension/components/task-card';
import type { RunItem } from '@/lib/bridge/run-items';
import { listTaskTranscripts, readTaskTranscript } from '@/lib/bridge/task-run-store';
import { describeMoment } from '@/lib/schedules/rule';
import type { ScheduledTask } from '@/lib/schedules/task';
import { cn } from '@/lib/utils';

export function TaskRuns({ task, onBack }: { task: ScheduledTask; onBack: () => void }) {
  useNow(60_000);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<{ at: number; items: RunItem[] } | null>(null);

  useEffect(() => {
    void listTaskTranscripts().then((list) =>
      setKept(new Set(list.filter((meta) => meta.taskId === task.id).map((meta) => meta.sessionId))),
    );
  }, [task.id, task.runs.length]);

  if (reading) {
    return (
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2 px-3 pt-3">
          <Button variant="ghost" size="icon-sm" aria-label="Back to the runs" onClick={() => setReading(null)}>
            <ArrowLeft className="size-3.5" />
          </Button>
          <span className="min-w-0 truncate text-xs text-ink-dim">
            {task.name} · {describeMoment(reading.at)}
          </span>
        </div>
        <RunTimeline items={reading.items} running={false} onDecide={() => undefined} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to the tasks" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{task.name}</h2>
        <span className="shrink-0 font-mono text-[10px] text-ink-faint">
          {task.runs.length} {task.runs.length === 1 ? 'run' : 'runs'} kept
        </span>
      </div>

      {task.runs.map((run) => {
        const { icon: Icon, tone, words } = OUTCOMES[run.outcome];
        const readable = run.sessionId !== undefined && kept.has(run.sessionId);
        return (
          <div key={`${run.at}-${run.outcome}`} className="flex items-start gap-2 rounded-xl border border-line bg-ground/40 px-2.5 py-2">
            <Icon className={cn('mt-0.5 size-3.5 shrink-0', tone)} />
            <div className="min-w-0 flex-1 text-[11px]">
              <p className="text-ink-faint">
                <span className="text-ink-dim">{words}</span> · {describeMoment(run.at)}
                {run.durationMs !== undefined && ` · took ${run.durationMs < 1000 ? 'under a second' : clock(run.durationMs)}`}
              </p>
              {(run.headline ?? run.reason) && <p className="mt-0.5 text-ink">{run.headline ?? run.reason}</p>}
            </div>
            {readable && (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Read what happened"
                aria-label="Read what happened"
                onClick={() => void readTaskTranscript(run.sessionId!).then((items) => items && setReading({ at: run.at, items }))}
              >
                <ScrollText className="size-3.5" />
              </Button>
            )}
          </div>
        );
      })}
      <p className="px-1 text-[11px] text-ink-faint">The last three runs keep their full transcript; older ones keep their result.</p>
    </div>
  );
}
