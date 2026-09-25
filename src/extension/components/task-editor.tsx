import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clapperboard, Loader2, MessageSquareText, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/extension/components/ui/button';
import { Input } from '@/extension/components/ui/input';
import { Switch } from '@/extension/components/ui/switch';
import { Textarea } from '@/extension/components/ui/textarea';
import { readRecordingBody, type StoredRecordingMeta } from '@/lib/bridge/recording-store';
import { isSecretVariable, variablesNeeded } from '@/lib/recordings/replay';
import type { RecordingVariable } from '@/lib/recordings/workflow';
import {
  DAY_NAMES,
  WEEKDAYS,
  WORKDAYS,
  describeMoment,
  upcoming,
  type ScheduleRule,
  type Weekday,
} from '@/lib/schedules/rule';
import {
  MAX_TIMES_PER_DAY,
  MIN_EVERY_MINUTES,
  validateRule,
  validateTask,
  type MissedPolicy,
  type NotifyPolicy,
  type ScheduledTask,
} from '@/lib/schedules/task';
import { cn } from '@/lib/utils';

export interface TaskSeed {
  name?: string;
  text?: string;
  recordingId?: string;
  url?: string;
}

type Mode = 'once' | 'every' | 'weekly';
type Stop = 'never' | 'after' | 'until';

