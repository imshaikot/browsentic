import { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  Clapperboard,
  Eye,
  Globe,
  History,
  MessageSquareText,
  Pencil,
  Play,
  SkipForward,
  Square,
  X,
  type LucideIcon,
} from 'lucide-react';
import { describeMoment, describeRule } from '@/lib/schedules/rule';
import type { RunOutcome, ScheduledTask, TaskRun } from '@/lib/schedules/task';
import { hostnameOf } from '@/lib/skills/format';
import { Switch } from '@/extension/components/ui/switch';
import { cn } from '@/lib/utils';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const OUTCOMES: Record<RunOutcome, { icon: LucideIcon; tone: string; words: string }> = {
  ok: { icon: Check, tone: 'text-lime', words: 'Done' },
  failed: { icon: X, tone: 'text-destructive', words: 'Failed' },
  missed: { icon: Ban, tone: 'text-amber', words: 'Missed' },
  skipped: { icon: SkipForward, tone: 'text-ink-faint', words: 'Skipped' },
  cancelled: { icon: Square, tone: 'text-ink-faint', words: 'Stopped' },
};

export function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function until(at: number, now: number): string {
  const left = at - now;
  if (left < MINUTE) return 'in under a minute';
  if (left < HOUR) return `in ${Math.ceil(left / MINUTE)} min`;
  if (left < DAY) return `in ${Math.floor(left / HOUR)}h ${Math.floor((left % HOUR) / MINUTE)}m`;
  if (left < 7 * DAY) return `in ${Math.floor(left / DAY)}d ${Math.floor((left % DAY) / HOUR)}h`;
  return `in ${Math.round(left / DAY)} days`;
}

export function ago(at: number, now: number): string {
  const past = now - at;
  if (past < MINUTE) return 'just now';
  if (past < HOUR) return `${Math.floor(past / MINUTE)} min ago`;
  if (past < DAY) return `${Math.floor(past / HOUR)}h ago`;
  return `${Math.floor(past / DAY)}d ago`;
}

export const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const compact = (count: number) => (count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));

export function TaskCard({
  task,
  runningSince,
  paused,
  connected,
  onToggle,
  onRunNow,
  onEdit,
  onHistory,
  onWatch,
  onStop,
}: {
  task: ScheduledTask;
  runningSince?: number;
  paused: boolean;
  connected: boolean;
  onToggle: (enabled: boolean) => void;
  onRunNow: () => void;
  onEdit: () => void;
  onHistory: () => void;
  onWatch?: () => void;
  onStop?: () => void;
}) {
  const now = useNow(runningSince ? 1_000 : 30_000);
  const Icon = task.job.kind === 'recording' ? Clapperboard : MessageSquareText;
  const [last] = task.runs;

  return (
    <div
      className={cn(
        'rounded-xl border px-2.5 py-2 text-xs transition-colors',
        runningSince ? 'border-brand/40 bg-brand/6' : 'border-line bg-ground/40',
        !task.enabled && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-faint" />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onEdit} className="max-w-full truncate text-left font-medium text-ink hover:text-brand">
            {task.name}
          </button>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[10px] text-ink-faint">
            <Globe className="size-2.5 shrink-0" />
            <span className="truncate">
              {hostnameOf(task.url)} · {describeRule(task.rule)}
            </span>
          </span>

          <p className="mt-1 text-[11px]">
            {runningSince ? (
              <span className="flex items-center gap-1.5 text-brand">
                <span className="glow-dot size-1.5 animate-pulse rounded-full bg-brand" />
                Running · {clock(now - runningSince)}
              </span>
            ) : !task.enabled ? (
              <span className="text-ink-faint">Paused</span>
            ) : paused ? (
              <span className="text-amber">Held — every task is paused</span>
            ) : task.nextRunAt ? (
              <span className="text-ink-dim">
                Next {until(task.nextRunAt, now)} <span className="text-ink-faint">· {describeMoment(task.nextRunAt)}</span>
              </span>
            ) : (
              <span className="text-ink-faint">No more runs</span>
            )}
          </p>

          {last && <LastRun run={last} now={now} />}
        </div>
        <Switch
          checked={task.enabled}
          disabled={!connected}
          onChange={onToggle}
          label={task.enabled ? `Pause ${task.name}` : `Resume ${task.name}`}
          className="mt-0.5"
        />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1 pl-5.5">
        {runningSince ? (
          <>
            {onWatch && (
              <Action icon={Eye} onClick={onWatch}>
                Watch
              </Action>
            )}
            {onStop && (
              <Action icon={Square} onClick={onStop}>
                Stop
              </Action>
            )}
          </>
        ) : (
          <Action icon={Play} onClick={onRunNow} disabled={!connected} title="Run it once now, in a background tab">
            Run now
          </Action>
        )}
        <Action icon={History} onClick={onHistory} disabled={!task.runs.length}>
          History{task.runs.length ? ` · ${task.runs.length}` : ''}
        </Action>
        <Action icon={Pencil} onClick={onEdit}>
          Edit
        </Action>
      </div>
    </div>
  );
}

export function LastRun({ run, now }: { run: TaskRun; now: number }) {
  const { icon: Icon, tone, words } = OUTCOMES[run.outcome];
  const said = run.headline ?? run.reason;
  return (
    <p className="mt-0.5 flex min-w-0 items-start gap-1 text-[11px] text-ink-dim">
      <Icon className={cn('mt-0.5 size-3 shrink-0', tone)} />
      <span className="line-clamp-2 min-w-0">
        <span className="text-ink-faint">
          {words} {ago(run.at, now)}
          {said ? ' — ' : ''}
        </span>
        {said}
        {run.usage && <span className="text-ink-faint"> · {compact(run.usage.contextTokens)} context</span>}
      </span>
    </p>
  );
}

function Action({
  icon: Icon,
  onClick,
  disabled,
  title,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-ink-dim transition-colors hover:bg-surface hover:text-ink disabled:opacity-40"
    >
      <Icon className="size-3" />
      {children}
    </button>
  );
}
