import { useEffect, useState } from 'react';
import { CalendarClock, Plus, WifiOff } from 'lucide-react';
import { browser } from 'wxt/browser';
import { Button } from '@/extension/components/ui/button';
import { Switch } from '@/extension/components/ui/switch';
import { TaskCard, until, useNow } from '@/extension/components/task-card';
import { TaskEditor, type TaskSeed } from '@/extension/components/task-editor';
import { TaskRuns } from '@/extension/components/task-runs';
import type { StoredRecordingMeta } from '@/lib/bridge/recording-store';
import type { TabSession } from '@/lib/bridge/tab-sessions';
import { askTasks, type TaskRequest } from '@/lib/bridge/task-client';
import { dropTaskTranscripts } from '@/lib/bridge/task-run-store';
import type { ScheduledTask, TaskList } from '@/lib/schedules/task';

type View = { kind: 'list' } | { kind: 'edit'; task?: ScheduledTask; seed?: TaskSeed } | { kind: 'runs'; taskId: string };

export function TaskPanel({
  tasks,
  connected,
  paired,
  tabUrl,
  recordings,
  sessions,
  seed,
  onSeedTaken,
  onWatch,
}: {
  tasks: TaskList | null;
  connected: boolean;
  paired: boolean;
  tabUrl: string;
  recordings: StoredRecordingMeta[];
  sessions: TabSession[];
  seed: TaskSeed | null;
  onSeedTaken: () => void;
  onWatch: (sessionId: string) => void;
}) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  const now = useNow(30_000);

  useEffect(() => {
    if (!seed) return;
    setView({ kind: 'edit', seed });
    onSeedTaken();
  }, [seed, onSeedTaken]);

  useEffect(() => {
    if (connected) void askTasks({ op: 'tasks' });
  }, [connected]);

  async function ask(request: TaskRequest): Promise<boolean> {
    setError(null);
    const result = await askTasks(request);
    if (!result.ok) setError(result.error.message);
    return result.ok;
  }

  async function remove(task: ScheduledTask) {
    if (await ask({ op: 'deleteTask', taskId: task.id })) {
      await dropTaskTranscripts(task.id);
      setView({ kind: 'list' });
    }
  }

  const list = tasks?.tasks ?? [];

  if (view.kind === 'edit') {
    return (
      <TaskEditor
        key={view.task?.id ?? 'new'}
        task={view.task}
        seed={view.seed}
        tabUrl={tabUrl}
        recordings={recordings}
        connected={connected}
        onCancel={() => setView({ kind: 'list' })}
        onDelete={view.task ? () => void remove(view.task!) : undefined}
        onSave={async (draft) => {
          const result = await askTasks({ op: 'saveTask', task: draft });
          if (!result.ok) return result.error.message;
          setView({ kind: 'list' });
          return null;
        }}
      />
    );
  }

  const shown = view.kind === 'runs' ? list.find((task) => task.id === view.taskId) : undefined;
  if (shown) return <TaskRuns task={shown} onBack={() => setView({ kind: 'list' })} />;

  const upcoming = tasks?.paused
    ? undefined
    : list
        .filter((task) => task.enabled && task.nextRunAt !== null)
        .sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0];

  if (!paired) {
    return (
      <div className="p-3">
        <Empty>
          Pair the browser first. The daemon keeps the schedule, so it can say when a run was missed even while this
          browser was closed.
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      <p className="text-[11px] leading-relaxed text-ink-dim">
        Run an instruction or a recording later, or on repeat. Each run opens its own background tab, does the work and
        closes it — you get the result as a notice.
      </p>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setView({ kind: 'edit' })} disabled={!connected}>
          <Plus /> New task
        </Button>
        {list.length > 0 && (
          <label className="ml-auto flex items-center gap-2 text-[11px] text-ink-dim">
            Pause all
            <Switch
              checked={tasks?.paused ?? false}
              disabled={!connected}
              onChange={(paused) => void ask({ op: 'pauseTasks', paused })}
              label="Pause every scheduled task"
            />
          </label>
        )}
      </div>

      {!connected && (
        <div className="flex items-start gap-2 rounded-xl border border-amber/40 bg-amber/8 px-2.5 py-2 text-[11px] leading-relaxed text-ink-dim">
          <WifiOff className="mt-0.5 size-3.5 shrink-0 text-amber" />
          The daemon keeps the schedule and is not connected, so nothing runs and this is the last list it sent.
        </div>
      )}

      {upcoming && (
        <p className="px-1 text-[11px] text-ink-faint">
          Next up: <span className="text-ink-dim">{upcoming.name}</span> {until(upcoming.nextRunAt!, now)}
        </p>
      )}

      {error && <p className="px-1 text-[11px] text-destructive">{error}</p>}

      {list.length === 0 ? (
        <Empty>
          Nothing scheduled yet. Turn on the clock beside the message box to schedule what you type, or start one here.
        </Empty>
      ) : (
        list.map((task) => {
          const session = sessions.find((candidate) => candidate.task?.id === task.id);
          return (
            <TaskCard
              key={task.id}
              task={task}
              runningSince={tasks?.running[task.id]}
              paused={tasks?.paused ?? false}
              connected={connected}
              onToggle={(enabled) => void ask({ op: 'saveTask', task: { ...task, enabled } })}
              onRunNow={() => void ask({ op: 'runTaskNow', taskId: task.id })}
              onEdit={() => setView({ kind: 'edit', task })}
              onHistory={() => setView({ kind: 'runs', taskId: task.id })}
              onWatch={session ? () => onWatch(session.sessionId) : undefined}
              onStop={session ? () => void browser.tabs.remove(session.tabIds).catch(() => undefined) : undefined}
            />
          );
        })
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="dot-grid fade-bottom rounded-xl border border-line px-3 py-6 text-center">
      <CalendarClock className="mx-auto size-5 text-ink-faint" />
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{children}</p>
    </div>
  );
}
