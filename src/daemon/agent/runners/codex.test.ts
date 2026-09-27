import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stateDir } from '../../lockfile';
import { codexRunner } from './codex';
import type { Plan } from './types';
import { jsonContext, readThrough, shown, streamContext, transcript } from './fixtures/support';

const settings = { bin: 'codex' };
const stream = (overrides: Parameters<typeof streamContext>[1] = {}) => codexRunner.stream(streamContext(settings, overrides));

const INSTRUCTIONS = 'developer_instructions=';

/** The prompt is asserted on its own below; a snapshot of the flags reads better without it. */
const flagsOf = (plan: Plan): Plan => ({
  ...plan,
  args: plan.args.map((arg) => (arg.startsWith(INSTRUCTIONS) ? `${INSTRUCTIONS}<prompt>` : arg)),
});

const instructionsIn = (args: string[]): string =>
  JSON.parse(args.find((arg) => arg.startsWith(INSTRUCTIONS))?.slice(INSTRUCTIONS.length) ?? '""') as string;
const read = (name: string, only?: Parameters<typeof readThrough>[2]) => readThrough(codexRunner, transcript('codex', name), only);
const readLines = (...lines: object[]) => readThrough(codexRunner, lines.map((line) => JSON.stringify(line)));
const recorded = (name: string) => transcript('codex', name).join('\n');

