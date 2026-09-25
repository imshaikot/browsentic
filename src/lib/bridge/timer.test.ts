import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { timerAlarm, type TimerState } from '@/lib/timers/events';
import { onTimerFire, serveTimers, startJobTimer, timerStatusFor, type TimerHandoff } from './timer';

const handoff = vi.fn<() => Promise<TimerHandoff>>();

async function scheduled(): Promise<string> {
  const started = await startJobTimer(
    { prompt: 'Reload the queue.', afterMs: 60_000, repeat: false, maxRuns: 1, deliver: 'agent' },
    'session-1',
  );
  if (!started.ok) throw new Error(started.error.message);
  return (started.data as TimerState).timerId;
}

async function fire(timerId: string): Promise<void> {
  await fakeBrowser.alarms.onAlarm.trigger({ name: timerAlarm(timerId), scheduledTime: Date.now() });
}

async function status(timerId: string): Promise<TimerState> {
  const result = await timerStatusFor(timerId);
  if (!result.ok) throw new Error(result.error.message);
  return result.data as TimerState;
}

describe('a timer handing work to its conversation', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    handoff.mockReset();
    serveTimers();
    onTimerFire(handoff);
  });

  it('counts a fire with no daemon connected as a skip, not a run', async () => {
    handoff.mockResolvedValue('offline');
    const timerId = await scheduled();

    await fire(timerId);

    await vi.waitFor(async () => expect((await status(timerId)).skipped).toBe(1));
    const state = await status(timerId);
    expect(state.runs).toBe(0);
    expect(state.phase).toBe('scheduled');
    expect(state.logs.at(-1)?.text).toBe('Skipped — no Browsentic daemon was connected to run it.');
  });

  it('finishes a one-shot timer once its prompt was delivered', async () => {
    handoff.mockResolvedValue('delivered');
    const timerId = await scheduled();

    await fire(timerId);

    await vi.waitFor(async () => expect((await status(timerId)).phase).toBe('finished'));
    expect((await status(timerId)).runs).toBe(1);
  });
});
