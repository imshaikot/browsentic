import type { TokenUsage } from '@/lib/actions/protocol';
import { isClockTime, isWeekday, nextAfter, type ScheduleRule, type Weekday } from './rule';

export const MAX_TASKS = 25;
export const MIN_EVERY_MINUTES = 5;
export const MAX_EVERY_MINUTES = 7 * 24 * 60;
export const MAX_TIMES_PER_DAY = 12;
export const MAX_RUNS_KEPT = 20;
export const MAX_TASK_RUNS = 1_000;
export const MAX_TASK_NAME = 80;
export const MAX_INSTRUCTION_CHARS = 2_000;
export const MAX_VARIABLES = 20;
export const MAX_VARIABLE_CHARS = 200;
export const MAX_HEADLINE_CHARS = 240;
export const TASK_APPROVAL_WAIT_MS = 10 * 60_000;
export const TASK_RUN_MAX_MS = 20 * 60_000;

export type TaskJob =
  | { kind: 'instruction'; text: string }
  | { kind: 'recording'; recordingId: string; name: string; variables?: Record<string, string> };

export type MissedPolicy = 'runOnce' | 'skip';

export type NotifyPolicy = 'always' | 'failure' | 'never';

export type RunOutcome = 'ok' | 'failed' | 'missed' | 'skipped' | 'cancelled';

export interface TaskRun {
  at: number;
  outcome: RunOutcome;
  reason?: string;
  headline?: string;
  durationMs?: number;
  usage?: TokenUsage;
  sessionId?: string;
}

export interface TaskDraft {
  id?: string;
  name: string;
  job: TaskJob;
  url: string;
  browser?: string;
  rule: ScheduleRule;
  missed: MissedPolicy;
  notify: NotifyPolicy;
  keepTab: boolean;
  maxRuns?: number;
  until?: number;
  enabled: boolean;
}

export interface ScheduledTask extends Omit<TaskDraft, 'id'> {
  id: string;
  nextRunAt: number | null;
  createdAt: number;
  runCount: number;
  runs: TaskRun[];
}

export interface TaskList {
  paused: boolean;
  tasks: ScheduledTask[];
  running: Record<string, number>;
}

export interface TaskOrder {
  id: string;
  name: string;
  job: TaskJob;
  url: string;
  keepTab: boolean;
  notify: NotifyPolicy;
  previous?: string;
}

export interface TaskContext {
  id: string;
  name: string;
  previous?: string;
}

export type TaskResult = Omit<TaskRun, 'at'>;

export const EMPTY_TASK_LIST: TaskList = { paused: false, tasks: [], running: {} };

export type TaskValidation = { ok: true; draft: TaskDraft } | { ok: false; field: string; message: string };

const MISSED: readonly MissedPolicy[] = ['runOnce', 'skip'];
const NOTIFY: readonly NotifyPolicy[] = ['always', 'failure', 'never'];

const invalid = (field: string, message: string): TaskValidation => ({ ok: false, field, message });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function isWebUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function checkJob(raw: unknown): TaskJob | string {
  if (!isRecord(raw)) return 'Say what the task should do.';
  if (raw.kind === 'instruction') {
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (!text) return 'Write the instruction the agent should follow.';
    if (text.length > MAX_INSTRUCTION_CHARS) return `Keep the instruction under ${MAX_INSTRUCTION_CHARS} characters.`;
    return { kind: 'instruction', text };
  }
  if (raw.kind === 'recording') {
    if (typeof raw.recordingId !== 'string' || !raw.recordingId) return 'Pick the recording to replay.';
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_TASK_NAME) : '';
    const entries = isRecord(raw.variables) ? Object.entries(raw.variables) : [];
    if (entries.length > MAX_VARIABLES) return `A recording takes at most ${MAX_VARIABLES} values.`;
    if (entries.some(([, value]) => typeof value !== 'string' || value.length > MAX_VARIABLE_CHARS)) {
      return `Each value the recording needs is text of at most ${MAX_VARIABLE_CHARS} characters.`;
    }
    const variables = Object.fromEntries(entries) as Record<string, string>;
    return { kind: 'recording', recordingId: raw.recordingId, name, ...(entries.length ? { variables } : {}) };
  }
  return 'A task either follows an instruction or replays a recording.';
}

