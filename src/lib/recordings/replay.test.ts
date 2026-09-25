import { describe, expect, it } from 'vitest';
import { planReplay, variablesNeeded } from './replay';
import type { RecordingWorkflow } from './workflow';

const workflow = (patch: Partial<RecordingWorkflow> = {}): RecordingWorkflow => ({
  goal: 'Log this week’s hours',
  summary: '',
  caveats: [],
  variables: [{ name: 'hours', field: 'Hours worked', kind: 'number' }],
  steps: [
    { ordinal: 1, intent: 'Open the timesheet', action: 'page.navigate', url: 'https://jira.example.com/timesheet' },
    { ordinal: 2, intent: 'Enter the hours', action: 'page.fillInput', target: { selector: '#hours' }, value: '{{hours}}' },
    { ordinal: 3, intent: 'Pick the project', action: 'page.selectOption', target: { role: 'combobox' }, value: 'Browsentic' },
    { ordinal: 4, intent: 'Confirm', action: 'page.pressKey', value: 'Enter' },
    { ordinal: 5, intent: 'Submit', action: 'page.clickElement', target: { text: 'Submit' } },
  ],
  ...patch,
});

describe('planReplay', () => {
  it('turns each step into the call that repeats it, with the values filled in', () => {
    const plan = planReplay(workflow(), { hours: '38' });
    expect(plan).toEqual({
      ok: true,
      calls: [
        { ordinal: 1, intent: 'Open the timesheet', action: 'page.navigate', input: { url: 'https://jira.example.com/timesheet' } },
        { ordinal: 2, intent: 'Enter the hours', action: 'page.fillInput', input: { target: { selector: '#hours' }, value: '38' } },
        { ordinal: 3, intent: 'Pick the project', action: 'page.selectOption', input: { target: { role: 'combobox' }, label: 'Browsentic' } },
        { ordinal: 4, intent: 'Confirm', action: 'page.pressKey', input: { key: 'Enter' } },
        { ordinal: 5, intent: 'Submit', action: 'page.clickElement', input: { target: { text: 'Submit' } } },
      ],
    });
  });

  it('asks for a value the recording withheld', () => {
    expect(planReplay(workflow())).toEqual({ ok: false, message: 'The recording needs “Hours worked” — fill it in on the task.' });
  });

  it('refuses to hold a secret', () => {
    const login = workflow({
      variables: [{ name: 'pw', field: 'Password', kind: 'password' }],
      steps: [{ ordinal: 1, intent: 'Sign in', action: 'page.fillInput', target: { selector: '#pw' }, value: '{{pw}}' }],
    });
    const plan = planReplay(login, { pw: 'hunter2' });
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.message).toContain('a schedule does not hold secrets');
  });

  it('lists only the values the steps actually use', () => {
    const extra = workflow({ variables: [...workflow().variables, { name: 'unused', field: 'Notes', kind: 'text' }] });
    expect(variablesNeeded(extra).map((variable) => variable.name)).toEqual(['hours']);
  });
});
