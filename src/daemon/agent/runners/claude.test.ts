import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { claudeRunner } from './claude';
import type { StreamSink } from './types';

type Signal = keyof StreamSink;
type Call = [Signal, ...unknown[]];

const transcript = (name: string) =>
  readFileSync(new URL(`./fixtures/claude/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'));

const read = (lines: string[], only?: Signal): Call[] => {
  const calls: Call[] = [];
  const record = (signal: Signal) => (...args: unknown[]) => void calls.push([signal, ...args]);
  const sink: StreamSink = {
    text: record('text'),
    tool: record('tool'),
    session: record('session'),
    usage: record('usage'),
    done: record('done'),
    fail: record('fail'),
  };
  const reader = claudeRunner.reader();
  for (const line of lines) reader(line, sink);
  return only ? calls.filter(([signal]) => signal === only) : calls;
};

describe('token usage', () => {
  test('a turn reports what its message finally generated, once', () => {
    expect(read(transcript('2.1.278-fresh.jsonl'), 'usage')).toEqual([['usage', { contextTokens: 7389, outputTokens: 41 }]]);
  });

  test('a resumed turn counts the cached conversation as context', () => {
    expect(read(transcript('2.1.278-resumed.jsonl'), 'usage')).toEqual([['usage', { contextTokens: 7467, outputTokens: 31 }]]);
  });

  test('output adds up across the messages of one run, and context is the latest message', () => {
    expect(read(transcript('tool-loop.hand-written.jsonl'), 'usage')).toEqual([
      ['usage', { contextTokens: 8260, outputTokens: 60 }],
      ['usage', { contextTokens: 9112, outputTokens: 72 }],
    ]);
  });

  test('a stream with no message deltas falls back to the total on the result line', () => {
    const result = { type: 'result', subtype: 'success', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } };
    expect(read([JSON.stringify(result)], 'usage')).toEqual([['usage', { contextTokens: 105, outputTokens: 5 }]]);
  });
});
