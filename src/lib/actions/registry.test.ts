import { describe, expect, test } from 'vitest';
import { actions, describeActions } from './registry';

const DEBUGGER_ONLY = [
  'page.trustedClick',
  'page.findCaptcha',
  'page.solveCaptcha',
  'page.startDiagnostics',
  'page.readConsole',
  'page.readNetwork',
  'page.stopDiagnostics',
  'page.injectCode',
  'page.runCode',
];

const names = (tools: { name: string }[]) => tools.map(({ name }) => name);

describe('the list a build offers', () => {
  test('Chromium is offered every action', () => {
    expect(names(describeActions('chromium'))).toEqual([...actions.keys()]);
    expect(names(describeActions())).toEqual(names(describeActions('chromium')));
  });

  test("Firefox is offered everything but the tools that need Chrome's debugger", () => {
    const offered = names(describeActions('firefox'));
    const hidden = [...actions.keys()].filter((name) => !offered.includes(name));
    expect(hidden.sort()).toEqual([...DEBUGGER_ONLY].sort());
  });

  test('a hidden tool is still invocable, so a stale caller gets its own hint', () => {
    for (const name of DEBUGGER_ONLY) expect(actions.has(name)).toBe(true);
  });

  test('no description still tells Chrome about Firefox', () => {
    expect(JSON.stringify(describeActions('chromium'))).not.toContain('Firefox');
  });
});

const schemaOf = (name: string) =>
  describeActions().find((action) => action.name === name)!.inputSchema as {
    properties: Record<string, { properties?: Record<string, Record<string, unknown>> } & Record<string, unknown>>;
  };

describe('the described schemas', () => {
  test('none carries the JSON Schema dialect URL', () => {
    expect(JSON.stringify(describeActions())).not.toContain('$schema');
  });

  test('none carries the safe-integer bounds zod implies for an integer', () => {
    expect(JSON.stringify(describeActions())).not.toContain(String(Number.MAX_SAFE_INTEGER));
  });

  test('a bound the action declared itself is kept', () => {
    expect(schemaOf('page.clickElement').properties.target.properties!.nth).toMatchObject({ type: 'integer', minimum: 0 });
    expect(schemaOf('page.dragElement').properties.steps).toMatchObject({ minimum: 2, maximum: 60 });
  });
});
