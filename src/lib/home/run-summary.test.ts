import { describe, expect, it } from 'vitest';
import type { RunItem } from '@/lib/bridge/run-items';
import { summarize, toolName } from './run-summary';

const user = (text: string): RunItem => ({ kind: 'user', id: `u-${text}`, text });
const reply = (text: string): RunItem => ({ kind: 'assistant', id: `a-${text}`, text });
const tool = (action: string, extra: Partial<Extract<RunItem, { kind: 'tool' }>> = {}): RunItem => ({
  kind: 'tool',
  id: `t-${action}`,
  action,
  input: {},
  ...extra,
});
const failure = (text: string): RunItem => ({ kind: 'notice', id: `n-${text}`, tone: 'error', text });

describe('summarize', () => {
  it('has nothing to tell before the first message', () => {
    expect(summarize([], false)).toEqual({ phase: 'idle' });
    expect(summarize([{ kind: 'notice', id: 'n', tone: 'info', text: 'Loaded skill' }], false)).toEqual({ phase: 'idle' });
  });

  it('tells only the latest turn', () => {
    const items = [user('first'), reply('old answer'), user('second')];
    expect(summarize(items, true)).toEqual({ phase: 'working', asked: 'second', step: undefined });
  });

  it('names the step the agent is on while it works', () => {
    const items = [user('find flights'), tool('page.navigate', { summary: 'google.com/travel' })];
    expect(summarize(items, true)).toMatchObject({ phase: 'working', step: { action: 'page.navigate' } });
  });

  it('puts an approval first, even with a reply streaming beside it', () => {
    const items = [user('pay the bill'), tool('page.clickElement', { awaiting: true, site: 'bank.example' }), reply('One moment')];
    expect(summarize(items, true)).toMatchObject({ phase: 'approval', step: { action: 'page.clickElement' } });
  });

  it('streams the reply while it arrives, and keeps it once the run ends', () => {
    expect(summarize([user('q'), reply('Half an ans')], true)).toEqual({ phase: 'reply', asked: 'q', reply: 'Half an ans', live: true });
    expect(summarize([user('q'), reply('The answer'), tool('page.screenshot')], false)).toEqual({
      phase: 'reply',
      asked: 'q',
      reply: 'The answer',
      live: false,
    });
  });

  it('reports a turn that ended on an error', () => {
    expect(summarize([user('q'), failure('AGENT_MISSING: Claude Code cannot run.')], false)).toEqual({
      phase: 'failed',
      asked: 'q',
      message: 'AGENT_MISSING: Claude Code cannot run.',
    });
  });

  it('settles a turn that only acted', () => {
    expect(summarize([user('go to example.com'), tool('page.navigate', { ok: true })], false)).toMatchObject({
      phase: 'done',
      step: { action: 'page.navigate' },
    });
  });
});

describe('toolName', () => {
  it('drops the page prefix the panel drops too', () => {
    expect(toolName(tool('page.navigate') as Extract<RunItem, { kind: 'tool' }>)).toBe('navigate');
    expect(toolName(tool('browsentic.readFile') as Extract<RunItem, { kind: 'tool' }>)).toBe('browsentic.readFile');
  });
});