// A run leaves config.toml out but carries its model and effort over, so every test gets an empty CODEX_HOME.
const home = join(stateDir, 'codex-home');
const userConfig = (toml: string) => writeFileSync(join(home, 'config.toml'), toml);

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  vi.stubEnv('CODEX_HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('a streamed run', () => {
  test('a fresh run registers the browser as its only server and stays in a read-only sandbox', () => {
    expect(flagsOf(shown(stream()))).toMatchInlineSnapshot(`
      {
        "args": [
          "exec",
          "--json",
          "--ignore-user-config",
          "-c",
          "sandbox_mode="read-only"",
          "-c",
          "approval_policy="never"",
          "--skip-git-repo-check",
          "-c",
          "features.shell_tool=false",
          "-c",
          "features.view_image=false",
          "-c",
          "features.multi_agent=false",
          "-c",
          "features.goals=false",
          "-c",
          "features.tool_suggest=false",
          "-c",
          "features.apps=false",
          "-c",
          "features.plugins=false",
          "-c",
          "features.image_generation=false",
          "-c",
          "features.browser_use=false",
          "-c",
          "features.computer_use=false",
          "-c",
          "include_apps_instructions=false",
          "-c",
          "skills.include_instructions=false",
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
          "mcp_servers.browsentic.startup_timeout_sec=30",
          "-c",
          "mcp_servers.browsentic.tool_timeout_sec=1800",
          "-c",
          "developer_instructions=<prompt>",
          "-c",
          "web_search="disabled"",
          "-c",
          "tool_output_token_limit=25000",
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

  // A `-c` override merges into config.toml: the user's other servers still start, and keys on their own
  // `browsentic` entry — an enabled_tools list among them — land on the run's. Measured against 0.155.1.
  test("the user's config.toml is left out of a run and a task alike, so no server of theirs starts beside the browser", () => {
    expect([stream().args, stream({ sessionId: 'thread-1' }).args, codexRunner.json(jsonContext(settings)).args].map((args) => args.includes('--ignore-user-config'))).toEqual([
      true,
      true,
      true,
    ]);
  });

  // The ceiling a Claude run's calls effectively have: an approval card waits on the user, page_awaitMonitor up to ten minutes.
  test('a browser call is waited on for as long as an approval or a long watch can take', () => {
    expect(stream().args).toContain('mcp_servers.browsentic.tool_timeout_sec=1800');
  });

  // The `tools.web_search` this used to pass is a key Codex 0.155 no longer knows, and an unknown
  // key is ignored in silence — so every run had web search, and reached for it before the browser.
  test('research turns web search on, and it is off otherwise', () => {
    expect([stream({ research: true }).args, stream().args].map((args) => args.find((arg) => arg.startsWith('web_search=')))).toEqual([
      'web_search="live"',
      'web_search="disabled"',
    ]);
    expect(stream().args.some((arg) => arg.startsWith('tools.web_search'))).toBe(false);
  });

  // Measured with a stand-in model: the shell switch takes exec_command and write_stdin away from every
  // model, sub-agents included, and a code-mode model still reaches the browser from inside its exec.
  test('a run has no shell and no image viewer, and none of what Codex does beside coding', () => {
    expect(stream().args.filter((arg) => /^(features\.|include_|skills\.)/.test(arg))).toEqual([
      'features.shell_tool=false',
      'features.view_image=false',
      'features.multi_agent=false',
      'features.goals=false',
      'features.tool_suggest=false',
      'features.apps=false',
      'features.plugins=false',
      'features.image_generation=false',
      'features.browser_use=false',
      'features.computer_use=false',
      'include_apps_instructions=false',
      'skills.include_instructions=false',
    ]);
  });

  // Codex defers an MCP server's tools behind tool_search, so a run that says nothing about them
  // watches the model answer from the tools it can see: its own memory and a web search.
  test('the prompt says how to reach tools Codex has not loaded, and to read the page rather than recall it', () => {
    const instructions = instructionsIn(stream().args);
    expect(instructions.startsWith('You are Browsentic.')).toBe(true);
    expect(instructions).toContain('tool_search');
    expect(instructions).toContain('tools.mcp__browsentic__');
    expect(instructions).toContain('image(result.content[0])');
    expect(instructions).toMatch(/never answer from memory/i);
  });

  test('a tool result reaches the model whole up to the size a Claude run gets, and a code-mode script is told how to ask for it', () => {
    const args = stream().args;
    expect(args).toContain('tool_output_token_limit=25000');
    expect(instructionsIn(args)).toContain('// @exec: {"max_output_tokens": 25000}');
  });

  // A mapping run is asked to research the domain, so its prompt cannot also forbid the search.
  test('a research run may search the web for background, and any other run is told not to', () => {
    expect([stream({ research: true }).args, stream().args].map((args) => instructionsIn(args).includes('from a web search'))).toEqual([false, true]);
  });

  test('the chosen model and effort are passed through', () => {
    const args = codexRunner.stream(streamContext({ bin: 'codex', model: 'gpt-5.4', effort: 'xhigh' })).args;
    expect([args[args.indexOf('--model') + 1], args.find((arg) => arg.startsWith('model_reasoning_effort='))]).toEqual([
      'gpt-5.4',
      'model_reasoning_effort="xhigh"',
    ]);
  });

  test("with nothing picked in Browsentic, the model and effort from the user's own config.toml carry over", () => {
    userConfig('model = "gpt-5.6-terra" # the one I use\nmodel_reasoning_effort = \'high\'\n\n[profiles.fast]\nmodel = "gpt-5.5"\n');
    const args = stream().args;
    expect([args[args.indexOf('--model') + 1], args.find((arg) => arg.startsWith('model_reasoning_effort='))]).toEqual([
      'gpt-5.6-terra',
      'model_reasoning_effort="high"',
    ]);
  });

  test("what was picked in Browsentic wins over config.toml, and a model there that could pass for a flag is left out", () => {
    userConfig('model = "gpt-5.6-terra"\nmodel_reasoning_effort = "high"\n');
    const picked = codexRunner.stream(streamContext({ bin: 'codex', model: 'gpt-5.5', effort: 'low' })).args;
    userConfig('model = "--dangerously-bypass-approvals-and-sandbox"\n');
    expect([picked[picked.indexOf('--model') + 1], picked.includes('model_reasoning_effort="low"'), stream().args.includes('--model')]).toEqual([
      'gpt-5.5',
      true,
      false,
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
    const args = stream({ systemPrompt: 'Rule one.\nSay "done" when done.' }).args;
    const raw = args.find((arg) => arg.startsWith('developer_instructions='));
    expect(raw?.startsWith('developer_instructions="Rule one.\\nSay \\"done\\" when done.\\n\\n')).toBe(true);
    expect(instructionsIn(args).startsWith('Rule one.\nSay "done" when done.\n\n')).toBe(true);
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
          "--ignore-user-config",
          "-c",
          "sandbox_mode="read-only"",
          "-c",
          "approval_policy="never"",
          "--skip-git-repo-check",
          "-c",
          "features.shell_tool=false",
          "-c",
          "features.view_image=false",
          "-c",
          "features.multi_agent=false",
          "-c",
          "features.goals=false",
          "-c",
          "features.tool_suggest=false",
          "-c",
          "features.apps=false",
          "-c",
          "features.plugins=false",
          "-c",
          "features.image_generation=false",
          "-c",
          "features.browser_use=false",
          "-c",
          "features.computer_use=false",
          "-c",
          "include_apps_instructions=false",
          "-c",
          "skills.include_instructions=false",
          "-c",
          "web_search="disabled"",
          "--",
          "summarize this",
        ],
        "cwd": "<state>",
      }
    `);
  });

  test('a text file is read through the shell, inside the read-only sandbox; a picture comes attached, with the shell off', () => {
    const [text, picture] = [jsonContext(settings, { reads: true }), jsonContext(settings, { reads: true, image: '/state/tmp/grid.png' })].map(
      (context) => codexRunner.json(context).args,
    );
    expect({
      textShell: text.includes('features.shell_tool=false'),
      pictureShell: picture.includes('features.shell_tool=false'),
      attached: picture[picture.indexOf('--image') + 1],
      viewer: [text, picture].every((args) => args.includes('features.view_image=false')),
    }).toEqual({ textShell: false, pictureShell: true, attached: '/state/tmp/grid.png', viewer: true });
  });

  // `-i` hands a PNG over as an image, and a PDF as "image content omitted because it could not be processed".
  test('opens text and pictures, not PDFs', () => {
    expect(codexRunner.opens).toEqual(['text', 'image']);
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
      ['done', 'end_turn'],
    ]);
  });

  test('a recorded follow-up reports the thread it resumed', () => {
    expect(read('0.155.1-resumed.jsonl')).toEqual([
      ['session', '01a0c578-947f-7460-aa12-a9987c8ec2d5'],
      ['text', 'done'],
      ['done', 'end_turn'],
    ]);
  });

  // 1,000 + 2,000 + 3,000 + 4,000 scripted, 10,000 reported: nothing in it is the size of the window.
  test("a turn's usage is left unreported, since Codex adds up every request of the turn and the thread", () => {
    expect([read('0.155.1-two-calls.jsonl', 'usage'), read('0.155.1-two-calls.jsonl', 'tool')]).toEqual([[], []]);
  });

  test('a web search opens a row when it starts and closes it when it ends', () => {
    const id = 'ws_01a0e2a1-038c-72f1-b448-c2ec55a7d7de';
    expect(read('0.155.1-web-search.jsonl').filter(([signal]) => signal === 'tool' || signal === 'toolResult')).toEqual([
      ['tool', id, 'web_search'],
      ['toolResult', id, true],
    ]);
  });

  test('a shell command stops the run, because a run has its shell switched off', () => {
    expect(read('0.155.1-shell.jsonl').slice(0, 2)).toEqual([
      ['session', '01a0e2a0-f8b9-7011-a7e4-7860ac73b6c3'],
      [
        'fail',
        'AGENT_UNSAFE',
        'Codex ran a shell command in a run Browsentic keeps to the browser, so the run was stopped. Update Codex and Browsentic; if it persists, please report it.',
      ],
    ]);
    expect(readLines({ type: 'item.completed', item: { id: 'item_4', type: 'file_change', changes: [] } })[0]?.[1]).toBe('AGENT_UNSAFE');
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
      ['toolResult', 'item_1', true],
      ['text', 'It costs $12 a month.'],
      ['done', 'end_turn'],
    ]);
  });

  test('the older protocol is read too, without repeating the message its deltas already said', () => {
    expect(read('legacy.hand-written.jsonl')).toEqual([
      ['session', '3e9a7b21-6c4d-4f80-b1a2-9d8e7f6c5b4a'],
      ['text', 'It costs '],
      ['text', '$12.'],
      ['tool', 'ws_1', 'web_search'],
      ['toolResult', 'ws_1', true],
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

  // Recorded from 0.155.1 with the server's command pointing nowhere.
  test('browser tools that did not start say so, in the words a Claude run uses', () => {
    expect(
      codexRunner.hint?.(
        'Error: thread/start: thread/start failed: error creating thread: Fatal error: Failed to initialize session: required MCP servers failed to initialize: browsentic: handshaking with MCP server failed: connection closed: initialize response (code -32603)',
      ),
    ).toBe('Codex could not start Browsentic\'s browser tools, so this run could not reach the page. Run "browsentic restart", then send the message again.');
  });

  test('anything else is left to the exit code', () => {
    expect(codexRunner.hint?.('thread panicked')).toBeNull();
  });
});

test("the user's own skills and prompts are listed from CODEX_HOME", () => {
  expect(codexRunner.skillDirs?.()).toEqual([join(home, 'skills'), join(home, 'prompts')]);
});

// Measured against 0.155.1: a resumed thread is sent the developer_instructions it began with, whatever a later turn passes.
test('keeps the prompt its thread began with, so the daemon carries what changed in the message', () => {
  expect(codexRunner.keepsFirstPrompt).toBe(true);
});
