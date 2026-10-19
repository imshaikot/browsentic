import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stateDir } from '../../lockfile';
import { listerFor } from './models';
import { isOpenCode2, opencodeRunner, signInLine } from './opencode';
import { jsonContext, readThrough, shown, streamContext, stubCli, transcript, valueOf } from './fixtures/support';
import type { CommandLister, Plan } from './types';

const settings = { bin: 'opencode' };
const stream = (overrides: Parameters<typeof streamContext>[1] = {}) => opencodeRunner.stream(streamContext(settings, overrides));
const task = (overrides: Parameters<typeof jsonContext>[1] = {}) => opencodeRunner.json(jsonContext(settings, overrides));
const read = (name: string, only?: Parameters<typeof readThrough>[2]) => readThrough(opencodeRunner, transcript('opencode', name), only);
const stdoutOf = (name: string) => transcript('opencode', name).join('\n');

interface Config {
  share: string;
  tool_output: { max_bytes: number };
  mcp: Record<string, { type: string; command: string[]; environment: Record<string, string>; timeout: number }>;
  instructions?: string[];
  agent: Record<string, { permission: Record<string, unknown> }>;
}
const configOf = (plan: Plan) => JSON.parse(plan.env?.OPENCODE_CONFIG_CONTENT ?? 'null') as Config;
const rulesOf = (plan: Plan) => configOf(plan).agent[valueOf(plan.args, '--agent') ?? ''].permission;

const SESSION = 'ses_f2a205199ffeBLqxrKcIpaS7DT';

