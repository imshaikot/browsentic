import { existsSync, mkdirSync, utimesSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { stateDir } from '../../lockfile';
import { grokRunner } from './grok';
import { jsonContext, readThrough, shown, streamContext, transcript, valueOf } from './fixtures/support';

const settings = { bin: 'grok' };
const stream = (overrides: Parameters<typeof streamContext>[1] = {}) => grokRunner.stream(streamContext(settings, overrides));
const task = (overrides: Parameters<typeof jsonContext>[1] = {}) => grokRunner.json(jsonContext(settings, overrides));
const read = (name: string, only?: Parameters<typeof readThrough>[2]) => readThrough(grokRunner, transcript('grok', name), only);
const readLines = (...lines: object[]) => readThrough(grokRunner, lines.map((line) => JSON.stringify(line)));
const recorded = (name: string) => transcript('grok', name).join('\n');

const SESSION = '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a streamed run', () => {
  test('a fresh run is contained by flags, and only the browser server is written to disk', () => {
    expect(shown(stream())).toMatchInlineSnapshot(`
      {
        "args": [
          "-p",
          "what does this page cost",
          "--output-format",
          "streaming-json",
          "--permission-mode",
          "dontAsk",
          "--allow",
          "MCPTool(browsentic__*)",
          "--tools",
          "todo_write",
          "--deny",
          "Bash",
          "--deny",
          "Edit",
          "--deny",
          "Write",
          "--deny",
          "Read",
          "--no-subagents",
          "--sandbox",
          "workspace",
          "--rules",
          "You are Browsentic.

      Browsentic's tools are on the MCP server named browsentic. Call them with use_tool, prefixing each name with "browsentic__": page_getPageInfo is browsentic__page_getPageInfo.",
          "--session-id",
          "<uuid>",
        ],
        "cwd": "<state>/agents/grok/run/<uuid>",
        "env": {
          "BROWSENTIC_AGENT_RUN": "run-1",
          "GROK_CLAUDE_MCPS_ENABLED": "false",
          "GROK_CURSOR_MCPS_ENABLED": "false",
          "GROK_FOLDER_TRUST": "0",
          "GROK_MEMORY": "0",
        },
        "files": [
          {
            "content": "[mcp_servers.browsentic]
      command = "/usr/local/bin/node"
      args = ["/usr/local/lib/node_modules/browsentic/dist/cli.js", "mcp"]
      env = { BROWSENTIC_AGENT_RUN = "run-1" }
      ",
            "path": ".grok/config.toml",
          },
        ],
      }
    `);
  });

  test('a fresh run names its own session, and runs in a directory named after it', () => {
    const plan = stream();
    expect(valueOf(plan.args, '--session-id')).toBe(basename(plan.cwd));
  });

  test('a follow-up resumes the session in the directory its conversation started in', () => {
    const plan = stream({ sessionId: SESSION });
    expect({ resume: valueOf(plan.args, '--resume'), fresh: plan.args.includes('--session-id'), cwd: plan.cwd }).toEqual({
      resume: SESSION,
      fresh: false,
      cwd: join(grokRunner.workspace('run'), SESSION),
    });
  });

  test('a session id that is not a plain id cannot steer where the run happens', () => {
    expect(stream({ sessionId: '../../../etc' }).cwd).toBe(join(grokRunner.workspace('run'), '_________etc'));
  });

  test('research swaps the inert tool for web search and fetch, and changes nothing else', () => {
    const [plain, research] = [stream().args, stream({ research: true }).args];
    const changed = plain.flatMap((arg, at) => (arg === research[at] || arg === valueOf(plain, '--session-id') ? [] : [[arg, research[at]]]));
    expect(changed).toEqual([['todo_write', 'web_search,web_fetch']]);
  });

  test('the system prompt goes in as rules, followed by how Grok names the browser tools', () => {
    expect(valueOf(stream().args, '--rules')).toBe(
      'You are Browsentic.\n\n' +
        'Browsentic\'s tools are on the MCP server named browsentic. Call them with use_tool, prefixing each name with "browsentic__": page_getPageInfo is browsentic__page_getPageInfo.',
    );
  });

  test('the chosen model and effort are passed through', () => {
    const args = grokRunner.stream(streamContext({ bin: 'grok', model: 'grok-4.7', effort: 'xhigh' })).args;
    expect(args.slice(-4)).toEqual(['--model', 'grok-4.7', '--reasoning-effort', 'xhigh']);
  });

  test('an effort Grok does not accept is dropped rather than failing the run', () => {
    expect(grokRunner.stream(streamContext({ bin: 'grok', effort: 'max' })).args).not.toContain('--reasoning-effort');
  });

  test("yesterday's conversation directories are swept when a new run starts, and today's are kept", () => {
    const base = grokRunner.workspace('run');
    const [old, recent] = [join(base, 'conv-old'), join(base, 'conv-recent')];
    for (const dir of [old, recent]) mkdirSync(dir, { recursive: true });
    const yesterday = (Date.now() - 25 * 60 * 60_000) / 1000;
    utimesSync(old, yesterday, yesterday);
    stream();
    expect([existsSync(old), existsSync(recent)]).toEqual([false, true]);
  });
});

