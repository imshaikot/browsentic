import { chmodSync, existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stateDir } from '../../lockfile';
import { cursorRunner } from './cursor';
import { jsonContext, readThrough, shown, streamContext, transcript, valueOf } from './fixtures/support';

const settings = { bin: 'cursor-agent' };
const stream = (overrides: Parameters<typeof streamContext>[1] = {}) => cursorRunner.stream(streamContext(settings, overrides));
const task = (overrides: Parameters<typeof jsonContext>[1] = {}) => cursorRunner.json(jsonContext(settings, overrides));
const read = (name: string, only?: Parameters<typeof readThrough>[2]) => readThrough(cursorRunner, transcript('cursor', name), only);
const recorded = (name: string) => transcript('cursor', name).join('\n');

const SESSION = '0199b1c2-3d4e-5f60-7182-93a4b5c6d7e8';
const RECORDED = '5b09e9df-48b5-48e8-9a26-0357cd158ea8';
const fileIn = (plan: { files?: { path: string; content: string }[] }, path: string) =>
  plan.files?.find((file) => file.path === path)?.content ?? '';

// Cursor reads the user's own MCP servers out of ~/.cursor/mcp.json, so every test gets an empty home.
const home = join(stateDir, 'cursor-home');

beforeEach(() => {
  rmSync(home, { recursive: true, force: true });
  mkdirSync(home, { recursive: true });
  vi.stubEnv('HOME', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('a streamed run', () => {
  test('a fresh run asks for the sandbox, and writes its server, its denies and its prompt to disk', () => {
    expect(shown(stream())).toMatchInlineSnapshot(`
      {
        "args": [
          "-p",
          "--output-format",
          "stream-json",
          "--stream-partial-output",
          "--sandbox",
          "enabled",
          "--trust",
          "--",
          "what does this page cost",
        ],
        "cwd": "<state>/agents/cursor/run/conversation-1",
        "env": {
          "BROWSENTIC_AGENT_RUN": "run-1",
        },
        "files": [
          {
            "content": "{
        "mcpServers": {
          "browsentic": {
            "command": "/usr/local/bin/node",
            "args": [
              "/usr/local/lib/node_modules/browsentic/dist/cli.js",
              "mcp"
            ],
            "env": {
              "BROWSENTIC_AGENT_RUN": "run-1"
            }
          }
        }
      }
      ",
            "path": ".cursor/mcp.json",
          },
          {
            "content": "{
        "permissions": {
          "allow": [
            "Mcp(browsentic:*)"
          ],
          "deny": [
            "Shell(*)",
            "Write(**)",
            "Read(**)",
            "WebFetch(*)"
          ]
        }
      }
      ",
            "path": ".cursor/cli.json",
          },
          {
            "content": "{
        "type": "workspace_readonly",
        "networkPolicy": {
          "default": "deny"
        }
      }
      ",
            "path": ".cursor/sandbox.json",
          },
          {
            "content": "You are Browsentic.
      ",
            "path": "AGENTS.md",
          },
        ],
      }
    `);
  });

  test('the instruction goes last, behind a separator, so a dash cannot become a flag', () => {
    const args = stream({ instruction: '--help me' }).args;
    expect(args.slice(-2)).toEqual(['--', '--help me']);
  });

  test('a conversation keeps one directory, whether it is resuming or not', () => {
    const [fresh, resumed] = [stream(), stream({ sessionId: SESSION })];
    expect({ cwd: fresh.cwd === resumed.cwd, resume: valueOf(resumed.args, '--resume'), first: fresh.args.includes('--resume') }).toEqual({
      cwd: true,
      resume: SESSION,
      first: false,
    });
  });

  test('a conversation id that is not a plain id cannot steer where the run happens', () => {
    expect(stream({ conversation: '../../../etc' }).cwd).toBe(join(cursorRunner.workspace('run'), '_________etc'));
  });

  test('a run denies the shell, writing and reading, and allows only its own MCP server', () => {
    expect(JSON.parse(fileIn(stream(), '.cursor/cli.json'))).toEqual({
      permissions: { allow: ['Mcp(browsentic:*)'], deny: ['Shell(*)', 'Write(**)', 'Read(**)', 'WebFetch(*)'] },
    });
  });

  test('research is the only thing that lets a page be fetched from outside the browser', () => {
    const deny = (research: boolean) => JSON.parse(fileIn(stream({ research }), '.cursor/cli.json')).permissions.deny;
    expect([deny(false).includes('WebFetch(*)'), deny(true).includes('WebFetch(*)')]).toEqual([true, false]);
  });

  test("the user's own MCP servers are denied by name, because a project config does not replace theirs", () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { browsentic: {}, linear: {}, sentry: {} } }));
    expect(JSON.parse(fileIn(stream(), '.cursor/cli.json')).permissions.deny).toEqual([
      'Shell(*)',
      'Write(**)',
      'Read(**)',
      'WebFetch(*)',
      'Mcp(linear:*)',
      'Mcp(sentry:*)',
    ]);
  });

  test('the system prompt is the whole of AGENTS.md', () => {
    expect(fileIn(stream(), 'AGENTS.md')).toBe('You are Browsentic.\n');
  });

  test('the sandbox profile is read-only with no network of its own', () => {
    expect(JSON.parse(fileIn(stream(), '.cursor/sandbox.json'))).toEqual({
      type: 'workspace_readonly',
      networkPolicy: { default: 'deny' },
    });
  });

  test('the chosen model is passed through, and an effort is dropped because Cursor has no flag for one', () => {
    const args = cursorRunner.stream(streamContext({ bin: 'cursor-agent', model: 'composer-2.5', effort: 'high' })).args;
    expect([valueOf(args, '--model'), args.some((arg) => arg.includes('effort'))]).toEqual(['composer-2.5', false]);
  });

  test("yesterday's conversation directories are swept when a new run starts, and today's are kept", () => {
    const base = cursorRunner.workspace('run');
    const [old, recent] = [join(base, 'conv-old'), join(base, 'conv-recent')];
    for (const dir of [old, recent]) mkdirSync(dir, { recursive: true });
    const yesterday = (Date.now() - 25 * 60 * 60_000) / 1000;
    utimesSync(old, yesterday, yesterday);
    stream();
    expect([existsSync(old), existsSync(recent)]).toEqual([false, true]);
  });
});

