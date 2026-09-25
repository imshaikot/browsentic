/**
 * The scheduled tasks and their run logs, in one file the daemon owns.
 *
 * The CLI edits it too, while the daemon runs. Both sides read, change and write in one
 * synchronous step, and the daemon re-reads it on every wake of its clock, so a pause made
 * from a terminal takes effect within a minute without any message passing.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_RUNS_KEPT, nextRunFor, type ScheduledTask, type TaskRun } from '@/lib/schedules/task';
import { stateDir } from '../lockfile';

export interface StoredSchedules {
  paused: boolean;
  tasks: ScheduledTask[];
}

export const schedulesPath = join(stateDir, 'schedules.json');

const looksLikeTask = (task: unknown): task is ScheduledTask => {
  const candidate = task as Partial<ScheduledTask> | null;
  return (
    !!candidate &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.rule === 'object' &&
    typeof candidate.job === 'object'
  );
};

export function readSchedules(): StoredSchedules {
  try {
    const parsed = JSON.parse(readFileSync(schedulesPath, 'utf8')) as Partial<StoredSchedules>;
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter(looksLikeTask) : [];
    return {
      paused: parsed.paused === true,
      tasks: tasks.map((task) => ({ ...task, runs: Array.isArray(task.runs) ? task.runs : [], runCount: task.runCount ?? 0 })),
    };
  } catch {
    return { paused: false, tasks: [] };
  }
}

function writeSchedules(state: StoredSchedules): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const staged = `${schedulesPath}.${process.pid}.tmp`;
  writeFileSync(staged, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  chmodSync(staged, 0o600);
  renameSync(staged, schedulesPath);
}

export function updateSchedules<T>(change: (state: StoredSchedules) => T): T {
  const state = readSchedules();
  const outcome = change(state);
  writeSchedules(state);
  return outcome;
}

export function logRun(task: ScheduledTask, run: TaskRun): void {
  task.runs = [run, ...task.runs].slice(0, MAX_RUNS_KEPT);
}

export function setPaused(state: StoredSchedules, paused: boolean, now: number): void {
  state.paused = paused;
  if (paused) return;
  for (const task of state.tasks) {
    if (task.nextRunAt !== null && task.nextRunAt < now) task.nextRunAt = nextRunFor(task, now);
  }
}

export function setEnabled(task: ScheduledTask, enabled: boolean, now: number): void {
  task.enabled = enabled;
  task.nextRunAt = nextRunFor(task, now);
}

export function findTask(state: StoredSchedules, idOrPrefix: string): ScheduledTask | undefined {
  const exact = state.tasks.find((task) => task.id === idOrPrefix);
  if (exact) return exact;
  const matches = state.tasks.filter((task) => task.id.startsWith(idOrPrefix));
  return matches.length === 1 ? matches[0] : undefined;
}