describe('a one-shot task', () => {
  test('a task writes nothing, refuses every MCP call and stays in a read-only sandbox', () => {
    expect(shown(task())).toMatchInlineSnapshot(`
      {
        "args": [
          "-p",
          "summarize this",
          "--output-format",
          "json",
          "--permission-mode",
          "dontAsk",
          "--tools",
          "todo_write",
          "--deny",
          "MCPTool",
          "--deny",
          "Bash",
          "--deny",
          "Edit",
          "--deny",
          "Write",
          "--no-subagents",
          "--sandbox",
          "read-only",
        ],
        "cwd": "<state>/agents/grok/task",
        "env": {
          "GROK_CLAUDE_MCPS_ENABLED": "false",
          "GROK_CURSOR_MCPS_ENABLED": "false",
          "GROK_MEMORY": "0",
        },
      }
    `);
  });

  test('a task handed a file may read it, and nothing else changes', () => {
    const [plain, reading] = [task().args, task({ reads: true }).args];
    expect(plain.flatMap((arg, at) => (arg === reading[at] ? [] : [[arg, reading[at]]]))).toEqual([['todo_write', 'read_file']]);
  });

  test('runs and tasks never share a directory', () => {
    expect(dirname(stream().cwd)).not.toBe(task().cwd);
  });
});