describe('a one-shot task', () => {
  test('a task writes no MCP server and refuses every one the user configured', () => {
    expect(shown(task())).toMatchInlineSnapshot(`
      {
        "args": [
          "-p",
          "--output-format",
          "json",
          "--sandbox",
          "enabled",
          "--trust",
          "--",
          "summarize this",
        ],
        "cwd": "<state>/agents/cursor/task",
        "files": [
          {
            "content": "{
        "permissions": {
          "allow": [],
          "deny": [
            "Shell(*)",
            "Write(**)",
            "Read(**)",
            "WebFetch(*)",
            "Mcp(*)"
          ]
        }
      }
      ",
            "path": ".cursor/cli.json",
          },
          {
            "content": "{
        "type": "workspace_readonly",
        "networkPolicy": {
          "default": "deny"
        }
      }
      ",
            "path": ".cursor/sandbox.json",
          },
        ],
      }
    `);
  });

  test('a task that is handed a file may read it, and one that is not may not', () => {
    const deny = (reads: boolean) => JSON.parse(fileIn(task({ reads }), '.cursor/cli.json')).permissions.deny;
    expect([deny(false).includes('Read(**)'), deny(true).includes('Read(**)')]).toEqual([true, false]);
  });

  test('runs and tasks never share a directory', () => {
    expect(cursorRunner.workspace('run')).not.toBe(cursorRunner.workspace('task'));
  });
});

