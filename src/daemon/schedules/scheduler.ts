import { randomUUID } from 'node:crypto';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import { nextAfter } from '@/lib/schedules/rule';
import {
  MAX_TASKS,
  TASK_RUN_MAX_MS,
  nextRunFor,
  orderFor,
  validateTask,
  type ScheduledTask,
  type TaskList,
  type TaskOrder,
  type TaskResult,
  type TaskRun,
} from '@/lib/schedules/task';
import { log } from '../log';
import { logRun, readSchedules, setPaused, updateSchedules } from './store';

export const CLOCK_MAX_WAIT_MS = 60_000;
export const FIRST_WAKE_MS = 15_000;
export const LATE_AFTER_MS = 2 * CLOCK_MAX_WAIT_MS;
export const REPORT_GRACE_MS = 5 * 60_000;
const MAX_MISSED_COUNTED = 1_000;

export interface TaskLink {
  readonly id: string;
  readonly label: string;
  runTask(order: TaskOrder): Promise<ActionResult>;
}

export interface SchedulerDeps {
  linkFor: (browser: string | undefined) => TaskLink | null;
  publish: (list: TaskList) => void;
}

export interface Scheduler {
  list(): TaskList;
  save(input: unknown): ActionResult<TaskList>;
  remove(taskId: string): ActionResult<TaskList>;
  pause(paused: boolean): ActionResult<TaskList>;
  runNow(taskId: string, link: TaskLink): ActionResult<TaskList>;
  finished(taskId: string, result: TaskResult): void;
  linkClosed(linkId: string): void;
  stop(): void;
}

interface InFlight {
  linkId: string;
  startedAt: number;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const notFound = (taskId: string) =>
  failure('TASK_NOT_FOUND', `No scheduled task with id “${taskId}”. It may have been deleted from another browser or the CLI.`);

function countMissed(task: ScheduledTask, now: number): number {
  let count = 0;
  let cursor = task.nextRunAt;
  while (cursor !== null && cursor <= now && count < MAX_MISSED_COUNTED) {
    count += 1;
    cursor = nextAfter(task.rule, cursor);
  }
  return count;
}

export function startScheduler(deps: SchedulerDeps): Scheduler {
  const inFlight = new Map<string, InFlight>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const list = (): TaskList => {
    const { paused, tasks } = readSchedules();
    return { paused, tasks, running: Object.fromEntries([...inFlight].map(([id, { startedAt }]) => [id, startedAt])) };
  };

  let published = '';
  const publish = () => {
    const current = list();
    published = JSON.stringify(current);
    deps.publish(current);
  };

  function arm(wait?: number): void {
    clearTimeout(timer);
    const { paused, tasks } = readSchedules();
    const due = paused ? [] : tasks.flatMap((task) => (task.nextRunAt === null ? [] : [task.nextRunAt]));
    const untilDue = due.length ? Math.max(Math.min(...due) - Date.now(), 0) : CLOCK_MAX_WAIT_MS;
    timer = setTimeout(wake, wait ?? Math.min(untilDue, CLOCK_MAX_WAIT_MS));
    timer.unref();
  }

  function wake(): void {
    const now = Date.now();
    expireSilent(now);
    const { paused, tasks } = readSchedules();
    if (!paused) {
      for (const task of tasks) if (task.nextRunAt !== null && task.nextRunAt <= now) fire(task.id, now);
    }
    if (JSON.stringify(list()) !== published) publish();
    arm();
  }

  function fire(taskId: string, now: number): void {
    const plan = updateSchedules((state) => {
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task || task.nextRunAt === null || task.nextRunAt > now) return null;
      const settle = (run: TaskRun) => {
        logRun(task, run);
        task.nextRunAt = nextRunFor(task, now);
        return null;
      };

      if (now - task.nextRunAt > LATE_AFTER_MS) {
        const missed = plural(countMissed(task, now), 'run');
        const run: TaskRun = {
          at: task.nextRunAt,
          outcome: 'missed',
          reason: `Missed ${missed} while nothing could run it — the computer was asleep, or no daemon was running.`,
        };
        if (task.missed === 'skip') return settle(run);
        logRun(task, run);
      }
      if (inFlight.has(task.id)) return settle({ at: now, outcome: 'skipped', reason: 'The previous run was still going.' });

      const link = deps.linkFor(task.browser);
      if (!link) {
        const reason = task.browser ? 'The browser it runs in was not connected.' : 'No browser was connected.';
        return settle({ at: now, outcome: 'missed', reason });
      }
      task.runCount += 1;
      task.nextRunAt = nextRunFor(task, now);
      inFlight.set(task.id, { linkId: link.id, startedAt: now });
      return { order: orderFor(task), link };
    });
    publish();
    if (plan) void dispatch(plan.order, plan.link);
  }

