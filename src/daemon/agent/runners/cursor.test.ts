import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stateDir } from '../../lockfile';
import { cursorRunner } from './cursor';
import { jsonContext, readThrough, shown, streamContext, stubCli, transcript, valueOf } from './fixtures/support';

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
  vi.stubEnv('USERPROFILE', home);
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
            "WebFetch(*)",
            "Mcp(plugin-*:*)"
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

      # Reaching the browser from Cursor

      Your browser tools are on the \`browsentic\` MCP server, and Cursor shows you a tool's schema only when you look it up with \`GetMcpTools\`. Start by calling it with \`server: "browsentic"\` and \`pattern: "^(page_|browsentic_)"\` to see them all, then fetch the schema of every tool this job needs in one step, in parallel, before the first call. The page the user means is the one open in their browser: read it with these tools, never from memory or from the shell.

      A tool result longer than 40,000 bytes is refused, so ask for a page a piece at a time — \`page_getPageInfo\` with a small \`maxPerKind\`, \`page_extractText\` with the cursor it hands back. A call that answers \`APPROVAL_PENDING\` is waiting on the user: make the same call again, with the same input, to keep waiting.
      ",
            "path": "AGENTS.md",
          },
        ],
        "prepare": [
          [
            "mcp",
            "enable",
            "browsentic",
          ],
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

  test("a run denies the shell, writing, reading and every plugin's MCP server, and allows only its own", () => {
    expect(JSON.parse(fileIn(stream(), '.cursor/cli.json'))).toEqual({
      permissions: { allow: ['Mcp(browsentic:*)'], deny: ['Shell(*)', 'Write(**)', 'Read(**)', 'WebFetch(*)', 'Mcp(plugin-*:*)'] },
    });
  });

  test('every turn approves its own MCP server, and only that one, before it starts', () => {
    expect([stream().prepare, stream({ sessionId: SESSION }).prepare]).toEqual([
      [['mcp', 'enable', 'browsentic']],
      [['mcp', 'enable', 'browsentic']],
    ]);
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
      'Mcp(plugin-*:*)',
      'Mcp(linear:*)',
      'Mcp(sentry:*)',
    ]);
  });

  test('AGENTS.md is the system prompt, then how to look the browser tools up', () => {
    const prompt = fileIn(stream(), 'AGENTS.md');
    expect([prompt.startsWith('You are Browsentic.\n\n# Reaching the browser from Cursor\n'), prompt.includes('GetMcpTools')]).toEqual([true, true]);
  });

  test('a session keeps the prompt it began with, so a follow-up carries what changed', () => {
    expect(cursorRunner.keepsFirstPrompt).toBe(true);
  });

  test('a call is abandoned at 60 s, and text past 40,000 bytes never reaches the model', () => {
    expect(cursorRunner.limits).toEqual({ callMs: 60_000, resultBytes: 40_000 });
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

  test('a task approves no MCP server, having none', () => {
    expect(task().prepare).toBeUndefined();
  });

  test('a task can open a text file, a PDF or a picture', () => {
    expect(cursorRunner.opens).toEqual(['text', 'pdf', 'image']);
  });
});

describe('reading the stream', () => {
  test('a recorded turn reports its session, its text and that it is done — not its usage, which adds up every request', () => {
    expect(read('2026.09.18-turn.jsonl')).toEqual([
      ['session', RECORDED],
      ['text', 'hello'],
      ['text', ' from'],
      ['text', ' cursor'],
      ['session', RECORDED],
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

  test('browser calls and their schema lookups are left off the timeline; Cursor’s own tools open and close a row', () => {
    const rows = read('2026.09.18-mcp-calls.jsonl').filter(([signal]) => signal === 'tool' || signal === 'toolResult');
    expect(rows.map(([signal, , detail]) => `${signal} ${String(detail)}`)).toEqual([
      'tool read',
      'toolResult false',
      'tool shell',
      'toolResult false',
      'tool shell',
      'toolResult false',
      'tool grep',
      'toolResult true',
      'tool shell',
      'toolResult false',
    ]);
  });

  test('a recorded turn that called the browser says what the model answered', () => {
    const said = read('2026.09.18-mcp-calls.jsonl', 'text').map(([, text]) => text).join('');
    expect([said.includes('t52 answered: number 52.'), said.includes('orange')]).toEqual([true, true]);
  });

  test('a resumed turn reports the same session, and the shell call the run refused', () => {
    const calls = read('2026.09.18-resumed.jsonl');
    expect([
      new Set(calls.filter(([signal]) => signal === 'session').map(([, id]) => id)).size,
      calls.filter(([signal]) => signal === 'tool' || signal === 'toolResult').map(([signal, , detail]) => `${signal} ${String(detail)}`),
      calls.at(-1),
    ]).toEqual([1, ['tool shell', 'toolResult false'], ['done', 'end_turn']]);
  });

  test('a browser call Cursor gave up on at 60 s puts nothing on the timeline itself', () => {
    const calls = read('2026.09.18-mcp-timeout.jsonl');
    expect([calls.some(([signal]) => signal === 'tool'), calls.at(-1)]).toEqual([false, ['done', 'end_turn']]);
  });

  test('another MCP server answering a call stops the run, since the run denies every server but its own', () => {
    const call = (subtype: string, result?: unknown) =>
      JSON.stringify({
        type: 'tool_call',
        subtype,
        call_id: 'call-12',
        tool_call: { mcpToolCall: { args: { providerIdentifier: 'plugin-acme-tools', toolName: 'wipe' }, result } },
      });
    expect([
      readThrough(cursorRunner, [call('started'), call('completed', { error: { error: 'denied' } })]),
      readThrough(cursorRunner, [call('started'), call('completed', { success: { content: [] } })]).at(-1)?.slice(0, 2),
    ]).toEqual([
      [
        ['tool', 'call-12', 'plugin-acme-tools:wipe'],
        ['toolResult', 'call-12', false],
      ],
      ['fail', 'AGENT_UNSAFE'],
    ]);
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
  const stubbed = (says: string) => stubCli(join(home, 'cursor-agent-stub'), `console.log(${JSON.stringify(says)});`);

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
