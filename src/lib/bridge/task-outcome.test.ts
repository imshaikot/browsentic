import { describe, expect, it } from 'vitest';
import type { RunItem } from './run-items';
import { replayVerdict, verdictOf } from './task-outcome';
import { approvalDetail, taskNoticeFor } from './task-notices';

const item = (patch: RunItem): RunItem => patch;

describe('verdictOf', () => {
  it('takes the agent’s closing line as the headline', () => {
    const items = [
      item({ kind: 'user', id: '1', text: 'Summarise my PRs' }),
      item({ kind: 'assistant', id: '2', text: 'Looked at the queue.\n\n3 PRs are waiting on your review.' }),
    ];
    expect(verdictOf(items)).toEqual({ outcome: 'ok', headline: '3 PRs are waiting on your review.' });
  });

  it('reads an error at the end as a failure, and a cancellation as one', () => {
    expect(verdictOf([item({ kind: 'notice', id: '1', tone: 'error', text: 'AGENT_FAILED: exit 1' })])).toEqual({
      outcome: 'failed',
      reason: 'AGENT_FAILED: exit 1',
    });
    expect(verdictOf([item({ kind: 'notice', id: '1', tone: 'error', text: 'CANCELLED: The tab was closed.' })]).outcome).toBe(
      'cancelled',
    );
  });
});

describe('replayVerdict', () => {
  it('leads with what the last read found, or says the replay finished', () => {
    expect(replayVerdict(4, '\n€ 1.299\nincl. VAT')).toEqual({ outcome: 'ok', headline: '€ 1.299' });
    expect(replayVerdict(4)).toEqual({ outcome: 'ok', headline: 'Replayed all 4 steps.' });
  });
});

describe('taskNoticeFor', () => {
  const ok = { outcome: 'ok' as const, headline: '3 PRs need you' };
  const failed = { outcome: 'failed' as const, reason: 'TIMEOUT: no answer' };

  it('follows the task’s notify setting', () => {
    expect(taskNoticeFor({ name: 'PR digest', notify: 'always' }, ok)).toEqual({ tone: 'live', title: 'PR digest', body: '3 PRs need you' });
    expect(taskNoticeFor({ name: 'PR digest', notify: 'failure' }, ok)).toBeNull();
    expect(taskNoticeFor({ name: 'PR digest', notify: 'failure' }, failed)).toEqual({
      tone: 'warn',
      title: 'PR digest failed',
      body: 'TIMEOUT: no answer',
    });
    expect(taskNoticeFor({ name: 'PR digest', notify: 'never' }, failed)).toBeNull();
  });
});

describe('approvalDetail', () => {
  it('shows where the action lands, never the value it would type', () => {
    expect(approvalDetail({ target: { selector: '#pw' }, value: '⟦password:4f2a⟧' })).toBe('#pw');
    expect(approvalDetail({ url: 'https://pay.example.com/checkout' })).toBe('https://pay.example.com/checkout');
    expect(approvalDetail({})).toBeUndefined();
  });
});
