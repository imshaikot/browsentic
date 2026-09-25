import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stateDir } from '../../lockfile';
import { opencodeRunner } from './opencode';
import { jsonContext, readThrough, shown, streamContext, transcript, valueOf } from './fixtures/support';
import type { Plan } from './types';

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
    expect(read[`${scratch.slice(1)}/*`]).toBe('allow');
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

  // A popup that wrongly says "needs setup" blocks a working agent; the run's own error catches the opposite case.
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
