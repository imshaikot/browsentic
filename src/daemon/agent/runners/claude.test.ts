import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { stateDir } from '../../lockfile';
import { claudeRunner } from './claude';
import { jsonContext, readThrough, shown, streamContext, transcript, valueOf, valuesOf } from './fixtures/support';

const settings = { bin: 'claude' };
const stream = (overrides: Parameters<typeof streamContext>[1] = {}) => claudeRunner.stream(streamContext(settings, overrides));
const json = (overrides: Parameters<typeof jsonContext>[1] = {}) => claudeRunner.json(jsonContext(settings, overrides));
const read = (name: string, only?: Parameters<typeof readThrough>[2]) => readThrough(claudeRunner, transcript('claude', name), only);
const readLines = (...lines: object[]) => readThrough(claudeRunner, lines.map((line) => JSON.stringify(line)));

describe('a streamed run', () => {
  test('a fresh run starts a session of its own and reaches only the browser', () => {
    expect(shown(stream())).toMatchInlineSnapshot(`
      {
        "args": [
          "-p",
          "what does this page cost",
          "--output-format",
          "stream-json",
          "--include-partial-messages",
          "--verbose",
          "--mcp-config",
          "{"mcpServers":{"browsentic":{"command":"/usr/local/bin/node","args":["/usr/local/lib/node_modules/browsentic/dist/cli.js","mcp"],"env":{"BROWSENTIC_AGENT_RUN":"run-1"}}}}",
          "--strict-mcp-config",
          "--tools",
          "",
          "--allowedTools",
          "mcp__browsentic",
          "--disallowedTools",
          "Bash",
          "Edit",
          "Write",
          "NotebookEdit",
          "Glob",
          "Grep",
          "Read",
          "Task",
          "Monitor",
          "Workflow",
          "Skill",
          "ToolSearch",
          "SendMessage",
          "TaskOutput",
          "TaskStop",
          "TodoWrite",
          "ReportFindings",
          "CronCreate",
          "CronDelete",
          "CronList",
          "ScheduleWakeup",
          "RemoteTrigger",
          "PushNotification",
          "DesignSync",
          "EnterWorktree",
          "ExitWorktree",
          "WebSearch",
          "WebFetch",
          "--append-system-prompt",
          "You are Browsentic.",
          "--session-id",
          "<uuid>",
        ],
        "cwd": "<state>",
        "env": {
          "BROWSENTIC_AGENT_RUN": "run-1",
        },
      }
    `);
  });

  test('a follow-up resumes the session it is given instead of starting one', () => {
    const args = stream({ sessionId: 'sess-1' }).args;
    expect([valueOf(args, '--resume'), args.includes('--session-id')]).toEqual(['sess-1', false]);
  });

  test('research hands it the web tools and takes them off the deny list', () => {
    const args = stream({ research: true }).args;
    expect({
      tools: valuesOf(args, '--tools'),
      allowed: valuesOf(args, '--allowedTools'),
      deniesTheWeb: valuesOf(args, '--disallowedTools').some((tool) => tool.startsWith('Web')),
    }).toEqual({ tools: ['WebSearch', 'WebFetch'], allowed: ['mcp__browsentic', 'WebSearch', 'WebFetch'], deniesTheWeb: false });
  });

  test('the chosen model and effort are passed through', () => {
    const args = claudeRunner.stream(streamContext({ bin: 'claude', model: 'claude-opus-5', effort: 'max' })).args;
    expect([valueOf(args, '--model'), valueOf(args, '--effort')]).toEqual(['claude-opus-5', 'max']);
  });

  test('an effort Claude Code does not accept is dropped rather than failing the run', () => {
    expect(claudeRunner.stream(streamContext({ bin: 'claude', effort: 'minimal' })).args).not.toContain('--effort');
  });

  test('it runs in the state directory, where its saved sessions are looked up', () => {
    expect([claudeRunner.workspace('run'), claudeRunner.workspace('task')]).toEqual([stateDir, stateDir]);
  });
});

describe('a one-shot task', () => {
  test('a task reaches no browser and no tools at all', () => {
    expect(shown(json())).toMatchInlineSnapshot(`
      {
        "args": [
          "-p",
          "summarize this",
          "--output-format",
          "json",
          "--mcp-config",
          "{"mcpServers":{}}",
          "--strict-mcp-config",
          "--tools",
          "",
          "--disallowedTools",
          "Bash",
          "Edit",
          "Write",
          "NotebookEdit",
          "Glob",
          "Grep",
          "Read",
          "Task",
          "Monitor",
          "Workflow",
          "Skill",
          "ToolSearch",
          "SendMessage",
          "TaskOutput",
          "TaskStop",
          "TodoWrite",
          "ReportFindings",
          "CronCreate",
          "CronDelete",
          "CronList",
          "ScheduleWakeup",
          "RemoteTrigger",
          "PushNotification",
          "DesignSync",
          "EnterWorktree",
          "ExitWorktree",
          "WebSearch",
          "WebFetch",
        ],
        "cwd": "<state>",
      }
    `);
  });

  test('a task that has to open a file may read, and do nothing else', () => {
    const args = json({ reads: true }).args;
    expect({
      tools: valuesOf(args, '--tools'),
      allowed: valuesOf(args, '--allowedTools'),
      deniesRead: valuesOf(args, '--disallowedTools').includes('Read'),
    }).toEqual({ tools: ['Read'], allowed: ['Read'], deniesRead: false });
  });

  test('model and effort apply to a task too', () => {
    const args = claudeRunner.json(jsonContext({ bin: 'claude', model: 'claude-haiku-4-5', effort: 'low' })).args;
    expect([valueOf(args, '--model'), valueOf(args, '--effort')]).toEqual(['claude-haiku-4-5', 'low']);
  });
});

