import { describe, expect, test } from 'vitest';
import { describeActions } from './registry';

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