  async function dispatch(order: TaskOrder, link: TaskLink): Promise<void> {
    log(`task “${order.name}” → ${link.label}`);
    const started = await link.runTask(order);
    if (started.ok) return;
    const flight = inFlight.get(order.id);
    inFlight.delete(order.id);
    log(`task “${order.name}” did not start: ${started.error.code}`);
    record(order.id, {
      at: flight?.startedAt ?? Date.now(),
      outcome: 'failed',
      reason: `${started.error.code}: ${started.error.message}`,
    });
  }

  function record(taskId: string, run: TaskRun): void {
    updateSchedules((state) => {
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (task) logRun(task, run);
    });
    publish();
  }

  function expireSilent(now: number): void {
    for (const [taskId, flight] of inFlight) {
      if (now - flight.startedAt < TASK_RUN_MAX_MS + REPORT_GRACE_MS) continue;
      inFlight.delete(taskId);
      record(taskId, { at: flight.startedAt, outcome: 'failed', reason: 'The run never reported back.' });
    }
  }

  function save(input: unknown): ActionResult<TaskList> {
    const now = Date.now();
    const checked = validateTask(input, now);
    if (!checked.ok) return failure('INVALID_INPUT', checked.message);
    const { id, ...draft } = checked.draft;

    const saved = updateSchedules((state): ActionResult<ScheduledTask> => {
      if (id) {
        const index = state.tasks.findIndex((task) => task.id === id);
        if (index < 0) return notFound(id);
        const { createdAt, runCount, runs } = state.tasks[index];
        const task: ScheduledTask = { ...draft, id, createdAt, runCount, runs, nextRunAt: null };
        task.nextRunAt = nextRunFor(task, now);
        state.tasks[index] = task;
        return success(task);
      }
      if (state.tasks.length >= MAX_TASKS) {
        return failure('TASK_LIMIT', `${MAX_TASKS} tasks are already scheduled — delete one before adding another.`);
      }
      const task: ScheduledTask = { ...draft, id: randomUUID(), createdAt: now, runCount: 0, runs: [], nextRunAt: null };
      task.nextRunAt = nextRunFor(task, now);
      state.tasks.push(task);
      return success(task);
    });
    if (!saved.ok) return saved;
    log(`task “${saved.data.name}” saved${saved.data.nextRunAt ? `; next run ${new Date(saved.data.nextRunAt).toISOString()}` : ''}`);
    arm();
    publish();
    return success(list());
  }

  function remove(taskId: string): ActionResult<TaskList> {
    const removed = updateSchedules((state) => {
      const before = state.tasks.length;
      state.tasks = state.tasks.filter((task) => task.id !== taskId);
      return state.tasks.length < before;
    });
    if (!removed) return notFound(taskId);
    arm();
    publish();
    return success(list());
  }

  function pause(paused: boolean): ActionResult<TaskList> {
    updateSchedules((state) => setPaused(state, paused, Date.now()));
    log(paused ? 'scheduled tasks paused' : 'scheduled tasks resumed');
    arm();
    publish();
    return success(list());
  }

  function runNow(taskId: string, link: TaskLink): ActionResult<TaskList> {
    const task = readSchedules().tasks.find((candidate) => candidate.id === taskId);
    if (!task) return notFound(taskId);
    if (inFlight.has(taskId)) {
      return failure('RUN_IN_PROGRESS', `“${task.name}” is already running — stop it, or wait for it to finish.`);
    }
    inFlight.set(taskId, { linkId: link.id, startedAt: Date.now() });
    publish();
    void dispatch(orderFor(task), link);
    return success(list());
  }

  function finished(taskId: string, result: TaskResult): void {
    const flight = inFlight.get(taskId);
    inFlight.delete(taskId);
    log(`task ${taskId} finished: ${result.outcome}`);
    record(taskId, { at: flight?.startedAt ?? Date.now() - (result.durationMs ?? 0), ...result });
  }

  function linkClosed(linkId: string): void {
    for (const [taskId, flight] of inFlight) {
      if (flight.linkId !== linkId) continue;
      inFlight.delete(taskId);
      record(taskId, { at: flight.startedAt, outcome: 'failed', reason: 'The browser disconnected before the run finished.' });
    }
  }

  arm(FIRST_WAKE_MS);

  return {
    list,
    save,
    remove,
    pause,
    runNow,
    finished,
    linkClosed,
    stop: () => clearTimeout(timer),
  };
}
