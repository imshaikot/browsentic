import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { stateDir } from '../../lockfile';
import { codexRunner } from './codex';
import { jsonContext, readThrough, shown, streamContext, transcript } from './fixtures/support';

const settings = { bin: 'codex' };
const stream = (overrides: Parameters<typeof streamContext>[1] = {}) => codexRunner.stream(streamContext(settings, overrides));
const read = (name: string, only?: Parameters<typeof readThrough>[2]) => readThrough(codexRunner, transcript('codex', name), only);
const readLines = (...lines: object[]) => readThrough(codexRunner, lines.map((line) => JSON.stringify(line)));
const recorded = (name: string) => transcript('codex', name).join('\n');

describe('a streamed run', () => {
  test('a fresh run registers the browser as its only server and stays in a read-only sandbox', () => {
    expect(shown(stream())).toMatchInlineSnapshot(`
      {
        "args": [
          "exec",
          "--json",
          "-c",
          "sandbox_mode="read-only"",
          "-c",
          "approval_policy="never"",
          "--skip-git-repo-check",
          "-c",
          "mcp_servers.browsentic.command="/usr/local/bin/node"",
          "-c",
          "mcp_servers.browsentic.args=["/usr/local/lib/node_modules/browsentic/dist/cli.js","mcp"]",
          "-c",
          "mcp_servers.browsentic.env={BROWSENTIC_AGENT_RUN="run-1"}",
          "-c",
          "mcp_servers.browsentic.required=true",
          "-c",
          "mcp_servers.browsentic.default_tools_approval_mode="approve"",
          "-c",
          "developer_instructions="You are Browsentic."",
          "-c",
          "tools.web_search=false",
          "--",
          "what does this page cost",
        ],
        "cwd": "<state>",
        "env": {
          "BROWSENTIC_AGENT_RUN": "run-1",
        },
      }
    `);
  });

  // `exec resume` takes neither --sandbox nor --ask-for-approval, which is why both are config.
  test('a follow-up resumes the thread and keeps its sandbox, set as config rather than flags', () => {
    const args = stream({ sessionId: 'thread-1' }).args;
    expect({
      command: args.slice(0, 3),
      sandbox: args.includes('sandbox_mode="read-only"') && args.includes('approval_policy="never"'),
      flags: args.filter((arg) => /^--(sandbox|ask-for-approval|full-auto)/.test(arg)),
    }).toEqual({ command: ['exec', 'resume', 'thread-1'], sandbox: true, flags: [] });
  });

  test("the Browsentic server's tools are approved up front, because headless Codex refuses what it would ask about", () => {
    expect(stream().args).toContain('mcp_servers.browsentic.default_tools_approval_mode="approve"');
  });

  test('research turns web search on, and it is off otherwise', () => {
    expect([stream({ research: true }).args, stream().args].map((args) => args.find((arg) => arg.startsWith('tools.web_search=')))).toEqual([
      'tools.web_search=true',
      'tools.web_search=false',
    ]);
  });

  test('the chosen model and effort are passed through', () => {
    const args = codexRunner.stream(streamContext({ bin: 'codex', model: 'gpt-5.4', effort: 'xhigh' })).args;
    expect([args[args.indexOf('--model') + 1], args.find((arg) => arg.startsWith('model_reasoning_effort='))]).toEqual([
      'gpt-5.4',
      'model_reasoning_effort="xhigh"',
    ]);
  });

  test('an effort Codex does not accept is dropped rather than failing the run', () => {
    const args = codexRunner.stream(streamContext({ bin: 'codex', effort: 'max' })).args;
    expect(args.some((arg) => arg.startsWith('model_reasoning_effort='))).toBe(false);
  });

  test('an instruction that looks like a flag is still the prompt', () => {
    expect(stream({ instruction: '--help me find the pricing page' }).args.slice(-2)).toEqual(['--', '--help me find the pricing page']);
  });

  test('a system prompt with quotes and line breaks survives as one TOML string', () => {
    const instructions = stream({ systemPrompt: 'Rule one.\nSay "done" when done.' }).args.find((arg) => arg.startsWith('developer_instructions='));
    expect(instructions).toBe('developer_instructions="Rule one.\\nSay \\"done\\" when done."');
  });

  test('it runs in the state directory, where its saved threads are looked up', () => {
    expect([codexRunner.workspace('run'), codexRunner.workspace('task')]).toEqual([stateDir, stateDir]);
  });
});

describe('a one-shot task', () => {
  test('a task is ephemeral, reaches no server and cannot search', () => {
    expect(shown(codexRunner.json(jsonContext(settings)))).toMatchInlineSnapshot(`
      {
        "args": [
          "exec",
          "--json",
          "--ephemeral",
          "-c",
          "sandbox_mode="read-only"",
          "-c",
          "approval_policy="never"",
          "--skip-git-repo-check",
          "-c",
          "mcp_servers={}",
          "-c",
          "tools.web_search=false",
          "--",
          "summarize this",
        ],
        "cwd": "<state>",
      }
    `);
  });

  test('model and effort apply to a task too', () => {
    const args = codexRunner.json(jsonContext({ bin: 'codex', model: 'gpt-5.4-mini', effort: 'low' })).args;
    expect([args[args.indexOf('--model') + 1], args.find((arg) => arg.startsWith('model_reasoning_effort='))]).toEqual([
      'gpt-5.4-mini',
      'model_reasoning_effort="low"',
    ]);
  });
});

