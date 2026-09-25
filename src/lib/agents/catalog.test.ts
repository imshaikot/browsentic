import { describe, expect, test } from 'vitest';
import { AGENT_LIST, isModelId } from './catalog';

describe('isModelId', () => {
  test.each([
    'sonnet',
    'claude-sonnet-5',
    'gpt-5.6-terra',
    'anthropic/claude-opus-5-5',
    'claude-opus-4-8[context=1m,effort=high,fast=false]',
    'ollama/llama3:8b',
  ])('takes %s', (id) => {
    expect(isModelId(id)).toBe(true);
  });

  test.each([
    ['a flag', '--dangerously-skip-permissions'],
    ['a short flag', '-p'],
    ['a space', 'gpt 5'],
    ['a newline', 'gpt-5\nactive_model = "x"'],
    ['an escape code', 'gpt-5\u001b[31m'],
    ['a bidi override', 'gpt-5‮'],
    ['nothing', ''],
    ['a leading dot', '.hidden'],
    ['something too long', `m${'x'.repeat(200)}`],
    ['a number', 5],
  ])('refuses %s', (_, value) => {
    expect(isModelId(value)).toBe(false);
  });

  test('every curated model passes', () => {
    expect(AGENT_LIST.flatMap((agent) => agent.models).filter((id) => !isModelId(id))).toEqual([]);
  });
});