// check() reads the environment and the home directory, and the machine running the tests has its own of both.
const home = join(stateDir, 'opencode-home');

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  for (const name of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'OPENCODE_API_KEY', 'OPENCODE_AUTH_CONTENT']) vi.stubEnv(name, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('a streamed run', () => {
  test('a fresh run is one contained agent, a config in the environment, and the prompt in a file', () => {
    const plan = shown(stream());
    expect({ ...plan, env: { ...plan.env, OPENCODE_CONFIG_CONTENT: '<config>' } }).toMatchInlineSnapshot(`
      {
        "args": [
          "run",
          "--format",
          "json",
          "--pure",
          "--agent",
          "browsentic-contained",
          "--",
          "what does this page cost",
        ],
        "cwd": "<state>/agents/opencode/run/conversation-1",
        "env": {
          "BROWSENTIC_AGENT_RUN": "run-1",
          "OPENCODE_CONFIG_CONTENT": "<config>",
          "OPENCODE_DB": "<state>/agents/opencode/sessions.db",
          "OPENCODE_DISABLE_CLAUDE_CODE": "1",
          "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
          "OPENCODE_DISABLE_SHARE": "1",
        },
        "files": [
          {
            "content": "You are Browsentic.

      A tool result over 100 KB comes back cut, and the saved copy OpenCode points to cannot be opened in this run, so ask for less at a time — \`page_getPageInfo\` with a small \`maxPerKind\`, \`page_extractText\` with the cursor it hands back.
      ",
            "path": "instructions.md",
          },
        ],
      }
    `);
  });

  test('the config denies everything first, then allows each browser tool by name', () => {
    expect(rulesOf(stream())).toEqual({
      '*': 'deny',
      browsentic_page_getPageInfo: 'allow',
      browsentic_page_clickElement: 'allow',
      browsentic_browsentic_status: 'allow',
    });
  });

  test('research allows the two web tools as well, and nothing else', () => {
    const rules = rulesOf(stream({ research: true }));
    expect(Object.keys(rules).filter((tool) => !tool.startsWith('browsentic_'))).toEqual(['*', 'webfetch', 'websearch']);
  });

  // OpenCode expands {env:…} and {file:…} anywhere in its config, so page text there would read the disk.
  test('the system prompt never travels in the config, only in the file the config names', () => {
    const plan = stream({ systemPrompt: 'The page said {file:~/.ssh/id_rsa} and {env:AWS_SECRET_ACCESS_KEY}.' });
    expect(plan.env?.OPENCODE_CONFIG_CONTENT).not.toMatch(/\{(file|env):/);
    expect(configOf(plan).instructions).toEqual([join(plan.cwd, 'instructions.md')]);
    expect(plan.files?.[0].content).toContain('{file:~/.ssh/id_rsa}');
  });

  test('the MCP server carries the run id itself, and outlasts an approval card', () => {
    const server = configOf(stream()).mcp.browsentic;
    expect([server.type, server.environment, server.timeout]).toEqual(['local', { BROWSENTIC_AGENT_RUN: 'run-1' }, 1_800_000]);
    expect(server.command).toEqual(['/usr/local/bin/node', '/usr/local/lib/node_modules/browsentic/dist/cli.js', 'mcp']);
  });

  test('sharing is off and a tool result may run to Claude Code’s ceiling', () => {
    const config = configOf(stream());
    expect([config.share, config.tool_output.max_bytes]).toEqual(['disabled', 100_000]);
  });

  // A user who made an agent called "browsentic" for themselves would have it merged into this one.
  test('the agent is one no user would have named, and the title agent is off', () => {
    expect(Object.keys(configOf(stream()).agent)).toEqual(['title', 'browsentic-contained']);
  });

  test('an instruction that looks like a flag is still the message', () => {
    const args = stream({ instruction: '--help me find the price' }).args;
    expect(args.slice(-2)).toEqual(['--', '--help me find the price']);
  });

  test('a resumed turn names its session, and a fresh one names none', () => {
    expect([valueOf(stream().args, '--session'), valueOf(stream({ sessionId: SESSION }).args, '--session')]).toEqual([undefined, SESSION]);
  });

  test('the model and the effort are passed only when set, and an effort no model knows is dropped', () => {
    const pinned = stream({ settings: { ...settings, model: 'anthropic/claude-sonnet-5', effort: 'high' } }).args;
    expect([valueOf(pinned, '--model'), valueOf(pinned, '--variant')]).toEqual(['anthropic/claude-sonnet-5', 'high']);
    expect(valueOf(stream({ settings: { ...settings, effort: 'ludicrous' } }).args, '--variant')).toBeUndefined();
  });

  test('a conversation keeps its folder across turns, and another conversation gets its own', () => {
    expect(stream({ runId: 'run-2' }).cwd).toBe(stream().cwd);
    expect(stream({ conversation: 'conversation-2' }).cwd).not.toBe(stream().cwd);
  });
});

describe('a one-shot', () => {
  test('a task has no MCP server of its own and no tool at all', () => {
    const plan = task();
    expect([configOf(plan).mcp, rulesOf(plan), configOf(plan).instructions]).toEqual([{}, { '*': 'deny' }, undefined]);
  });

  test('a task runs as the same contained agent, in the task workspace, beside the same sessions', () => {
    const plan = task();
    expect([valueOf(plan.args, '--agent'), plan.cwd, plan.env?.OPENCODE_DB]).toEqual([
      'browsentic-contained',
      opencodeRunner.workspace('task'),
      join(stateDir, 'agents', 'opencode', 'sessions.db'),
    ]);
  });

  // OpenCode matches a read against its path relative to the project root, which moves with git.
  test('a task handed a file may read its scratch folder, as seen from every root OpenCode could pick', () => {
    const read = rulesOf(task({ reads: true })).read as Record<string, string>;
    const scratch = join(opencodeRunner.workspace('task'), 'tmp');
    expect(read['*']).toBe('deny');
    const fromTop = relative(parse(scratch).root, scratch);
    expect([read[`${fromTop.replaceAll(sep, '/')}/*`], read[`${fromTop}${sep}*`]]).toEqual(['allow', 'allow']);
    expect(read['task/tmp/*']).toBe('allow');
  });

  test("the scratch rule never reads as the machine's /tmp", () => {
    expect(rulesOf(task({ reads: true })).read).not.toHaveProperty('tmp/*');
  });

  test('only a read is opened, never the shell or the browser', () => {
    expect(Object.keys(rulesOf(task({ reads: true })))).toEqual(['*', 'read']);
  });
});

describe('reading the stream', () => {
  test('a turn says its text a part at a time, reports what it spent, and leaves the browser call to the daemon', () => {
    expect(read('1.18.32-turn.jsonl').filter(([signal]) => signal !== 'session')).toEqual([
      ['text', 'Looking. '],
      ['usage', { contextTokens: 1230, outputTokens: 30 }],
      ['text', '\n\nThe page is Example Domain.'],
      ['usage', { contextTokens: 1230, outputTokens: 60 }],
    ]);
  });

  test('every line names the session, and a resumed turn names the same one', () => {
    expect(new Set(read('1.18.32-turn.jsonl', 'session').map(([, id]) => id))).toEqual(new Set([SESSION]));
    expect(new Set(read('1.18.32-resumed.jsonl', 'session').map(([, id]) => id))).toEqual(new Set([SESSION]));
  });

  // The stream has no closing event; drive.ts reads a clean exit as the end of the turn.
  test('the reader never ends a run itself, because the process exiting does', () => {
    expect([read('1.18.32-turn.jsonl', 'done'), opencodeRunner.endsOnExit]).toEqual([[], true]);
  });

  test("a research run's web fetch is drawn on the timeline", () => {
    expect(read('1.18.32-web.jsonl', 'tool')).toEqual([['tool', 'call_w16', 'webfetch']]);
  });

  test('a tool the model was never offered is its mistake, not a breach', () => {
    expect(read('1.18.32-refused-tool.jsonl').filter(([signal]) => signal === 'fail' || signal === 'tool')).toEqual([]);
  });

  test('a local tool that actually ran stops the run', () => {
    const [[, code, message]] = read('1.18.32-shell-ran.jsonl', 'fail');
    expect([code, message]).toEqual(['AGENT_UNSAFE', expect.stringContaining('bash')]);
  });

  test('a refused key says what the provider said, then how to log in and why an environment key is not enough', () => {
    const [[, code, message]] = read('1.18.32-auth-error.jsonl', 'fail');
    expect([code, message]).toEqual(['AGENT_FAILED', expect.stringMatching(/^Invalid API key provided/)]);
    expect(message).toContain('opencode auth login');
  });

  // Recorded against the real Zen endpoint: it serves its free models only to requests carrying OpenCode's own tools.
  test("Zen's free tier refusing a contained run says to sign in to a provider instead", () => {
    const [[, code, message]] = read('1.18.32-free-tier.jsonl', 'fail');
    expect([code, message]).toEqual(['AGENT_FAILED', expect.stringContaining('narrowed to the browser')]);
    expect(message).toContain('opencode auth login');
  });

  test('an unknown model, which OpenCode reports only as an unexpected error, says how to name one', () => {
    const [[, , message]] = read('1.18.32-unknown-model.jsonl', 'fail');
    expect(message).toContain('provider/model');
  });

  test('a line that is not JSON is ignored', () => {
    expect(readThrough(opencodeRunner, ['not json', '{"type":"reasoning"}'])).toEqual([]);
  });
});

describe('a one-shot answer', () => {
  test('the answer is the last step, not the one that went to read the file', () => {
    expect(opencodeRunner.answer(stdoutOf('1.18.32-task-read.jsonl'))).toEqual({ text: 'The page is Example Domain.' });
  });

  test('a failed one-shot reports why', () => {
    expect(opencodeRunner.answer(stdoutOf('1.18.32-auth-error.jsonl')).error).toContain('opencode auth login');
  });

  // runJson asks for the answer as stdout arrives, so a half-written line has to be no answer yet.
  test('output cut mid-line, or before any text, is no answer yet', () => {
    const stdout = stdoutOf('1.18.32-task-read.jsonl');
    expect(opencodeRunner.answer(stdout.slice(0, stdout.lastIndexOf('"text":"The page')))).toEqual({ text: undefined });
    expect(opencodeRunner.answer('')).toEqual({ text: undefined });
  });
});

describe('what the CLI says when it cannot start', () => {
  test('a flag this OpenCode does not know asks for an update', () => {
    expect(opencodeRunner.hint?.('Unknown argument: pure')).toContain('npm i -g opencode-ai');
  });

  test('anything else is left alone', () => {
    expect(opencodeRunner.hint?.('Killed: 9')).toBeNull();
  });
});

describe('readiness', () => {
  const problem = async () => (await opencodeRunner.check?.(settings)) ?? null;
  const writeHome = (path: string, content: string) => {
    mkdirSync(join(home, path, '..'), { recursive: true });
    writeFileSync(join(home, path), content);
  };

  test('signed in to nothing, it needs a login, because the free models refuse a contained run', async () => {
    expect(await problem()).toEqual({
      code: 'AGENT_NEEDS_PERMISSION',
      message: expect.stringContaining('free OpenCode Zen models'),
      fix: 'opencode auth login',
    });
  });

  test('a saved login is enough', async () => {
    writeHome('.local/share/opencode/auth.json', JSON.stringify({ anthropic: { type: 'api', key: 'sk-ant' } }));
    expect(await problem()).toBeNull();
  });

  test('an emptied login file is no login', async () => {
    writeHome('.local/share/opencode/auth.json', '{}');
    expect((await problem())?.code).toBe('AGENT_NEEDS_PERMISSION');
  });

  test('an XDG_DATA_HOME of the user’s own is where the login is looked for', async () => {
    vi.stubEnv('XDG_DATA_HOME', join(home, 'data'));
    writeHome('data/opencode/auth.json', JSON.stringify({ openai: { type: 'oauth' } }));
    expect(await problem()).toBeNull();
  });

  test('a Zen key the run is handed counts', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'zen-key');
    expect(await problem()).toBeNull();
  });

  // A local model through a provider block needs no login at all.
  test('a provider declared in the global config counts', async () => {
    writeHome('.config/opencode/opencode.jsonc', '{\n  // ollama\n  "provider": { "ollama": {} }\n}');
    expect(await problem()).toBeNull();
  });

  // A picker that wrongly says "needs setup" blocks a working agent; the run's own error catches the opposite case.
  test('a login file that cannot be read is assumed to hold one', async () => {
    mkdirSync(join(home, '.local', 'share', 'opencode', 'auth.json'), { recursive: true });
    expect(await problem()).toBeNull();
  });

  test('Browsentic cannot log in for the user, so it does not offer to', () => {
    expect(opencodeRunner.grant).toBeUndefined();
  });
});