export function validateRule(raw: unknown, now: number): ScheduleRule | string {
  if (!isRecord(raw)) return 'Say when the task should run.';
  if (raw.kind === 'once') {
    if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return 'Pick the date and time to run it.';
    if (raw.at <= now) return 'That time has already passed.';
    return { kind: 'once', at: raw.at };
  }
  if (raw.kind === 'every') {
    const minutes = raw.minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes)) return 'Say how often to repeat it.';
    if (minutes < MIN_EVERY_MINUTES) return `Repeat it at most every ${MIN_EVERY_MINUTES} minutes.`;
    if (minutes > MAX_EVERY_MINUTES) return 'Repeat it at least once a week.';
    if (raw.window === undefined) return { kind: 'every', minutes };
    const window = raw.window;
    if (!isRecord(window) || !isClockTime(window.from) || !isClockTime(window.to)) {
      return 'Give the window as two times, like 08:00 and 22:00.';
    }
    if (window.from === window.to) return 'The window has to start and end at different times.';
    return { kind: 'every', minutes, window: { from: window.from, to: window.to } };
  }
  if (raw.kind === 'weekly') {
    const days = Array.isArray(raw.days) ? [...new Set(raw.days)] : [];
    if (!days.length || !days.every(isWeekday)) return 'Pick at least one day.';
    const times = Array.isArray(raw.times) ? [...new Set(raw.times)] : [];
    if (!times.length || !times.every(isClockTime)) return 'Give at least one time, like 09:00.';
    if (times.length > MAX_TIMES_PER_DAY) return `Pick at most ${MAX_TIMES_PER_DAY} times a day.`;
    return { kind: 'weekly', days: (days as Weekday[]).sort(), times: (times as string[]).sort() };
  }
  return 'A task runs once, every so often, or on set days.';
}

export function validateTask(input: unknown, now: number): TaskValidation {
  if (!isRecord(input)) return invalid('task', 'Nothing to save.');

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return invalid('name', 'Give the task a name.');
  if (name.length > MAX_TASK_NAME) return invalid('name', `Keep the name under ${MAX_TASK_NAME} characters.`);

  const job = checkJob(input.job);
  if (typeof job === 'string') return invalid('job', job);

  if (!isWebUrl(input.url)) return invalid('url', 'Start it on a web page — an http or https address.');

  const rule = validateRule(input.rule, now);
  if (typeof rule === 'string') return invalid('rule', rule);

  const missed = MISSED.includes(input.missed as MissedPolicy) ? (input.missed as MissedPolicy) : 'runOnce';
  const notify = NOTIFY.includes(input.notify as NotifyPolicy) ? (input.notify as NotifyPolicy) : 'always';

  const maxRuns = input.maxRuns;
  if (maxRuns !== undefined && (typeof maxRuns !== 'number' || !Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > MAX_TASK_RUNS)) {
    return invalid('maxRuns', `Stop after between 1 and ${MAX_TASK_RUNS} runs.`);
  }
  const until = input.until;
  if (until !== undefined && (typeof until !== 'number' || until <= now)) {
    return invalid('until', 'The end date has already passed.');
  }
  if (input.browser !== undefined && typeof input.browser !== 'string') return invalid('browser', 'Pick a browser.');

  return {
    ok: true,
    draft: {
      ...(typeof input.id === 'string' && input.id ? { id: input.id } : {}),
      name,
      job,
      url: input.url,
      ...(typeof input.browser === 'string' && input.browser ? { browser: input.browser } : {}),
      rule,
      missed,
      notify,
      keepTab: input.keepTab === true,
      ...(maxRuns !== undefined ? { maxRuns } : {}),
      ...(until !== undefined ? { until } : {}),
      enabled: input.enabled !== false,
    },
  };
}

export function nextRunFor(
  task: Pick<ScheduledTask, 'rule' | 'enabled' | 'until' | 'maxRuns' | 'runCount'>,
  after: number,
): number | null {
  if (!task.enabled) return null;
  if (task.maxRuns !== undefined && task.runCount >= task.maxRuns) return null;
  const next = nextAfter(task.rule, after);
  if (next === null) return null;
  return task.until !== undefined && next > task.until ? null : next;
}

export const orderFor = (task: ScheduledTask): TaskOrder => ({
  id: task.id,
  name: task.name,
  job: task.job,
  url: task.url,
  keepTab: task.keepTab,
  notify: task.notify,
  previous: task.runs.find((run) => run.outcome === 'ok' && run.headline)?.headline,
});

export function headlineOf(text: string): string | undefined {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[#>]+|[-*+]|\d+\.)\s+/, '').replace(/\*\*|__|`/g, '').trim())
    .filter(Boolean);
  const last = lines.at(-1);
  if (!last) return undefined;
  return last.length > MAX_HEADLINE_CHARS ? `${last.slice(0, MAX_HEADLINE_CHARS - 1)}…` : last;
}
