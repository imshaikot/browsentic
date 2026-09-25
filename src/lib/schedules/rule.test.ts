process.env.TZ = 'Europe/Berlin';

import { describe, expect, it } from 'vitest';
import { describeRule, insideWindow, nextAfter, upcoming, WORKDAYS, type ScheduleRule } from './rule';

const at = (y: number, month: number, d: number, h = 0, m = 0) => new Date(y, month - 1, d, h, m).getTime();
const HOUR = 3_600_000;

describe('nextAfter', () => {
  const weekdaysAtNine: ScheduleRule = { kind: 'weekly', days: [...WORKDAYS], times: ['09:00'] };

  it('skips the weekend for a weekday rule', () => {
    expect(nextAfter(weekdaysAtNine, at(2026, 9, 25, 10))).toBe(at(2026, 9, 28, 9));
  });

  it('takes the next time the same day, and never the time it just fired at', () => {
    const twice: ScheduleRule = { kind: 'weekly', days: [4], times: ['09:00', '17:30'] };
    expect(nextAfter(twice, at(2026, 9, 24, 8))).toBe(at(2026, 9, 24, 9));
    expect(nextAfter(twice, at(2026, 9, 24, 9))).toBe(at(2026, 9, 24, 17, 30));
    expect(nextAfter(twice, at(2026, 9, 24, 17, 30))).toBe(at(2026, 10, 1, 9));
  });

  it('keeps a daily time on the wall clock across both DST changes', () => {
    const daily: ScheduleRule = { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], times: ['09:00'] };
    const spring = nextAfter(daily, at(2026, 3, 28, 9))!;
    const autumn = nextAfter(daily, at(2026, 10, 24, 9))!;
    expect(new Date(spring).getHours()).toBe(9);
    expect(spring - at(2026, 3, 28, 9)).toBe(23 * HOUR);
    expect(new Date(autumn).getHours()).toBe(9);
    expect(autumn - at(2026, 10, 24, 9)).toBe(25 * HOUR);
  });

  it('runs a time that does not exist on the spring-forward day once the clocks have moved', () => {
    const early: ScheduleRule = { kind: 'weekly', days: [0], times: ['02:30'] };
    const next = new Date(nextAfter(early, at(2026, 3, 28, 12))!);
    expect([next.getDate(), next.getHours(), next.getMinutes()]).toEqual([29, 3, 30]);
  });

  it('repeats inside a window and resumes at its start', () => {
    const daytime: ScheduleRule = { kind: 'every', minutes: 180, window: { from: '08:00', to: '22:00' } };
    expect(nextAfter(daytime, at(2026, 9, 25, 8))).toBe(at(2026, 9, 25, 11));
    expect(nextAfter(daytime, at(2026, 9, 25, 20, 30))).toBe(at(2026, 9, 26, 8));
  });

  it('handles a window that runs past midnight', () => {
    const night: ScheduleRule = { kind: 'every', minutes: 60, window: { from: '22:00', to: '06:00' } };
    expect(nextAfter(night, at(2026, 9, 25, 23))).toBe(at(2026, 9, 26, 0));
    expect(nextAfter(night, at(2026, 9, 26, 5, 30))).toBe(at(2026, 9, 26, 22));
    expect(insideWindow(at(2026, 9, 26, 3), night.window!)).toBe(true);
    expect(insideWindow(at(2026, 9, 26, 12), night.window!)).toBe(false);
  });

  it('fires a one-off once and then never again', () => {
    const once: ScheduleRule = { kind: 'once', at: at(2026, 9, 25, 18) };
    expect(nextAfter(once, at(2026, 9, 25, 12))).toBe(at(2026, 9, 25, 18));
    expect(nextAfter(once, at(2026, 9, 25, 18))).toBeNull();
  });
});

describe('upcoming', () => {
  it('lists the next runs in order', () => {
    const rule: ScheduleRule = { kind: 'weekly', days: [1, 3, 5], times: ['07:15'] };
    expect(upcoming(rule, at(2026, 9, 25, 8), 3)).toEqual([at(2026, 9, 28, 7, 15), at(2026, 9, 30, 7, 15), at(2026, 10, 2, 7, 15)]);
  });

  it('stops at a one-off', () => {
    expect(upcoming({ kind: 'once', at: at(2026, 9, 26, 9) }, at(2026, 9, 25), 3)).toEqual([at(2026, 9, 26, 9)]);
  });
});

describe('describeRule', () => {
  it.each<[ScheduleRule, string]>([
    [{ kind: 'weekly', days: [...WORKDAYS], times: ['09:00'] }, 'Weekdays at 09:00'],
    [{ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], times: ['17:30', '09:00'] }, 'Every day at 09:00 and 17:30'],
    [{ kind: 'weekly', days: [0, 6], times: ['10:00'] }, 'Weekends at 10:00'],
    [{ kind: 'weekly', days: [5, 1, 3], times: ['07:15', '12:00', '18:45'] }, 'Mon, Wed, Fri at 07:15, 12:00 and 18:45'],
    [{ kind: 'every', minutes: 180, window: { from: '08:00', to: '22:00' } }, 'Every 3 h, 08:00–22:00'],
    [{ kind: 'every', minutes: 45 }, 'Every 45 min'],
    [{ kind: 'every', minutes: 60 }, 'Every hour'],
    [{ kind: 'once', at: at(2026, 9, 25, 18) }, 'Once, Fri 25 Sep at 18:00'],
  ])('%j reads as “%s”', (rule, words) => {
    expect(describeRule(rule)).toBe(words);
  });
});