test('the skill picker looks where OpenCode keeps the user’s own skills', () => {
  expect(opencodeRunner.skillDirs?.()).toEqual([
    join(home, '.config', 'opencode', 'skills'),
    join(home, '.config', 'opencode', 'skill'),
    join(home, '.opencode', 'skills'),
    join(home, '.agents', 'skills'),
    join(home, '.claude', 'skills'),
  ]);
});

test('an XDG_CONFIG_HOME of the user’s own is honoured', () => {
  vi.stubEnv('XDG_CONFIG_HOME', '/elsewhere');
  expect(opencodeRunner.skillDirs?.()?.[0]).toBe(join('/elsewhere', 'opencode', 'skills'));
});

const V2 = 'opencode v2.0.32';

describe('which OpenCode it is', () => {
  test.each([
    ['opencode v2.0.32', true],
    ['opencode v10.1.0', true],
    ['1.19.3', false],
    ['1.18.32', false],
    [undefined, false],
    // A notice printed ahead of the version is no version, and 1.x's plan fails safe on 2.x's parser.
    ['Update available: opencode v2.1.0', false],
  ])('%s is 2.x: %s', (version, expected) => {
    expect(isOpenCode2(version)).toBe(expected);
  });

  test('1.x holds no conversation, so its turns stay on run', () => {
    expect(opencodeRunner.converse?.(streamContext(settings, { version: '1.19.3' }))).toBeNull();
  });
});