describe('reading the stream', () => {
  test('a turn says its answer, reports what it cost, names its session and finishes', () => {
    expect(read('turn.hand-written.jsonl')).toEqual([
      ['text', 'It costs '],
      ['text', '$12 a month.'],
      ['usage', { contextTokens: 4857, outputTokens: 45 }],
      ['session', SESSION],
      ['done', 'end_turn'],
    ]);
  });

  test('a Browsentic call and a tool lookup are left to the daemon; web search and another server are reported once each', () => {
    expect(read('tool-loop.hand-written.jsonl', 'tool')).toEqual([
      ['tool', 'call_3', 'web_search'],
      ['tool', 'call_4', 'github__create_issue'],
    ]);
  });

  test('each model response after the first starts a new paragraph', () => {
    expect(
      read('tool-loop.hand-written.jsonl', 'text')
        .map(([, text]) => text)
        .join(''),
    ).toBe('Let me read the page first.\n\nIt costs $12 a month.');
  });

  test('usage is reported per response, with the output added up', () => {
    expect(read('tool-loop.hand-written.jsonl', 'usage')).toEqual([
      ['usage', { contextTokens: 3930, outputTokens: 30 }],
      ['usage', { contextTokens: 4320, outputTokens: 50 }],
      ['usage', { contextTokens: 4460, outputTokens: 60 }],
    ]);
  });

  test('a turn with no usage lines reports the total the end line carries', () => {
    expect(readLines({ type: 'end', stopReason: 'end_turn', sessionId: SESSION, usage: { input_tokens: 100, output_tokens: 7 } })).toEqual([
      ['session', SESSION],
      ['usage', { contextTokens: 107, outputTokens: 7 }],
      ['done', 'end_turn'],
    ]);
  });

  test('the toolset a contained run is offered passes without a word', () => {
    expect(readLines({ type: 'available_commands', tools: ['todo_write', 'search_tool', 'use_tool'], commands: [] })).toEqual([]);
  });

  test('a toolset with the shell or file tools in it stops the run before the model sees it', () => {
    expect(read('1.0.40-every-tool.jsonl')).toEqual([
      [
        'fail',
        'AGENT_UNSAFE',
        'Grok Build offered this run run_terminal_command, read_file, search_replace, list_dir, grep, kill_command_or_subagent, get_command_or_subagent_output, spawn_subagent, scheduler_create, scheduler_delete, scheduler_list, monitor, workflow, enter_plan_mode, exit_plan_mode, ask_user_question, send_feedback, image_gen, image_edit, image_to_video, reference_to_video, write, which Browsentic never asks for, so the run was stopped before the model saw them. Update Grok Build and Browsentic; if it persists, please report it.',
      ],
    ]);
  });

  test('a rate-limited account fails after Grok gives up retrying, and says what is going on', () => {
    expect(read('1.0.40-rate-limited.jsonl')).toEqual([
      [
        'fail',
        'AGENT_FAILED',
        expect.stringMatching(/^xAI did not answer, after Grok Build had retried for several minutes\. A free Grok account is rate-limited this way; wait and try again\. \(Internal error: /),
      ],
    ]);
  });

  test('a signed-out Grok is told to sign in', () => {
    expect(read('1.0.40-not-signed-in.jsonl')).toEqual([
      ['fail', 'AGENT_FAILED', 'Grok Build is installed but not signed in. Run "grok login", or set XAI_API_KEY, then try again.'],
    ]);
  });

  test('a model the account does not have says so, and where to pick another', () => {
    expect(read('1.0.40-unknown-model.jsonl')).toEqual([
      [
        'fail',
        'AGENT_FAILED',
        'Couldn\'t set model \'grok-nope\': Invalid params: "unknown model id". Run \'grok models\' to see available models. Pick another model for Grok Build in the Browsentic popup, then try again.',
      ],
    ]);
  });

  test('an effort the model does not offer says so, and where to pick another', () => {
    expect(read('1.0.40-unknown-effort.jsonl')).toEqual([
      [
        'fail',
        'AGENT_FAILED',
        "--effort/--reasoning-effort: unknown effort level 'ultra'; use one of: xhigh, high, medium, low. Pick another effort for Grok Build in the Browsentic popup, then try again.",
      ],
    ]);
  });

  test('a rate limit Grok reports at once is explained the same way', () => {
    expect(readLines({ type: 'error', message: 'Some resource has been exhausted: You are sending requests too quickly.' })).toEqual([
      [
        'fail',
        'AGENT_FAILED',
        'xAI is rate-limiting this Grok account. Wait a few minutes and try again, or upgrade at https://grok.com/supergrok. (Some resource has been exhausted: You are sending requests too quickly.)',
      ],
    ]);
  });

  test('an error with nothing to say still fails, in words', () => {
    expect(readLines({ type: 'error' })).toEqual([['fail', 'AGENT_FAILED', 'Grok Build reported an error']]);
  });

  test('lines it does not understand are passed over', () => {
    expect(readThrough(grokRunner, ['not json', '{"type":"max_turns_reached"}', '{"type":"thought","data":"hm"}'])).toEqual([]);
  });
});

describe('the answer to a one-shot task', () => {
  test('is the text of the result', () => {
    expect(grokRunner.answer(JSON.stringify({ text: 'A pricing page.', stopReason: 'end_turn', sessionId: SESSION }))).toEqual({
      text: 'A pricing page.',
    });
  });

  test('a signed-out Grok is an error, not an answer', () => {
    expect(grokRunner.answer(recorded('1.0.40-not-signed-in.jsonl'))).toEqual({
      error: 'Grok Build is installed but not signed in. Run "grok login", or set XAI_API_KEY, then try again.',
    });
  });

  test('output with no result is no answer', () => {
    expect(grokRunner.answer('')).toEqual({ text: undefined });
  });
});

describe('what a failed start is explained as', () => {
  test('the error Grok printed, with what to do about it', () => {
    expect(grokRunner.hint?.("Error: Couldn't set model 'grok-nope': Invalid params: \"unknown model id\".\n")).toMatch(
      /Pick another model for Grok Build in the Browsentic popup/,
    );
  });

  test('a Grok too old for the flags is told to update', () => {
    expect(grokRunner.hint?.("error: unexpected argument '--sandbox' found\n")).toBe(
      'Your Grok Build does not understand the flags Browsentic uses. Run "grok update", then try again. (error: unexpected argument \'--sandbox\' found)',
    );
  });

  test('anything else is left to the exit code', () => {
    expect(grokRunner.hint?.('segmentation fault')).toBeNull();
  });
});

test("the user's own skills are listed from Grok's home, the shared agents folder and Claude Code's", () => {
  vi.stubEnv('GROK_HOME', '');
  expect(grokRunner.skillDirs?.()).toEqual([
    join(homedir(), '.grok', 'skills'),
    join(homedir(), '.agents', 'skills'),
    join(homedir(), '.claude', 'skills'),
  ]);
});

test('every directory a run or task uses is inside the state directory', () => {
  expect([stream().cwd, task().cwd].every((cwd) => cwd.startsWith(`${stateDir}/`))).toBe(true);
});
