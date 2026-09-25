process.env.TZ = 'Europe/Berlin';

import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import type { ScheduledTask, TaskList, TaskOrder } from '@/lib/schedules/task';
import { CLOCK_MAX_WAIT_MS, startScheduler, type Scheduler, type TaskLink } from './scheduler';
import { schedulesPath } from './store';

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m).getTime();
const MINUTE = 60_000;

interface FakeLink extends TaskLink {
  orders: TaskOrder[];
}

function fakeLink(id = 'chrome', reply: ActionResult = success({ sessionId: 's1' })): FakeLink {
  const orders: TaskOrder[] = [];
  return {
    id,
    label: id,
    orders,
    runTask: async (order) => {
      orders.push(order);
      return reply;
    },
  };
}

const draft = (patch: Record<string, unknown> = {}) => ({
  name: 'PR digest',
  job: { kind: 'instruction', text: 'Summarise the PRs waiting on my review.' },
  url: 'https://github.com/pulls',
  rule: { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], times: ['09:00'] },
  ...patch,
});

let scheduler: Scheduler;
let link: FakeLink | null;
const published: TaskList[] = [];

function start(): Scheduler {
  scheduler = startScheduler({ linkFor: () => link, publish: (list) => published.push(list) });
  return scheduler;
}

function saved(patch: Record<string, unknown> = {}): ScheduledTask {
  const result = scheduler.save(draft(patch));
  if (!result.ok) throw new Error(result.error.message);
  return result.data.tasks.at(-1)!;
}

const current = (taskId: string) => scheduler.list().tasks.find((task) => task.id === taskId)!;

beforeEach(() => {
  rmSync(schedulesPath, { force: true });
  vi.useFakeTimers({ now: at(25, 8) });
  published.length = 0;
  link = fakeLink();
  start();
});

afterEach(() => {
  scheduler.stop();
  vi.useRealTimers();
});