describe('reading the stream', () => {
  test('a recorded turn reports its session, its text, what it spent, and that it is done', () => {
    expect(read('2026.09.18-turn.jsonl')).toEqual([
      ['session', RECORDED],
      ['text', 'hello'],
      ['text', ' from'],
      ['text', ' cursor'],
      ['session', RECORDED],
      ['usage', { contextTokens: 18682, outputTokens: 51 }],
      ['done', 'end_turn'],
    ]);
  });

  test("the model's thinking is not said out loud", () => {
    expect(read('2026.09.18-turn.jsonl', 'text').map(([, text]) => text).join('')).toBe('hello from cursor');
  });

  test('the closing flush repeats the whole answer, and is not said again', () => {
    const said = read('2026.09.18-turn.jsonl', 'text').map(([, text]) => text).join('');
    expect(said).toBe('hello from cursor');
  });

  test('the flushes that repeat what was already said are not said again', () => {
    expect(read('duplicates.hand-written.jsonl', 'text').map(([, text]) => text).join('')).toBe('Checking the page.');
  });

  test('a recorded shell call is reported under the tool it reached, once per call', () => {
    const tools = read('2026.09.18-shell-denied.jsonl', 'tool');
    expect(tools.map(([, , name]) => name)).toEqual(['shell', 'shell']);
    expect(new Set(tools.map(([, id]) => id)).size).toBe(2);
  });

  test('a tool call is named by the key that says it is one, not by whatever came first', () => {
    const calls = readThrough(cursorRunner, [
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-9',
        tool_call: { hookAdditionalContexts: [], startedAtMs: 1, toolCallId: 'x', readToolCall: { args: {} } },
      }),
    ]);
    expect(calls).toEqual([['tool', 'call-9', 'read']]);
  });

  test('a browser call is left to the daemon, which already puts it on the timeline', () => {
    const calls = readThrough(cursorRunner, [
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-10',
        tool_call: { mcpToolCall: { args: { server: 'browsentic', name: 'page_getPageInfo' } } },
      }),
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'call-11',
        tool_call: { mcpToolCall: { args: { server: 'linear', name: 'create_issue' } } },
      }),
    ]);
    expect(calls).toEqual([['tool', 'call-11', 'linear:create_issue']]);
  });

  test('a failure arrives as is_error on the closing result', () => {
    expect(read('error.hand-written.jsonl', 'fail')).toEqual([
      ['fail', 'AGENT_FAILED', 'Model composer-9 is not available on this account.'],
    ]);
  });

  test('a line that is not JSON, and an event with no type, are both ignored', () => {
    expect(readThrough(cursorRunner, ['not json at all', '{"type":"tool_use_unknown"}', '{}'])).toEqual([]);
  });
});

describe('the answer to a one-shot task', () => {
  test('a successful task answers with its result', () => {
    expect(cursorRunner.answer(recorded('2026.09.18-turn.jsonl'))).toEqual({ text: 'hello from cursor' });
  });

  test('a failed task answers with the error it reported', () => {
    expect(cursorRunner.answer(recorded('error.hand-written.jsonl'))).toEqual({
      error: 'Model composer-9 is not available on this account.',
    });
  });

  test('nothing at all is neither text nor an error', () => {
    expect(cursorRunner.answer('')).toEqual({ error: undefined });
  });
});

describe('what a failed start is explained as', () => {
  test('not being signed in says how to sign in, through the colour codes', () => {
    expect(cursorRunner.hint?.('\u001B[31mError: Authentication required. Please run \'agent login\' first.\u001B[0m')).toBe(
      'Cursor CLI is installed but not signed in. Run "cursor-agent login", or set CURSOR_API_KEY, then try again.',
    );
  });

  test('a flag this Cursor does not know says to update it', () => {
    expect(cursorRunner.hint?.("error: unknown option '--stream-partial-output'")).toContain('does not understand the flags');
  });

  test('anything else is left to the driver to report', () => {
    expect(cursorRunner.hint?.('Segmentation fault')).toBeNull();
  });
});

describe('whether it is signed in', () => {
  const stubbed = (says: string) => {
    const path = join(home, 'cursor-agent-stub');
    writeFileSync(path, `#!/bin/sh\necho "${says}"\nexit 0\n`);
    chmodSync(path, 0o755);
    return path;
  };

  test('a signed-out CLI needs setup, though it exits 0 saying so', async () => {
    expect(await cursorRunner.check?.({ bin: stubbed('Not logged in') })).toEqual({
      code: 'AGENT_NEEDS_PERMISSION',
      message: 'Cursor CLI is installed but not signed in.',
      fix: 'cursor-agent login',
    });
  });

  test('a signed-in CLI has no problem', async () => {
    expect(await cursorRunner.check?.({ bin: stubbed('Logged in as you@example.com') })).toBeNull();
  });

  test('an api key is enough on its own, without asking the CLI', async () => {
    vi.stubEnv('CURSOR_API_KEY', 'key_abc');
    expect(await cursorRunner.check?.({ bin: stubbed('Not logged in') })).toBeNull();
  });

  test('a CLI that cannot be asked is treated as signed in, so a working agent is never blocked', async () => {
    expect(await cursorRunner.check?.({ bin: join(home, 'not-a-binary') })).toBeNull();
  });
});

test('the skill directories are the ones Cursor reads', () => {
  expect(cursorRunner.skillDirs?.()).toEqual([join(homedir(), '.cursor', 'skills'), join(homedir(), '.agents', 'skills')]);
});

test('every workspace path is inside the state directory', () => {
  for (const mode of ['run', 'task'] as const) expect(dirname(cursorRunner.workspace(mode))).toContain(stateDir);
});
