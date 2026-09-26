import { describe, expect, it } from 'vitest';
import { approvalOf, describeOrb, spoken, type OrbWorld } from './hands-free';
import type { TabSession } from './tab-sessions';

const world: OrbWorld = {
  theme: 'ember',
  position: null,
  link: 'live',
  state: { muted: false, since: 1 },
  phase: 'listening',
  pushToTalk: false,
  listeningTab: 7,
};

const session = (patch: Partial<TabSession>): TabSession => ({
  sessionId: 's',
  mainTabId: 7,
  tabIds: [7],
  currentTabId: 7,
  windowId: 1,
  title: 'Page',
  runId: null,
  turns: 0,
  createdAt: 0,
  lastActivityAt: 0,
  ...patch,
});

describe('describeOrb', () => {
  it('listens only in the tab the microphone is aimed at', () => {
    expect(describeOrb(world, 7, null).voice).toBe('listening');
    expect(describeOrb(world, 8, null).voice).toBe('paused');
  });

  it('carries hold-to-talk to every tab, and the held phase to the one listening', () => {
    const holding = { ...world, pushToTalk: true, phase: 'held' as const };
    expect(describeOrb(holding, 7, null)).toMatchObject({ pushToTalk: true, voice: 'held' });
    expect(describeOrb(holding, 8, null)).toMatchObject({ pushToTalk: true, voice: 'paused' });
  });

  it('says muted everywhere once muted', () => {
    expect(describeOrb({ ...world, state: { muted: true, since: 1 } }, 7, null).voice).toBe('muted');
    expect(describeOrb({ ...world, state: { muted: true, since: 1 } }, 8, null).voice).toBe('muted');
  });

  it('shows a waiting approval ahead of the run it belongs to', () => {
    const asking = session({
      runId: 'r',
      pendingApproval: { toolId: 't', action: 'page.clickElement', input: { selector: '#go' }, site: 'x.test' },
    });
    expect(describeOrb(world, 7, session({ runId: 'r' })).run).toBe('working');
    expect(describeOrb(world, 7, asking)).toMatchObject({
      run: 'approval',
      approval: { toolId: 't', action: 'clickElement', site: 'x.test', detail: 'selector: #go' },
    });
  });
});

describe('approvalOf', () => {
  it('carries code the agent wrote whole, with its purpose, and no one-line detail', () => {
    const ask = approvalOf({ toolId: 't', action: 'page.injectCode', input: { purpose: 'Sum the column', code: 'let a = 1;' } });
    expect(ask).toEqual({ toolId: 't', action: 'injectCode', site: undefined, purpose: 'Sum the column', code: 'let a = 1;' });
  });

  it('flattens any other input to one short line', () => {
    const ask = approvalOf({ toolId: 't', action: 'page.fillInput', input: { selector: '#q', value: 'x'.repeat(400) } });
    expect(ask.detail?.length).toBeLessThanOrEqual(180);
    expect(ask.detail?.startsWith('selector: #q · value: xxx')).toBe(true);
  });
});

describe('spoken', () => {
  it('reads an action name the way a person would say it', () => {
    expect(spoken('page.clickElement')).toBe('Click element');
  });
});