interface Config2 {
  share: string;
  default_agent: string;
  instructions?: string[];
  policies: { action: string; resource: string; effect: string }[];
  mcp: { servers: Record<string, { type: string; command: string[]; environment: Record<string, string>; codemode: boolean; timeout: { execution: number } }> };
  agents: Record<string, { disabled?: boolean; permissions?: { action: string; resource: string; effect: string }[] }>;
}
const config2Of = (plan: Plan) => JSON.parse(plan.env?.OPENCODE_CONFIG_CONTENT ?? 'null') as Config2;
const rules2Of = (plan: Plan) => config2Of(plan).agents['browsentic-contained'].permissions ?? [];
const conversationOf = (overrides: Parameters<typeof streamContext>[1] = {}) => {
  const conversation = opencodeRunner.converse?.(streamContext(settings, { version: V2, ...overrides }));
  if (!conversation) throw new Error('OpenCode 2 held no conversation');
  return conversation;
};
const turn2 = (overrides: Parameters<typeof streamContext>[1] = {}) => conversationOf(overrides).plan;
const fallback2 = (overrides: Parameters<typeof streamContext>[1] = {}) => opencodeRunner.stream(streamContext(settings, { version: V2, ...overrides }));
const task2 = (overrides: Parameters<typeof jsonContext>[1] = {}) => opencodeRunner.json(jsonContext(settings, { version: V2, ...overrides }));

