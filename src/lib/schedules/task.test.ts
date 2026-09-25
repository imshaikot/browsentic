process.env.TZ = 'Europe/Berlin';

import { describe, expect, it } from 'vitest';
import { headlineOf, MAX_HEADLINE_CHARS, nextRunFor, orderFor, validateTask, type ScheduledTask } from './task';

const NOW = new Date(2026, 8, 25, 12).getTime();

const draft = (patch: Record<string, unknown> = {}) => ({
  name: 'PR digest',
  job: { kind: 'instruction', text: 'Summarise the PRs waiting on my review.' },
  url: 'https://github.com/pulls',
  rule: { kind: 'weekly', days: [1, 2, 3, 4, 5], times: ['09:00'] },
  ...patch,
});

const task = (patch: Partial<ScheduledTask> = {}): ScheduledTask => {
  const checked = validateTask(draft(), NOW);
  if (!checked.ok) throw new Error(checked.message);
  return { ...checked.draft, id: 't1', nextRunAt: null, createdAt: NOW, runCount: 0, runs: [], ...patch };
};

describe('validateTask', () => {
  it('fills the defaults a new task starts with', () => {
    const checked = validateTask(draft(), NOW);
    expect(checked).toEqual({
      ok: true,
      draft: expect.objectContaining({ missed: 'runOnce', notify: 'always', keepTab: false, enabled: true }),
    });
  });

  it.each([
    ['name', { name: '  ' }],
    ['url', { url: 'chrome://settings' }],
    ['job', { job: { kind: 'instruction', text: '' } }],
    ['job', { job: { kind: 'recording' } }],
    ['rule', { rule: { kind: 'every', minutes: 1 } }],
    ['rule', { rule: { kind: 'once', at: NOW - 1 } }],
    ['rule', { rule: { kind: 'weekly', days: [], times: ['09:00'] } }],
    ['rule', { rule: { kind: 'weekly', days: [1], times: ['9am'] } }],
    ['rule', { rule: { kind: 'every', minutes: 60, window: { from: '08:00', to: '08:00' } } }],
    ['maxRuns', { maxRuns: 0 }],
    ['until', { until: NOW - 1 }],
  ])('refuses a bad %s', (field, patch) => {
    expect(validateTask(draft(patch), NOW)).toMatchObject({ ok: false, field });
  });

  it('dedupes and orders the days and times of a weekly rule', () => {
    const checked = validateTask(draft({ rule: { kind: 'weekly', days: [5, 1, 5], times: ['17:30', '09:00', '09:00'] } }), NOW);
    expect(checked.ok && checked.draft.rule).toEqual({ kind: 'weekly', days: [1, 5], times: ['09:00', '17:30'] });
  });

  it('keeps a recording’s values and drops an empty map', () => {
    const withValues = validateTask(
      draft({ job: { kind: 'recording', recordingId: 'r1', name: 'Timesheet', variables: { week: '39' } } }),
      NOW,
    );
    expect(withValues.ok && withValues.draft.job).toEqual({
      kind: 'recording',
      recordingId: 'r1',
      name: 'Timesheet',
      variables: { week: '39' },
    });
    const without = validateTask(draft({ job: { kind: 'recording', recordingId: 'r1', name: 'Timesheet', variables: {} } }), NOW);
    expect(without.ok && without.draft.job).toEqual({ kind: 'recording', recordingId: 'r1', name: 'Timesheet' });
  });
});

describe('nextRunFor', () => {
  it('is the rule’s next time while the task is live', () => {
    expect(nextRunFor(task(), NOW)).toBe(new Date(2026, 8, 28, 9).getTime());
  });

  it('is nothing once paused, spent or past its end date', () => {
    expect(nextRunFor(task({ enabled: false }), NOW)).toBeNull();
    expect(nextRunFor(task({ maxRuns: 3, runCount: 3 }), NOW)).toBeNull();
    expect(nextRunFor(task({ until: new Date(2026, 8, 27).getTime() }), NOW)).toBeNull();
  });
});

describe('orderFor', () => {
  it('hands the run the last result that came back', () => {
    const order = orderFor(
      task({
        runs: [
          { at: 3, outcome: 'failed', reason: 'timeout' },
          { at: 2, outcome: 'ok', headline: '3 PRs need you' },
          { at: 1, outcome: 'ok', headline: 'Nothing waiting' },
        ],
      }),
    );
    expect(order.previous).toBe('3 PRs need you');
  });
});

describe('headlineOf', () => {
  it('takes the closing line as plain text', () => {
    expect(headlineOf('Checked the queue.\n\n- **3 PRs** need your review\n')).toBe('3 PRs need your review');
  });

  it('clips a long line', () => {
    expect(headlineOf('x'.repeat(500))).toHaveLength(MAX_HEADLINE_CHARS);
  });

  it('is nothing for an empty reply', () => {
    expect(headlineOf(' \n ')).toBeUndefined();
  });
});
