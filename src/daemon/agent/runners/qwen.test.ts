import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stateDir } from '../../lockfile';
import { qwenRunner } from './qwen';
import { jsonContext, readThrough, shown, streamContext, transcript, valuesOf, valueOf } from './fixtures/support';

const settings = { bin: 'qwen' };
const stream = (overrides: Parameters<typeof streamContext>[1] = {}) => qwenRunner.stream(streamContext(settings, overrides));
const task = (overrides: Parameters<typeof jsonContext>[1] = {}) => qwenRunner.json(jsonContext(settings, overrides));
const read = (name: string, only?: Parameters<typeof readThrough>[2]) => readThrough(qwenRunner, transcript('qwen', name), only);
/** One line of a transcript by what it is, so an added event never shifts a test onto another line. */
const lineOf = (name: string, type: string, nth = 0) =>
  transcript('qwen', name).filter((raw) => (JSON.parse(raw) as { type?: string }).type === type)[nth];

const SESSION = '9a1d0f22-4c7e-4c1b-9b1e-2f6c5d8a0b31';
const RESUME = '0199b1c2-3d4e-5f60-7182-93a4b5c6d7e8';

// check() reads the environment and ~/.qwen, and the machine running the tests has its own of both.
const home = join(stateDir, 'qwen-home');

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  vi.stubEnv('HOME', home);
  vi.stubEnv('QWEN_HOME', '');
  for (const name of ['QWEN_API_KEY', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY', 'BAILIAN_CODING_PLAN_API_KEY']) {
    vi.stubEnv(name, '');
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('a streamed run', () => {
  test('a fresh run purges the ambient config, allows one server, and denies the machine', () => {
    expect(shown(stream())).toMatchInlineSnapshot(`
      {
        "args": [
          "-p",
          "what does this page cost",
          "--safe-mode",
          "--output-format",
          "stream-json",
          "--include-partial-messages",
          "--approval-mode",
          "default",
          "--mcp-config",
          "{"mcpServers":{"browsentic":{"command":"/usr/local/bin/node","args":["/usr/local/lib/node_modules/browsentic/dist/cli.js","mcp"],"env":{"BROWSENTIC_AGENT_RUN":"run-1"}}}}",
          "--allowed-mcp-server-names",
          "browsentic",
          "--allowed-tools",
          "mcp__browsentic",
          "--exclude-tools",
          "Bash",
          "exec",
          "Edit",
          "Read",
          "zoom_image",
          "monitor",
          "lsp",
          "save_memory",
          "skill",
          "agent",
          "create_sub_session",
          "workflow",
          "send_message",
          "team_create",
          "team_delete",
          "cron_create",
          "cron_list",
          "cron_delete",
          "loop_wakeup",
          "propose_goal",
          "artifact",
          "record_artifact",
          "record_source",
          "image_gen",
          "read_mcp_resource",
          "web_search",
          "web_fetch",
          "--append-system-prompt",
          "You are Browsentic.",
          "--session-id",
          "<uuid>",
        ],
        "cwd": "<state>/agents/qwen/run",
        "env": {
          "BROWSENTIC_AGENT_RUN": "run-1",
        },
      }
    `);
  });

  test('nothing is written to disk, which is the whole point of this runner', () => {
    expect([stream().files, task().files]).toEqual([undefined, undefined]);
  });

  test('the prompt leads, so no array-typed flag can swallow it', () => {
    expect([stream().args[0], stream().args[1]]).toEqual(['-p', 'what does this page cost']);
    expect([task().args[0], task().args[1]]).toEqual(['-p', 'summarize this']);
  });

  test('a resumed turn names the session it is continuing, and mints none of its own', () => {
    const args = stream({ sessionId: RESUME }).args;
    expect([valueOf(args, '--resume'), args.includes('--session-id')]).toEqual([RESUME, false]);
  });

  test('a fresh turn mints a session id rather than being told one', () => {
    const first = valueOf(stream().args, '--session-id');
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(valueOf(stream().args, '--session-id')).not.toBe(first);
  });

  test('research switches the web tools from the deny list to the allow list', () => {
    const plain = stream();
    const research = stream({ research: true });
    expect([
      valuesOf(plain.args, '--exclude-tools').includes('web_search'),
      valuesOf(plain.args, '--allowed-tools').includes('web_search'),
      valuesOf(research.args, '--exclude-tools').includes('web_search'),
      valuesOf(research.args, '--allowed-tools').includes('web_search'),
    ]).toEqual([true, false, false, true]);
  });

  test('the model is passed only when one is pinned', () => {
    expect([valueOf(stream().args, '--model'), valueOf(stream({ settings: { ...settings, model: 'qwen3.7-plus' } }).args, '--model')]).toEqual([
      undefined,
      'qwen3.7-plus',
    ]);
  });

  test('an effort is dropped, because this CLI has no flag for one', () => {
    expect([qwenRunner.efforts, stream({ settings: { ...settings, effort: 'high' } }).args.includes('--effort')]).toEqual([[], false]);
  });

  test('a one-shot loads no MCP server at all, and reaches no browser', () => {
    const args = task().args;
    expect([valueOf(args, '--mcp-config'), args.includes('--allowed-mcp-server-names')]).toEqual(['{"mcpServers":{}}', false]);
  });

  test('a task that is handed a file may open that one, and nothing else that reads', () => {
    const denied = (reads: boolean) => valuesOf(task({ reads }).args, '--exclude-tools');
    expect([denied(false).includes('Read'), denied(true).includes('Read'), denied(true).includes('grep_search')]).toEqual([true, false, true]);
    expect(valuesOf(task({ reads: true }).args, '--allowed-tools')).toEqual(['read_file']);
  });

  // Sessions are filed under ~/.qwen/projects/<sanitized-cwd>, so a conversation that moved would
  // resume into a transcript Qwen files somewhere else. Vibe, Grok and Cursor all need the opposite.
  test('every conversation runs in the same directory, and no task shares it', () => {
    expect([stream().cwd, stream({ conversation: 'conversation-2', runId: 'run-2' }).cwd]).toEqual([
      qwenRunner.workspace('run'),
      qwenRunner.workspace('run'),
    ]);
    expect(qwenRunner.workspace('run')).not.toBe(qwenRunner.workspace('task'));
  });
});

describe('reading the stream', () => {
  test('a turn reports its session, its text, what it spent, and that it is done', () => {
    expect(read('turn.hand-written.jsonl')).toEqual([
      ['session', SESSION],
      ['text', 'The page '],
      ['text', 'costs $40.'],
      ['usage', { contextTokens: 10118, outputTokens: 18 }],
      ['session', SESSION],
      ['done', 'end_turn'],
    ]);
  });

  test("the model's thinking is not said out loud", () => {
    expect(read('turn.hand-written.jsonl', 'text').map(([, text]) => text).join('')).toBe('The page costs $40.');
  });

  // The assistant line repeats what the deltas already said; only its usage is new.
  test('the closing usage is not counted twice', () => {
    expect(read('turn.hand-written.jsonl', 'usage')).toHaveLength(1);
  });

  test('a run with no assistant usage still reports what the result said', () => {
    const calls = readThrough(qwenRunner, [lineOf('turn.hand-written.jsonl', 'result')], 'usage');
    expect(calls).toEqual([['usage', { contextTokens: 10118, outputTokens: 18 }]]);
  });

  test("a research run's own web search is drawn, and a browser call is left to the daemon", () => {
    expect(read('tools.hand-written.jsonl', 'tool')).toEqual([['tool', 'toolu_web_1', 'web_search']]);
  });

  test("a sub-agent's text does not reach the panel", () => {
    expect(read('tools.hand-written.jsonl', 'text')).toEqual([]);
  });

  test('an unknown event and an unparseable line are both ignored', () => {
    expect(read('tools.hand-written.jsonl').filter(([signal]) => signal === 'fail')).toEqual([]);
  });

  test('an auth failure arrives as a result, not on stderr, and says what to do', () => {
    const [[signal, code, message]] = read('error.hand-written.jsonl', 'fail');
    expect([signal, code]).toEqual(['fail', 'AGENT_FAILED']);
    expect(message).toContain('/auth');
  });
});

// --safe-mode ignores --core-tools, so the built-ins are closed by deny rules and the init line —
// which names every tool that actually registered — is what proves they took.
describe('the init line is read back as proof', () => {
  const failOf = (nth: number) => readThrough(qwenRunner, [lineOf('escaped.hand-written.jsonl', 'system', nth)], 'fail');

  test('a denied built-in that registered anyway stops the run before the model sees it', () => {
    const [[, code, message]] = failOf(0);
    expect([code, message]).toEqual(['AGENT_UNSAFE', expect.stringContaining('run_shell_command')]);
  });

  test("a second MCP server beside Browsentic's own stops the run", () => {
    const [[, code, message]] = failOf(1);
    expect([code, message]).toEqual(['AGENT_UNSAFE', expect.stringContaining('node-repl')]);
  });

  test('an approval mode Browsentic did not ask for stops the run', () => {
    const [[, code, message]] = failOf(2);
    expect([code, message]).toEqual(['AGENT_UNSAFE', expect.stringContaining('yolo')]);
  });

  // The deny list cannot name a tool that does not exist yet, so the families are matched too.
  test('a tool from a dangerous family Browsentic never knew to deny stops the run', () => {
    const [[, code, message]] = failOf(3);
    expect([code, message]).toEqual(['AGENT_UNSAFE', expect.stringContaining('computer_use__screenshot')]);
  });

  // The mode can be switched mid-session, and Qwen re-announces the session when it is.
  test('a later line that reports a switched approval mode stops the run too', () => {
    const [[, code, message]] = failOf(4);
    expect([code, message]).toEqual(['AGENT_UNSAFE', expect.stringContaining('auto')]);
  });

  test('a contained init line lets the run go on, and still reports the session', () => {
    expect(readThrough(qwenRunner, [lineOf('turn.hand-written.jsonl', 'system')])).toEqual([['session', SESSION]]);
  });
});

describe('a one-shot answer', () => {
  const array = (...messages: unknown[]) => JSON.stringify(messages);

  test('the answer is the last result in the array the CLI prints', () => {
    const stdout = array(
      { type: 'system', subtype: 'init', session_id: SESSION },
      { type: 'result', subtype: 'success', is_error: false, result: 'a first answer' },
      { type: 'result', subtype: 'success', is_error: false, result: 'the last answer' },
    );
    expect(qwenRunner.answer(stdout)).toEqual({ text: 'the last answer' });
  });

  test('a failed one-shot reports the CLI’s own sentence', () => {
    const stdout = array({ type: 'result', subtype: 'error_during_execution', is_error: true, error: { message: 'model overloaded' } });
    expect(qwenRunner.answer(stdout)).toEqual({ error: 'model overloaded' });
  });

  test('output that is not an array of messages is no answer at all', () => {
    expect([qwenRunner.answer('not json'), qwenRunner.answer('{"type":"result"}'), qwenRunner.answer('[]')]).toEqual([{}, {}, {}]);
  });
});

describe('what the CLI says when it cannot start', () => {
  test('the -p deprecation notice is not mistaken for a failure', () => {
    expect(qwenRunner.hint?.('[DEPRECATED] --prompt: Use the positional prompt instead.\n')).toBeNull();
  });

  test('no configured provider says which two ways there are to configure one', () => {
    const hint = qwenRunner.hint?.('No auth type is selected. Please configure an auth type');
    expect(hint).toContain('/auth');
    expect(hint).toContain('OPENAI_API_KEY');
  });

  test('a session id the CLI refuses is reported as a Browsentic bug, because Browsentic minted it', () => {
    expect(qwenRunner.hint?.(`Error: Session Id ${SESSION} already exists (active or archived).`)).toContain('bug in Browsentic');
  });

  test('a flag this Qwen does not know asks for an update', () => {
    expect(qwenRunner.hint?.('Unknown argument: safe-mode')).toContain('npm i -g @qwen-code/qwen-code');
  });

  test('anything else is left alone', () => {
    expect(qwenRunner.hint?.('Killed: 9')).toBeNull();
  });
});

describe('readiness', () => {
  const problem = async () => (await qwenRunner.check?.({ bin: 'qwen' })) ?? null;

  test('with no provider anywhere, the fix names both ways to configure one', async () => {
    const found = await problem();
    expect([found?.code, found?.fix]).toEqual(['AGENT_NEEDS_PERMISSION', expect.stringContaining('/auth')]);
  });

  test('a key the run can still see is enough', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    expect(await problem()).toBeNull();
  });

  // ANTHROPIC_ and GEMINI_ are auth types Qwen accepts, but sealEnv does not hand them to a run,
  // so a popup that called this ready would be promising a login that cannot happen.
  test('a key the run would never be given does not count as configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    expect((await problem())?.code).toBe('AGENT_NEEDS_PERMISSION');
  });

  test('a provider-specific key declared in settings counts too', async () => {
    vi.stubEnv('BAILIAN_CODING_PLAN_API_KEY', 'sk-bailian');
    expect(await problem()).toBeNull();
  });

  test('a provider declared on disk counts, whichever key it names', async () => {
    mkdirSync(join(home, '.qwen'), { recursive: true });
    writeFileSync(join(home, '.qwen', 'settings.json'), JSON.stringify({ modelProviders: { openai: { models: [] } } }));
    expect(await problem()).toBeNull();
  });

  // A popup that wrongly says "needs setup" blocks a working agent; the run's own hint catches the
  // opposite case.
  test('a settings file that cannot be read is assumed to configure one', async () => {
    mkdirSync(join(home, '.qwen', 'settings.json'), { recursive: true });
    expect(await problem()).toBeNull();
  });

  test('Browsentic cannot obtain a key, so it does not offer to', () => {
    expect(qwenRunner.grant).toBeUndefined();
  });
});

test('the skill picker looks where Qwen keeps the user’s own skills', () => {
  expect(qwenRunner.skillDirs?.()).toEqual([join(home, '.qwen', 'skills'), join(home, '.agents', 'skills')]);
});

test('a QWEN_HOME of the user’s own is honoured', () => {
  vi.stubEnv('QWEN_HOME', '/elsewhere/qwen');
  expect(qwenRunner.skillDirs?.()?.[0]).toBe(join('/elsewhere/qwen', 'skills'));
});