describe('an OpenCode 2 turn', () => {
  test('is one `opencode acp` held for the turn, its config in the environment and its prompt in a file', () => {
    const plan = shown(turn2());
    expect({ ...plan, env: { ...plan.env, OPENCODE_CONFIG_CONTENT: '<config>' } }).toMatchInlineSnapshot(`
      {
        "args": [
          "acp",
        ],
        "cwd": "<state>/agents/opencode/run/conversation-1",
        "env": {
          "BROWSENTIC_AGENT_RUN": "run-1",
          "OPENCODE_CONFIG_CONTENT": "<config>",
          "OPENCODE_CONFIG_PROJECT_DISABLE": "1",
          "OPENCODE_DB": "<state>/agents/opencode/opencode-2.db",
          "OPENCODE_DISABLE_AUTOUPDATE": "1",
          "OPENCODE_DISABLE_CLAUDE_CODE": "1",
          "OPENCODE_DISABLE_PROJECT_CONFIG": "1",
          "PWD": "<state>/agents/opencode/run/conversation-1",
        },
        "files": [
          {
            "content": "You are Browsentic.

      A tool result over 100 KB comes back cut, and the saved copy OpenCode points to cannot be opened in this run, so ask for less at a time — \`page_getPageInfo\` with a small \`maxPerKind\`, \`page_extractText\` with the cursor it hands back.
      ",
            "path": "instructions.md",
          },
        ],
      }
    `);
  });

  // 2.x reads `$PWD` before its own working directory, and the user's sessions are in a database Browsentic never opens.
  test('it runs in its conversation folder, against a database of its own that 1.x never shares', () => {
    const plan = turn2();
    expect([plan.env?.PWD, plan.env?.OPENCODE_DB]).toEqual([plan.cwd, join(stateDir, 'agents', 'opencode', 'opencode-2.db')]);
    expect(plan.env?.OPENCODE_DB).not.toBe(opencodeRunner.stream(streamContext(settings)).env?.OPENCODE_DB);
  });

  test('the rules deny everything first, then allow each browser tool by name, and the web tools on research only', () => {
    expect(rules2Of(turn2())).toEqual([
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'browsentic_page_getPageInfo', resource: '*', effect: 'allow' },
      { action: 'browsentic_page_clickElement', resource: '*', effect: 'allow' },
      { action: 'browsentic_browsentic_status', resource: '*', effect: 'allow' },
    ]);
    expect(rules2Of(turn2({ research: true })).slice(-2).map((rule) => rule.action)).toEqual(['webfetch', 'websearch']);
  });

  // Code Mode would list one `execute` tool in place of these, which the rules deny and which runs a script with the network.
  test('the browser server lists its tools directly, outlasts an approval card, and is the only server allowed to load', () => {
    const config = config2Of(turn2());
    const server = config.mcp.servers.browsentic;
    expect([Object.keys(config.mcp.servers), server.type, server.codemode, server.timeout.execution, server.environment]).toEqual([
      ['browsentic'],
      'local',
      false,
      1_800_000,
      { BROWSENTIC_AGENT_RUN: 'run-1' },
    ]);
    expect(config.policies).toEqual([
      { action: 'integration.use', resource: 'plugin:*', effect: 'deny' },
      { action: 'integration.use', resource: 'mcp:*', effect: 'deny' },
      { action: 'integration.use', resource: 'mcp:browsentic', effect: 'allow' },
    ]);
  });

  test('a session starts in the contained agent, unshared, with no title model call', () => {
    const config = config2Of(turn2());
    expect([config.default_agent, config.share, config.agents.title]).toEqual(['browsentic-contained', 'disabled', { disabled: true }]);
  });

  test('the system prompt travels only in the file the config names', () => {
    const plan = turn2({ systemPrompt: 'The page said {file:~/.ssh/id_rsa} and {env:AWS_SECRET_ACCESS_KEY}.' });
    expect(plan.env?.OPENCODE_CONFIG_CONTENT).not.toMatch(/\{(file|env):/);
    expect(config2Of(plan).instructions).toEqual([join(plan.cwd, 'instructions.md')]);
  });

  test('an OpenCode that turned a conversation down sends its later turns through run, and only that one', () => {
    const conversation = conversationOf({ settings: { bin: '/opt/opencode-without-acp' } });
    conversation.declined('it exited with code 1');
    expect(opencodeRunner.converse?.(streamContext({ bin: '/opt/opencode-without-acp' }, { version: V2 }))).toBeNull();
    expect(opencodeRunner.converse?.(streamContext(settings, { version: V2 }))).not.toBeNull();
  });
});