describe('reading the stream', () => {
  test('a recorded turn establishes the session, says the answer and finishes', () => {
    expect(read('2.1.278-fresh.jsonl')).toEqual([
      ['session', '2e281281-10ef-47b8-8a23-d6137f6770f6'],
      ['text', 'ok'],
      ['usage', { contextTokens: 7389, outputTokens: 41 }],
      ['done', 'end_turn'],
    ]);
  });

  test('a recorded follow-up reports the session it resumed', () => {
    expect(read('2.1.278-resumed.jsonl', 'session')).toEqual([['session', '2e281281-10ef-47b8-8a23-d6137f6770f6']]);
  });

  test('a model the account cannot use fails the run with what Claude Code said', () => {
    expect(read('2.1.278-unknown-model.jsonl').filter(([signal]) => signal !== 'session')).toEqual([
      [
        'fail',
        'AGENT_FAILED',
        "There's an issue with the selected model (claude-nonexistent-9). It may not exist or you may not have access to it. Run --model to pick a different model.",
      ],
    ]);
  });

  test('a browser tool is not announced, because the daemon reports those itself', () => {
    expect(read('tool-loop.hand-written.jsonl', 'tool')).toEqual([]);
  });

  test('its own web tools are announced under the ids Claude gave them', () => {
    expect(read('web-search.hand-written.jsonl', 'tool')).toEqual([
      ['tool', 'toolu_ws', 'WebSearch'],
      ['tool', 'toolu_wf', 'WebFetch'],
    ]);
  });

  test('nothing a subagent says, calls or spends reaches the run', () => {
    expect(read('subagent.hand-written.jsonl')).toEqual([
      ['session', 'c41a9e07-2f65-4b18-93d0-6e7a2b1c8f45'],
      ['usage', { contextTokens: 5540, outputTokens: 40 }],
      ['text', 'Done.'],
      ['usage', { contextTokens: 6303, outputTokens: 43 }],
      ['done', 'end_turn'],
    ]);
  });

  test('an error with no message fails with its subtype', () => {
    expect(readLines({ type: 'result', is_error: true, subtype: 'error_max_turns' })).toEqual([
      ['fail', 'AGENT_FAILED', 'error_max_turns'],
    ]);
  });

  test('a result with no stop reason finishes as end_turn', () => {
    expect(readLines({ type: 'result', subtype: 'success' })).toEqual([['done', 'end_turn']]);
  });

  test('lines it does not understand are passed over', () => {
    const lines = ['not json', '{"type":"rate_limit_event"}', '{"type":"system","subtype":"status"}', '{"type":"user"}'];
    expect(readThrough(claudeRunner, lines)).toEqual([]);
  });
});

describe('token usage', () => {
  test('a turn reports what its message finally generated, once', () => {
    expect(read('2.1.278-fresh.jsonl', 'usage')).toEqual([['usage', { contextTokens: 7389, outputTokens: 41 }]]);
  });

  test('a resumed turn counts the cached conversation as context', () => {
    expect(read('2.1.278-resumed.jsonl', 'usage')).toEqual([['usage', { contextTokens: 7467, outputTokens: 31 }]]);
  });

  test('output adds up across the messages of one run, and context is the latest message', () => {
    expect(read('tool-loop.hand-written.jsonl', 'usage')).toEqual([
      ['usage', { contextTokens: 8260, outputTokens: 60 }],
      ['usage', { contextTokens: 9112, outputTokens: 72 }],
    ]);
  });

  test('a stream with no message deltas falls back to the total on the result line', () => {
    const result = { type: 'result', subtype: 'success', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } };
    expect(readLines(result).filter(([signal]) => signal === 'usage')).toEqual([['usage', { contextTokens: 105, outputTokens: 5 }]]);
  });
});

describe('the answer to a one-shot task', () => {
  test('is the result text', () => {
    expect(claudeRunner.answer('{"type":"result","is_error":false,"result":"A pricing page."}')).toEqual({ text: 'A pricing page.' });
  });

  test('an error result is the error', () => {
    expect(claudeRunner.answer('{"is_error":true,"result":"Credit balance is too low"}')).toEqual({ error: 'Credit balance is too low' });
  });

  test('an error with no message names its subtype', () => {
    expect(claudeRunner.answer('{"is_error":true,"subtype":"error_during_execution"}')).toEqual({ error: 'error_during_execution' });
  });

  test('output that is not JSON is no answer at all', () => {
    expect(claudeRunner.answer('Segmentation fault')).toEqual({});
  });
});

describe('what a failed start is explained as', () => {
  test('a Claude Code too old for the sandbox flags is told to update', () => {
    expect(claudeRunner.hint?.("error: unknown option '--strict-mcp-config'\n")).toBe(
      "Your Claude Code does not understand the flags Browsentic uses to sandbox a run. Update Claude Code, then try again. (error: unknown option '--strict-mcp-config')",
    );
  });

  test('anything else is left to the exit code', () => {
    expect(claudeRunner.hint?.('Error: connect ECONNREFUSED')).toBeNull();
  });
});

test("the user's own skills are listed from ~/.claude/skills", () => {
  expect(claudeRunner.skillDirs?.()).toEqual([join(homedir(), '.claude', 'skills')]);
});