describe('the schedule clock', () => {
  it('fires on time, in the connected browser, and moves on to the next run', async () => {
    const task = saved();
    expect(task.nextRunAt).toBe(at(25, 9));

    await vi.advanceTimersByTimeAsync(59 * MINUTE);
    expect(link!.orders).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(MINUTE);

    expect(link!.orders).toEqual([expect.objectContaining({ id: task.id, url: 'https://github.com/pulls' })]);
    expect(current(task.id)).toMatchObject({ runCount: 1, nextRunAt: at(26, 9) });
    expect(scheduler.list().running).toEqual({ [task.id]: at(25, 9) });
  });

  it('files what the browser reports when the run ends', async () => {
    const task = saved();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);

    scheduler.finished(task.id, { outcome: 'ok', headline: '3 PRs need you', durationMs: 42_000 });

    expect(current(task.id).runs).toEqual([{ at: at(25, 9), outcome: 'ok', headline: '3 PRs need you', durationMs: 42_000 }]);
    expect(scheduler.list().running).toEqual({});
    expect(published.at(-1)?.tasks[0].runs).toHaveLength(1);
  });

  it('logs a miss when no browser is connected, and keeps the schedule', async () => {
    link = null;
    const task = saved();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);

    expect(current(task.id).runs[0]).toMatchObject({ outcome: 'missed', reason: 'No browser was connected.' });
    expect(current(task.id)).toMatchObject({ runCount: 0, nextRunAt: at(26, 9) });
  });

  it('catches up once after the computer slept through its runs', async () => {
    const task = saved();
    vi.setSystemTime(at(26, 10));
    await vi.advanceTimersByTimeAsync(CLOCK_MAX_WAIT_MS);

    expect(current(task.id).runs[0]).toMatchObject({ outcome: 'missed', at: at(25, 9) });
    expect(current(task.id).runs[0].reason).toContain('Missed 2 runs');
    expect(link!.orders).toHaveLength(1);
    expect(current(task.id).nextRunAt).toBe(at(27, 9));
  });

  it('skips the missed runs outright when told to', async () => {
    const task = saved({ missed: 'skip' });
    vi.setSystemTime(at(26, 10));
    await vi.advanceTimersByTimeAsync(CLOCK_MAX_WAIT_MS);

    expect(current(task.id).runs.map((run) => run.outcome)).toEqual(['missed']);
    expect(link!.orders).toHaveLength(0);
    expect(current(task.id).nextRunAt).toBe(at(27, 9));
  });

  it('skips a fire while the previous run is still going', async () => {
    const task = saved({ rule: { kind: 'every', minutes: 5 } });
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(link!.orders).toHaveLength(1);
    expect(current(task.id).runs[0]).toMatchObject({ outcome: 'skipped', reason: 'The previous run was still going.' });
  });

  it('records a run the browser refused to start', async () => {
    link = fakeLink('chrome', failure('SESSION_LIMIT', '8 tab sessions are already open.'));
    const task = saved();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);

    expect(current(task.id).runs[0]).toMatchObject({ outcome: 'failed', reason: 'SESSION_LIMIT: 8 tab sessions are already open.' });
    expect(scheduler.list().running).toEqual({});
  });

  it('fails the runs of a browser that disconnects', async () => {
    const task = saved();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);

    scheduler.linkClosed('chrome');

    expect(current(task.id).runs[0]).toMatchObject({ outcome: 'failed', reason: 'The browser disconnected before the run finished.' });
  });

  it('holds every task while paused, and resumes from now rather than catching up', async () => {
    const task = saved();
    scheduler.pause(true);
    await vi.advanceTimersByTimeAsync(3 * 60 * MINUTE);
    expect(link!.orders).toHaveLength(0);

    scheduler.pause(false);

    expect(current(task.id)).toMatchObject({ runs: [], nextRunAt: at(26, 9) });
  });

  it('stops after the last allowed run', async () => {
    const task = saved({ maxRuns: 1 });
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(current(task.id).nextRunAt).toBeNull();
  });
});

describe('managing tasks', () => {
  it('runs one now in the asking browser without moving its schedule', async () => {
    const task = saved();
    const asking = fakeLink('edge');

    expect(scheduler.runNow(task.id, asking).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(asking.orders).toHaveLength(1);
    expect(current(task.id)).toMatchObject({ runCount: 0, nextRunAt: at(25, 9) });
    expect(scheduler.runNow(task.id, asking)).toMatchObject({ ok: false, error: { code: 'RUN_IN_PROGRESS' } });
  });

  it('keeps a task’s history through an edit and clears what the edit removed', async () => {
    const task = saved({ maxRuns: 5 });
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    scheduler.finished(task.id, { outcome: 'ok', headline: 'done' });

    const edited = scheduler.save({ ...draft({ name: 'Morning PRs' }), id: task.id });

    expect(edited.ok).toBe(true);
    expect(current(task.id)).toMatchObject({ name: 'Morning PRs', runCount: 1, createdAt: task.createdAt });
    expect(current(task.id).maxRuns).toBeUndefined();
    expect(current(task.id).runs).toHaveLength(1);
  });

  it('refuses a bad task and an unknown id', () => {
    expect(scheduler.save(draft({ url: 'file:///etc/passwd' }))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(scheduler.remove('missing')).toMatchObject({ ok: false, error: { code: 'TASK_NOT_FOUND' } });
  });

  it('caps how many tasks can be scheduled', () => {
    for (let i = 0; i < 25; i++) saved({ name: `Task ${i}` });
    expect(scheduler.save(draft())).toMatchObject({ ok: false, error: { code: 'TASK_LIMIT' } });
  });

  it('keeps the tasks on disk for the next daemon', () => {
    const task = saved();
    scheduler.stop();
    start();
    expect(scheduler.list().tasks.map(({ id }) => id)).toEqual([task.id]);
  });
});