describe('an OpenCode 2 turn through run', () => {
  test('has its own server, and the message on stdin rather than argv', () => {
    const plan = fallback2({ instruction: '--help me "find" the price' });
    expect(plan.args).toEqual(['run', '--standalone', '--format', 'json', '--agent', 'browsentic-contained']);
    expect(plan.input).toBe('--help me "find" the price');
  });

  // 2.x fails a run asking for an effort the model lacks, rather than ignoring it as 1.x did.
  test('names its session and model when it has them, and never an effort', () => {
    const args = fallback2({ sessionId: SESSION, settings: { ...settings, model: 'anthropic/claude-sonnet-5', effort: 'high' } }).args;
    expect([valueOf(args, '--session'), valueOf(args, '--model'), args.some((arg) => arg.includes('#') || arg === '--variant')]).toEqual([
      SESSION,
      'anthropic/claude-sonnet-5',
      false,
    ]);
  });

  test('is configured exactly as a held turn is', () => {
    expect(fallback2().env).toEqual(turn2().env);
  });
});

describe('an OpenCode 2 one-shot', () => {
  test('has no server and no tool, and runs as the contained agent in the task workspace', () => {
    const plan = task2({ settings: { ...settings, model: 'anthropic/claude-sonnet-5', effort: 'low' } });
    expect(plan.args).toEqual(['run', '--standalone', '--format', 'json', '--agent', 'browsentic-contained', '--model', 'anthropic/claude-sonnet-5']);
    expect([plan.input, plan.cwd, plan.env?.PWD]).toEqual(['summarize this', opencodeRunner.workspace('task'), opencodeRunner.workspace('task')]);
    expect([config2Of(plan).mcp.servers, rules2Of(plan)]).toEqual([{}, [{ action: '*', resource: '*', effect: 'deny' }]]);
  });

  // Measured: tmp/* opens the scratch folder by either path, and /tmp, /etc/hosts and a ../ are an external directory the deny covers.
  test('a one-shot handed a file may read its scratch folder and nothing else', () => {
    expect(rules2Of(task2({ reads: true })).slice(1)).toEqual([{ action: 'read', resource: 'tmp/*', effect: 'allow' }]);
  });
});

describe('reading an OpenCode 2 stream', () => {
  const read2 = (name: string, only?: Parameters<typeof readThrough>[2]) => readThrough(opencodeRunner, transcript('opencode', name), only);

  // The first call reached for a tool before the run's server had connected, which a held turn waits out.
  test('a turn says its text and what it spent, and a call the model was not yet offered is no breach', () => {
    expect(read2('2.0.32-turn.jsonl').filter(([signal]) => signal !== 'session')).toEqual([
      ['usage', { contextTokens: 1230, outputTokens: 30 }],
      ['usage', { contextTokens: 1230, outputTokens: 60 }],
      ['text', 'The page is Example Domain.'],
    ]);
  });

  test('every line names the session, and a resumed turn names the same one', () => {
    const turn = new Set(read2('2.0.32-turn.jsonl', 'session').map(([, id]) => id));
    expect(turn.size).toBe(1);
    expect(new Set(read2('2.0.32-resumed.jsonl', 'session').map(([, id]) => id))).toEqual(turn);
  });

  test("a research run's web fetch is drawn by the call's own id", () => {
    expect(read2('2.0.32-web.jsonl', 'tool')).toEqual([['tool', expect.stringMatching(/^call_/), 'webfetch']]);
  });

  test('a built-in that ran stops the run', () => {
    expect(read2('2.0.32-shell-ran.jsonl', 'fail')).toEqual([['fail', 'AGENT_UNSAFE', expect.stringContaining('its own shell tool')]]);
  });

  test("a text block finished after it was first printed goes on where it stopped, and the next one starts a paragraph", () => {
    expect(read2('2.0.32-text-suffix.hand-written.jsonl', 'text')).toEqual([
      ['text', 'The page is Exam'],
      ['text', 'ple Domain.'],
      ['text', '\n\nIt has one link.'],
    ]);
    expect(opencodeRunner.answer(transcript('opencode', '2.0.32-text-suffix.hand-written.jsonl').join('\n'))).toEqual({
      text: 'The page is Example Domain.\n\nIt has one link.',
    });
  });

  test('a refused key says what the provider said, and how to sign Browsentic in', () => {
    const [[, code, message]] = read2('2.0.32-auth-error.jsonl', 'fail');
    expect([code, message]).toEqual(['AGENT_FAILED', expect.stringMatching(/^Invalid API key provided/)]);
    expect(message).toContain('auth login --standalone');
  });

  // Recorded against the real Zen endpoint, which still serves its free models only to OpenCode's own tools.
  test("Zen's free tier refusing a contained run says to pick a paid model, or sign Browsentic in to another provider", () => {
    const [[, , message]] = read2('2.0.32-free-tier.jsonl', 'fail');
    expect(message).toContain(
      `narrowed to the browser. Pick a paid model in the side panel, which Zen bills to your OpenCode account, or sign Browsentic's OpenCode in to another provider with ${signInLine('opencode')}.`,
    );
  });

  test('a model, or an effort, OpenCode does not have says which to change', () => {
    expect(read2('2.0.32-unknown-model.jsonl', 'fail')[0][2]).toContain('provider/model');
    expect(read2('2.0.32-unknown-variant.jsonl', 'fail')[0][2]).toContain('effort');
  });
});