interface Form {
  id?: string;
  name: string;
  kind: 'instruction' | 'recording';
  text: string;
  recordingId: string;
  variables: Record<string, string>;
  url: string;
  mode: Mode;
  onceAt: string;
  every: number;
  everyUnit: 'min' | 'h';
  windowOn: boolean;
  windowFrom: string;
  windowTo: string;
  days: Weekday[];
  times: string[];
  missed: MissedPolicy;
  notify: NotifyPolicy;
  keepTab: boolean;
  stop: Stop;
  maxRuns: number;
  until: string;
  enabled: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const BUSY_WEEK = 50;

const pad = (value: number) => String(value).padStart(2, '0');
const dateInput = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const dateTimeInput = (at: number) => {
  const date = new Date(at);
  return `${dateInput(at)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const atClock = (dayOffset: number, hours: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hours).getTime();
};

const nameFrom = (text: string) => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
};

function blankForm(seed: TaskSeed | undefined, tabUrl: string, recordings: StoredRecordingMeta[]): Form {
  const recording = recordings.find((candidate) => candidate.id === seed?.recordingId);
  const text = seed?.text ?? '';
  return {
    name: seed?.name ?? recording?.name ?? nameFrom(text),
    kind: recording ? 'recording' : 'instruction',
    text,
    recordingId: recording?.id ?? '',
    variables: {},
    url: seed?.url ?? recording?.startUrl ?? (/^https?:/.test(tabUrl) ? tabUrl : ''),
    mode: 'weekly',
    onceAt: dateTimeInput(atClock(1, 9)),
    every: 3,
    everyUnit: 'h',
    windowOn: false,
    windowFrom: '08:00',
    windowTo: '22:00',
    days: [...WORKDAYS],
    times: ['09:00'],
    missed: 'runOnce',
    notify: 'always',
    keepTab: false,
    stop: 'never',
    maxRuns: 10,
    until: dateInput(Date.now() + 30 * DAY),
    enabled: true,
  };
}

function formOf(task: ScheduledTask, fallback: Form): Form {
  const { rule, job } = task;
  const everyInHours = rule.kind === 'every' && rule.minutes % 60 === 0;
  return {
    ...fallback,
    id: task.id,
    name: task.name,
    kind: job.kind,
    text: job.kind === 'instruction' ? job.text : '',
    recordingId: job.kind === 'recording' ? job.recordingId : '',
    variables: job.kind === 'recording' ? (job.variables ?? {}) : {},
    url: task.url,
    mode: rule.kind,
    ...(rule.kind === 'once' ? { onceAt: dateTimeInput(rule.at) } : {}),
    ...(rule.kind === 'every'
      ? {
          every: everyInHours ? rule.minutes / 60 : rule.minutes,
          everyUnit: everyInHours ? 'h' : 'min',
          windowOn: !!rule.window,
          windowFrom: rule.window?.from ?? fallback.windowFrom,
          windowTo: rule.window?.to ?? fallback.windowTo,
        }
      : {}),
    ...(rule.kind === 'weekly' ? { days: rule.days, times: rule.times } : {}),
    missed: task.missed,
    notify: task.notify,
    keepTab: task.keepTab,
    stop: task.maxRuns !== undefined ? 'after' : task.until !== undefined ? 'until' : 'never',
    maxRuns: task.maxRuns ?? fallback.maxRuns,
    until: task.until !== undefined ? dateInput(task.until) : fallback.until,
    enabled: task.enabled,
  };
}

function ruleOf(form: Form): ScheduleRule {
  if (form.mode === 'once') return { kind: 'once', at: new Date(form.onceAt).getTime() };
  if (form.mode === 'every') {
    const minutes = Math.round(form.every * (form.everyUnit === 'h' ? 60 : 1));
    return form.windowOn ? { kind: 'every', minutes, window: { from: form.windowFrom, to: form.windowTo } } : { kind: 'every', minutes };
  }
  return { kind: 'weekly', days: form.days, times: form.times };
}

function draftOf(form: Form, recordingName: string): unknown {
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name,
    job:
      form.kind === 'instruction'
        ? { kind: 'instruction', text: form.text }
        : { kind: 'recording', recordingId: form.recordingId, name: recordingName, variables: form.variables },
    url: form.url.trim(),
    rule: ruleOf(form),
    missed: form.missed,
    notify: form.notify,
    keepTab: form.keepTab,
    ...(form.stop === 'after' ? { maxRuns: form.maxRuns } : {}),
    ...(form.stop === 'until' && form.until ? { until: new Date(`${form.until}T23:59`).getTime() } : {}),
    enabled: form.enabled,
  };
}

export function TaskEditor({
  task,
  seed,
  tabUrl,
  recordings,
  connected,
  onSave,
  onCancel,
  onDelete,
}: {
  task?: ScheduledTask;
  seed?: TaskSeed;
  tabUrl: string;
  recordings: StoredRecordingMeta[];
  connected: boolean;
  onSave: (draft: unknown) => Promise<string | null>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const ready = useMemo(() => recordings.filter((recording) => recording.status === 'ready'), [recordings]);
  const [form, setForm] = useState<Form>(() => {
    const blank = blankForm(seed, tabUrl, ready);
    return task ? formOf(task, blank) : blank;
  });
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [needed, setNeeded] = useState<RecordingVariable[]>([]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  const recording = ready.find((candidate) => candidate.id === form.recordingId);

  useEffect(() => {
    if (form.kind !== 'recording' || !form.recordingId) return setNeeded([]);
    let live = true;
    void readRecordingBody(form.recordingId).then((body) => {
      if (live) setNeeded(body?.workflow ? variablesNeeded(body.workflow) : []);
    });
    return () => {
      live = false;
    };
  }, [form.kind, form.recordingId]);

  const now = Date.now();
  const checked = validateTask(draftOf(form, recording?.name ?? ''), now);
  const secret = needed.find(isSecretVariable);
  const rule = validateRule(ruleOf(form), now);
  const preview = typeof rule === 'string' ? [] : upcoming(rule, now, 3);
  const perWeek =
    typeof rule !== 'string' && form.kind === 'instruction' && rule.kind !== 'once'
      ? upcoming(rule, now, 500).filter((at) => at < now + 7 * DAY).length
      : 0;
  const problem = secret
    ? `“${secret.field}” is a secret, and a schedule does not hold secrets. Schedule an instruction instead.`
    : checked.ok
      ? null
      : checked.message;

  async function save() {
    setAttempted(true);
    if (problem || !checked.ok) return;
    setSaving(true);
    setRefused(await onSave(draftOf(form, recording?.name ?? '')));
    setSaving(false);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-medium text-ink">{task ? 'Edit task' : 'New scheduled task'}</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close without saving" onClick={onCancel}>
          <X className="size-3.5" />
        </Button>
      </div>

      <Field label="Name">
        <Input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="PR digest"
          aria-invalid={attempted && !form.name.trim()}
          className="h-8 text-xs"
        />
      </Field>

      <Field label="What it does">
        <div className="flex gap-1.5">
          <Chip active={form.kind === 'instruction'} onClick={() => set('kind', 'instruction')}>
            <MessageSquareText className="size-3" /> Instruction
          </Chip>
          <Chip
            active={form.kind === 'recording'}
            onClick={() => set('kind', 'recording')}
            disabled={!ready.length}
            title={ready.length ? undefined : 'Record a flow first, in the Recordings tab'}
          >
            <Clapperboard className="size-3" /> Recording
          </Chip>
        </div>
        {form.kind === 'instruction' ? (
          <Textarea
            value={form.text}
            onChange={(e) => {
              const text = e.target.value;
              setForm((current) => ({
                ...current,
                text,
                name: !current.name || current.name === nameFrom(current.text) ? nameFrom(text) : current.name,
              }));
            }}
            placeholder="Summarise the pull requests waiting on my review."
            className="mt-1.5 text-xs"
          />
        ) : (
          <div className="mt-1.5 flex flex-col gap-1.5">
            {ready.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    recordingId: candidate.id,
                    variables: {},
                    url: current.url || candidate.startUrl,
                    name: current.name || candidate.name,
                  }))
                }
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                  candidate.id === form.recordingId ? 'border-brand/50 bg-brand/10 text-ink' : 'border-line text-ink-dim hover:bg-surface/60',
                )}
              >
                <Clapperboard className="size-3 shrink-0" />
                <span className="truncate">{candidate.name}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-faint">{candidate.steps ?? 0} steps</span>
              </button>
            ))}
            {needed.map((variable) => (
              <label key={variable.name} className="flex flex-col gap-1 text-[11px] text-ink-dim">
                {variable.field}
                <Input
                  value={form.variables[variable.name] ?? ''}
                  disabled={isSecretVariable(variable)}
                  onChange={(e) => set('variables', { ...form.variables, [variable.name]: e.target.value })}
                  className="h-8 text-xs"
                />
              </label>
            ))}
            {form.recordingId && (
              <p className="text-[11px] leading-relaxed text-ink-faint">
                Replayed step by step with no agent and no tokens. If a step no longer fits the page, the agent takes over
                from there.
              </p>
            )}
          </div>
        )}
      </Field>

      <Field label="Starts on">
        <Input
          value={form.url}
          onChange={(e) => set('url', e.target.value)}
          placeholder="https://github.com/pulls"
          inputMode="url"
          className="h-8 font-mono text-[11px]"
        />
      </Field>

      <Field label="When">
        <div className="flex gap-1.5">
          <Chip active={form.mode === 'once'} onClick={() => set('mode', 'once')}>
            Once
          </Chip>
          <Chip active={form.mode === 'weekly'} onClick={() => set('mode', 'weekly')}>
            On days
          </Chip>
          <Chip active={form.mode === 'every'} onClick={() => set('mode', 'every')}>
            Every…
          </Chip>
        </div>

        {form.mode === 'once' && (
          <div className="mt-2 flex flex-col gap-1.5">
            <Input
              type="datetime-local"
              value={form.onceAt}
              onChange={(e) => set('onceAt', e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex flex-wrap gap-1.5">
              <Chip onClick={() => set('onceAt', dateTimeInput(Date.now() + HOUR))}>In an hour</Chip>
              <Chip onClick={() => set('onceAt', dateTimeInput(atClock(0, 20)))}>Tonight 20:00</Chip>
              <Chip onClick={() => set('onceAt', dateTimeInput(atClock(1, 9)))}>Tomorrow 09:00</Chip>
            </div>
          </div>
        )}

        {form.mode === 'weekly' && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((day) => (
                <Chip
                  key={day}
                  active={form.days.includes(day)}
                  onClick={() =>
                    set('days', form.days.includes(day) ? form.days.filter((kept) => kept !== day) : [...form.days, day])
                  }
                  className="w-10 justify-center"
                >
                  {DAY_NAMES[day]}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip onClick={() => set('days', [...WEEKDAYS])}>Every day</Chip>
              <Chip onClick={() => set('days', [...WORKDAYS])}>Weekdays</Chip>
              <Chip onClick={() => set('days', [6, 0])}>Weekends</Chip>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {form.times.map((time, index) => (
                <span key={index} className="flex items-center gap-0.5">
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => set('times', form.times.map((kept, at) => (at === index ? e.target.value : kept)))}
                    className="h-8 w-[6.5rem] text-xs"
                  />
                  {form.times.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove ${time}`}
                      onClick={() => set('times', form.times.filter((_, at) => at !== index))}
                      className="rounded-full p-1 text-ink-faint hover:bg-surface hover:text-ink"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
              {form.times.length < MAX_TIMES_PER_DAY && (
                <Chip onClick={() => set('times', [...form.times, '17:00'])}>
                  <Plus className="size-3" /> Time
                </Chip>
              )}
            </div>
          </div>
        )}

        {form.mode === 'every' && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={1}
                value={form.every}
                onChange={(e) => set('every', Number(e.target.value))}
                className="h-8 w-20 text-xs"
              />
              <Chip active={form.everyUnit === 'min'} onClick={() => set('everyUnit', 'min')}>
                minutes
              </Chip>
              <Chip active={form.everyUnit === 'h'} onClick={() => set('everyUnit', 'h')}>
                hours
              </Chip>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-ink-dim">
              <Switch checked={form.windowOn} onChange={(on) => set('windowOn', on)} label="Only between set times" />
              Only between
              <Input
                type="time"
                value={form.windowFrom}
                disabled={!form.windowOn}
                onChange={(e) => set('windowFrom', e.target.value)}
                className="h-7 w-[6.5rem] text-xs"
              />
              and
              <Input
                type="time"
                value={form.windowTo}
                disabled={!form.windowOn}
                onChange={(e) => set('windowTo', e.target.value)}
                className="h-7 w-[6.5rem] text-xs"
              />
            </label>
            <p className="text-[11px] text-ink-faint">At most every {MIN_EVERY_MINUTES} minutes.</p>
          </div>
        )}
      </Field>

      <Field label="Afterwards">
        <Choice
          label="Tell me"
          value={form.notify}
          options={[
            ['always', 'Every run'],
            ['failure', 'Only when it fails'],
            ['never', 'Never'],
          ]}
          onChange={(value) => set('notify', value)}
        />
        <Choice
          label="If a run is missed"
          value={form.missed}
          options={[
            ['runOnce', 'Run once when back'],
            ['skip', 'Skip it'],
          ]}
          onChange={(value) => set('missed', value)}
        />
        <Choice
          label="Stop"
          value={form.stop}
          options={[
            ['never', 'Never'],
            ['after', 'After some runs'],
            ['until', 'On a date'],
          ]}
          onChange={(value) => set('stop', value)}
        />
        {form.stop === 'after' && (
          <div className="flex items-center gap-1.5 text-[11px] text-ink-dim">
            After
            <Input
              type="number"
              min={1}
              value={form.maxRuns}
              onChange={(e) => set('maxRuns', Number(e.target.value))}
              className="h-7 w-20 text-xs"
            />
            runs{task?.runCount ? ` · ${task.runCount} so far` : ''}
          </div>
        )}
        {form.stop === 'until' && (
          <Input type="date" value={form.until} onChange={(e) => set('until', e.target.value)} className="h-8 w-40 text-xs" />
        )}
        <label className="mt-1 flex items-center gap-2 text-[11px] text-ink-dim">
          <Switch checked={form.keepTab} onChange={(on) => set('keepTab', on)} label="Keep the tab open afterwards" />
          Keep the tab open afterwards, to carry on the conversation
        </label>
      </Field>

      <div className="rounded-xl border border-line bg-ground/40 px-2.5 py-2 text-[11px] leading-relaxed">
        {typeof rule === 'string' ? (
          <p className="text-amber">{rule}</p>
        ) : (
          <p className="text-ink-dim">
            <span className="text-ink-faint">Next: </span>
            {preview.map(describeMoment).join(' · ')}
          </p>
        )}
        {perWeek > 0 && (
          <p className={cn('mt-0.5', perWeek > BUSY_WEEK ? 'text-amber' : 'text-ink-faint')}>
            About {perWeek} agent {perWeek === 1 ? 'run' : 'runs'} a week — each one spends tokens.
          </p>
        )}
        <p className="mt-0.5 text-ink-faint">Runs only while this browser is open, in a background tab that closes when it is done.</p>
      </div>

      {(attempted && problem) || refused ? (
        <p className="text-[11px] text-destructive">{refused ?? problem}</p>
      ) : null}

      <div className="flex items-center gap-2">
        {onDelete && (
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-ink-faint hover:text-destructive">
            <Trash2 /> Delete
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel} className="ml-auto">
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={saving || !connected}>
          {saving && <Loader2 className="animate-spin" />}
          {task ? 'Save' : 'Schedule it'}
        </Button>
      </div>
      {!connected && <p className="text-right text-[11px] text-ink-faint">The daemon keeps the schedule — connect it to save.</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  disabled,
  title,
  className,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-45',
        active ? 'border-brand/50 bg-brand/12 text-brand' : 'border-line text-ink-dim hover:bg-surface/60 hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-full text-[11px] text-ink-dim">{label}</span>
      {options.map(([option, words]) => (
        <Chip key={option} active={value === option} onClick={() => onChange(option)}>
          {words}
        </Chip>
      ))}
    </div>
  );
}