describe('reading the stream', () => {
  test('a recorded turn establishes the thread, says the answer and finishes', () => {
    expect(read('0.155.1-fresh.jsonl')).toEqual([
      ['session', '01a0c578-947f-7460-aa12-a9987c8ec2d5'],
      ['text', 'ok'],
      ['usage', { contextTokens: 14611, outputTokens: 5 }],
      ['done', 'end_turn'],
    ]);
  });

  test('a recorded follow-up reports the thread it resumed', () => {
    expect(read('0.155.1-resumed.jsonl')).toEqual([
      ['session', '01a0c578-947f-7460-aa12-a9987c8ec2d5'],
      ['text', 'done'],
      ['usage', { contextTokens: 29803, outputTokens: 10 }],
      ['done', 'end_turn'],
    ]);
  });

  test('a refused model fails the run with the sentence from the API, and says what to do', () => {
    const calls = read('0.155.1-unknown-model.jsonl');
    expect([calls.find(([signal]) => signal === 'fail'), calls.some(([signal]) => signal === 'done')]).toEqual([
      [
        'fail',
        'AGENT_FAILED',
        "The 'gpt-nonexistent-9' model is not supported when using Codex with a ChatGPT account. Pick another model for Codex in the Browsentic popup, then try again.",
      ],
      false,
    ]);
  });

  test('a message sent as growing snapshots is said once, and the next message in full', () => {
    expect(read('snapshots.hand-written.jsonl')).toEqual([
      ['session', '01a0c580-1d2e-7f30-8a41-5b6c7d8e9f00'],
      ['text', 'Looking'],
      ['text', ' it up'],
      ['text', '.'],
      ['tool', 'item_1', 'web_search'],
      ['text', 'It costs $12 a month.'],
      ['usage', { contextTokens: 20045, outputTokens: 45 }],
      ['done', 'end_turn'],
    ]);
  });

  test('the older protocol is read too, without repeating the message its deltas already said', () => {
    expect(read('legacy.hand-written.jsonl')).toEqual([
      ['session', '3e9a7b21-6c4d-4f80-b1a2-9d8e7f6c5b4a'],
      ['text', 'It costs '],
      ['text', '$12.'],
      ['tool', expect.any(String), 'web_search'],
      ['usage', { contextTokens: 16030, outputTokens: 80 }],
      ['done', 'end_turn'],
    ]);
  });

  test('an older error fails the run', () => {
    expect(readLines({ msg: { type: 'error', message: 'stream disconnected before completion' } })).toEqual([
      ['fail', 'AGENT_FAILED', 'stream disconnected before completion'],
    ]);
  });

  test('a failure with nothing to say still fails, in words', () => {
    expect(readLines({ type: 'turn.failed' }, { type: 'error' }, { msg: { type: 'error' } })).toEqual([
      ['fail', 'AGENT_FAILED', 'Codex could not finish the turn'],
      ['fail', 'AGENT_FAILED', 'Codex reported an error'],
      ['fail', 'AGENT_FAILED', 'Codex reported an error'],
    ]);
  });

  test('a model that does not exist is explained the same way as a refused one', () => {
    const message = JSON.stringify({ error: { message: 'The model `gpt-9` does not exist' } });
    expect(readLines({ type: 'error', message })).toEqual([
      ['fail', 'AGENT_FAILED', 'The model `gpt-9` does not exist Pick another model for Codex in the Browsentic popup, then try again.'],
    ]);
  });

  test('lines it does not understand are passed over', () => {
    expect(readThrough(codexRunner, ['not json', '{"type":"turn.started"}', '{"msg":{"type":"exec_command_begin"}}', '{"type":"thread.started"}'])).toEqual(
      [],
    );
  });
});

describe('the answer to a one-shot task', () => {
  test('is the last message it completed', () => {
    expect(codexRunner.answer(recorded('0.155.1-fresh.jsonl'))).toEqual({ text: 'ok' });
  });

  test('a refused model is an error, not an answer', () => {
    expect(codexRunner.answer(recorded('0.155.1-unknown-model.jsonl')).error).toContain(
      "The 'gpt-nonexistent-9' model is not supported when using Codex with a ChatGPT account.",
    );
  });

  test('the older protocol answers too', () => {
    expect(codexRunner.answer('{"msg":{"type":"agent_message","message":"A pricing page."}}')).toEqual({ text: 'A pricing page.' });
  });

  test('an older error is the error', () => {
    expect(codexRunner.answer('{"msg":{"type":"error","error":"quota exceeded"}}')).toEqual({ error: 'quota exceeded' });
  });

  test('output with no message is no answer', () => {
    expect(codexRunner.answer('Reading additional input from stdin...')).toEqual({});
  });
});

describe('what a failed start is explained as', () => {
  test('an untrusted directory names the one to trust', () => {
    expect(codexRunner.hint?.('Error: Not inside a trusted directory and --skip-git-repo-check was not specified.')).toBe(
      `Codex refused to run in ${stateDir}. Run "codex" there once and trust the directory, then try again.`,
    );
  });

  test('a signed-out Codex is told to log in', () => {
    expect(codexRunner.hint?.('unexpected status 401 Unauthorized')).toBe(
      'Codex is installed but not signed in. Run "codex login", then try again.',
    );
  });

  test('a Codex too old for the flags is told to update', () => {
    expect(codexRunner.hint?.("error: unexpected argument '--json' found\n")).toBe(
      "Your Codex does not understand the flags Browsentic uses. Update Codex, then try again. (error: unexpected argument '--json' found)",
    );
  });

  test('anything else is left to the exit code', () => {
    expect(codexRunner.hint?.('thread panicked')).toBeNull();
  });
});

test("the user's own skills and prompts are listed from ~/.codex", () => {
  expect(codexRunner.skillDirs?.()).toEqual([join(homedir(), '.codex', 'skills'), join(homedir(), '.codex', 'prompts')]);
});