describe('what an OpenCode 2 says when it cannot start', () => {
  // The other line's flags are what a swap under a running Browsentic looks like.
  test('a flag of the other line asks for the message again', () => {
    expect(opencodeRunner.hint?.('ERROR\n  Unrecognized flag: --pure in command opencode run')).toContain('changed version');
    expect(opencodeRunner.hint?.('Configuration is invalid ↳ V2 permissions are not supported by OpenCode V1.')).toContain('changed version');
  });
});

describe('the models an OpenCode 2 picker offers', () => {
  const lister = () => listerFor(opencodeRunner, V2) as CommandLister;
  const parsed = (data: unknown[]) => lister().parse({ stdout: JSON.stringify({ data }), stderr: '', code: 0 });

  // Without --standalone, the question would start the user's background service on Browsentic's database.
  test("are asked of OpenCode's own server, on Browsentic's database, with the user's plugins and other servers kept out", () => {
    const env = lister().env?.('/state/agents/opencode/models') ?? {};
    expect(lister().args).toEqual(['api', '--standalone', 'model.list']);
    expect(env).toMatchObject({
      OPENCODE_DB: join(stateDir, 'agents', 'opencode', 'opencode-2.db'),
      PWD: '/state/agents/opencode/models',
      OPENCODE_CONFIG_PROJECT_DISABLE: '1',
    });
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT).policies).toEqual([
      { action: 'integration.use', resource: 'plugin:*', effect: 'deny' },
      { action: 'integration.use', resource: 'mcp:*', effect: 'deny' },
      { action: 'integration.use', resource: 'mcp:browsentic', effect: 'allow' },
    ]);
  });

  test('OpenCode 1 has no such list, so its picker keeps the curated one', () => {
    expect(listerFor(opencodeRunner, '1.19.3')).toBeUndefined();
  });

  test('a disabled model is left out, and a Zen model with no price on record is kept', () => {
    expect(
      parsed([
        { providerID: 'opencode', id: 'unpriced' },
        { providerID: 'opencode', id: 'retired', enabled: false, cost: [{ input: 1, output: 2 }] },
        { providerID: 'opencode', id: 'priced-past-a-tier', cost: [{ input: 0, output: 0 }, { input: 4, output: 15 }] },
        { providerID: 'ollama', id: 'qwen3.8', cost: [{ input: 0, output: 0 }] },
        { id: 'no-provider' },
      ]),
    ).toEqual(['ollama/qwen3.8', 'opencode/priced-past-a-tier', 'opencode/unpriced']);
  });

  test('an answer that is not the list, or a failed one, is no list', () => {
    expect(lister().parse({ stdout: '<!doctype html>', stderr: '', code: 0 })).toBeNull();
    expect(lister().parse({ stdout: JSON.stringify({ data: [{ providerID: 'opencode', id: 'm' }] }), stderr: '', code: 1 })).toBeNull();
  });
});

describe('OpenCode 2 readiness', () => {
  const db = join(stateDir, 'agents', 'opencode', 'opencode-2.db');
  const bins = join(stateDir, 'opencode-bins');
  let seq = 0;
  /** A stand-in `opencode` that answers `auth list` with `stdout`, and keeps how it was asked. */
  const answering = (stdout: string, code = 0) => {
    mkdirSync(bins, { recursive: true });
    const asked = join(bins, `asked-${++seq}.json`);
    const bin = stubCli(
      join(bins, `opencode-${seq}`),
      `require('node:fs').writeFileSync(${JSON.stringify(asked)}, JSON.stringify({ args: process.argv.slice(2), db: process.env.OPENCODE_DB, pwd: process.env.PWD }));\n` +
        `process.stdout.write(${JSON.stringify(stdout)});\nprocess.exit(${code});\n`,
    );
    return { bin, asked: () => JSON.parse(readFileSync(asked, 'utf8')) as { args: string[]; db: string; pwd: string } };
  };
  const problem = (bin = 'opencode') => opencodeRunner.check?.({ bin }, V2);
  const created = () => {
    mkdirSync(dirname(db), { recursive: true });
    writeFileSync(db, '');
  };

  beforeEach(() => rmSync(dirname(db), { recursive: true, force: true }));
  afterEach(() => rmSync(bins, { recursive: true, force: true }));

  test('with no database of its own it needs signing in, which it says how to do, and the database has a folder to go in', async () => {
    expect(await problem()).toEqual({ code: 'AGENT_NEEDS_PERMISSION', message: expect.stringContaining('OpenCode 2'), fix: signInLine('opencode') });
    expect(existsSync(dirname(db))).toBe(true);
  });

  // Without --standalone, `auth list` would start the user's background service with this environment, on this database.
  test("the database is asked through OpenCode's own server, in Browsentic's environment", async () => {
    created();
    const { bin, asked } = answering('[]');
    expect((await problem(bin))?.code).toBe('AGENT_NEEDS_PERMISSION');
    expect(asked()).toEqual({ args: ['auth', 'list', '--standalone', '--format', 'json'], db, pwd: opencodeRunner.workspace('task') });
  }, 20_000);

  test('a stored sign-in or a working key is enough, and one that needs signing in again is not', async () => {
    created();
    expect(await problem(answering(JSON.stringify([{ id: 'anthropic', connections: [{ type: 'credential', label: 'Anthropic' }] }])).bin)).toBeNull();
    const stale = [{ id: 'opencode', connections: [{ type: 'env', name: 'OPENCODE_API_KEY', status: { status: 'needs_auth' } }] }];
    expect((await problem(answering(JSON.stringify(stale)).bin))?.code).toBe('AGENT_NEEDS_PERMISSION');
  }, 20_000);

  // A run writes its sessions to the same database, which has the sign-ins asked again without changing them.
  test('the model list is read again once the sign-ins change, and not for a run that only wrote its sessions', async () => {
    created();
    const zen = [{ id: 'opencode', connections: [{ id: 'cred_zen', type: 'credential' }] }];
    const stamp = () => (listerFor(opencodeRunner, V2) as CommandLister).stamp?.();
    await problem(answering(JSON.stringify(zen)).bin);
    const signedIn = stamp();
    writeFileSync(db, 'a run wrote its session');
    await problem(answering(JSON.stringify(zen)).bin);
    const afterRun = stamp();
    writeFileSync(db, 'signed in to another provider');
    await problem(answering(JSON.stringify([...zen, { id: 'anthropic', connections: [{ id: 'cred_anthropic', type: 'credential' }] }])).bin);
    expect([signedIn, afterRun === signedIn, stamp() === signedIn]).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/), true, false]);
  }, 20_000);

  // A picker that wrongly says "needs setup" blocks a working agent; the run's own error catches the opposite case.
  test('an answer it cannot read is taken as signed in', async () => {
    created();
    expect(await problem(answering('Standalone server exited before reporting readiness', 1).bin)).toBeNull();
    expect(await problem(answering('not json').bin)).toBeNull();
  }, 20_000);

  test('a Zen key in the environment, or a provider of the user’s own config, is enough without asking', async () => {
    vi.stubEnv('OPENCODE_API_KEY', 'zen-key');
    expect(await problem('/nonexistent/opencode')).toBeNull();
    vi.stubEnv('OPENCODE_API_KEY', '');
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(join(home, '.config', 'opencode', 'opencode.jsonc'), '{ "providers": { "ollama": {} } }');
    expect(await problem('/nonexistent/opencode')).toBeNull();
  });

  test('the sign-in line points OpenCode at that database, quoted for the shell it runs in, and leaves a PowerShell window as it was', () => {
    expect(signInLine('opencode', 'darwin')).toBe(`OPENCODE_DB='${db}' opencode auth login --standalone`);
    expect(signInLine("/Users/o'neil/bin/opencode 2", 'darwin')).toBe(`OPENCODE_DB='${db}' '/Users/o'\\''neil/bin/opencode 2' auth login --standalone`);
    expect(signInLine("C:\\Users\\o'neil\\opencode.cmd", 'win32')).toBe(
      `$before=$env:OPENCODE_DB; $env:OPENCODE_DB='${db.replaceAll("'", "''")}'; ` +
        `try { & 'C:\\Users\\o''neil\\opencode.cmd' auth login --standalone } finally { $env:OPENCODE_DB=$before }`,
    );
  });
});
