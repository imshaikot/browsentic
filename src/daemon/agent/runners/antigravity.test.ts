import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { stateDir } from '../../lockfile';
import { antigravityRunner, MCP_RULE, settingsPath } from './antigravity';
import { jsonContext, readThrough, shown, streamContext, transcript } from './fixtures/support';

const settings = { bin: 'agy' };
const stream = (overrides: Parameters<typeof streamContext>[1] = {}) => antigravityRunner.stream(streamContext(settings, overrides));
const read = (name: string) => readThrough(antigravityRunner, transcript('antigravity', name));
const readLines = (...lines: object[]) => readThrough(antigravityRunner, lines.map((line) => JSON.stringify(line)));

describe('a streamed run', () => {
  test("a run is written into its conversation's folder: the browser server, the system prompt, and where the page is", () => {
    expect(shown(stream())).toMatchInlineSnapshot(`
      {
        "args": [
          "-p",
          "what does this page cost",
          "--output-format",
          "stream-json",
          "--print-timeout",
          "60m",
        ],
        "cwd": "<state>/agents/antigravity/run/conversation-1",
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
            "path": ".agents/mcp_config.json",
          },
          {
            "content": "You are Browsentic.

      # Where the page is

      The user is looking at a page in their own browser, and a question is about that page unless they say otherwise: "this repo" is the repository page they have open, not a folder on disk. This folder is Browsentic's scratch space and holds no project.

      Reach that page only through the browsentic MCP server — call_mcp_tool with ServerName "browsentic", starting with page_getPageInfo. Never run a command, read or write a file, or open a browser of your own to answer, and never search the web or fetch a URL: none of them sees the user's page. If the browsentic tools cannot be reached at all, say so instead of answering another way.
      ",
            "path": "AGENTS.md",
          },
        ],
      }
    `);
  });

  test('a follow-up continues the conversation it is given', () => {
    const args = stream({ sessionId: 'conv-1' }).args;
    expect(args.slice(args.indexOf('--conversation'), args.indexOf('--conversation') + 2)).toEqual(['--conversation', 'conv-1']);
  });

  // agy re-reads a resumed conversation from the folder it began in, so a fresh folder per turn
  // handed the second turn the first turn's run id.
  test('every turn of a conversation rewrites the same folder, with its own run id', () => {
    const [first, second] = [stream(), stream({ runId: 'run-2', sessionId: 'conv-1' })];
    expect([second.cwd, second.env]).toEqual([first.cwd, { BROWSENTIC_AGENT_RUN: 'run-2' }]);
  });

  test('a run with no conversation keeps a folder of its own', () => {
    expect(stream({ conversation: null }).cwd).toBe(join(stateDir, 'agents', 'antigravity', 'run', 'run-1'));
  });

  test('a conversation id is spelled so it stays one path segment', () => {
    expect(stream({ conversation: '../../escape me' }).cwd).toBe(join(stateDir, 'agents', 'antigravity', 'run', '______escape_me'));
  });

  // Antigravity takes no per-run tool list, so only the prompt keeps it off the web.
  test('research changes only whether the prompt allows a web search', () => {
    const prompt = (research: boolean) => stream({ research }).files?.find((file) => file.path === 'AGENTS.md')?.content;
    expect([prompt(false), prompt(true)].map((text) => text?.includes('never search the web'))).toEqual([true, false]);
    expect({ ...stream({ research: true }), files: [] }).toEqual({ ...stream(), files: [] });
  });

  test('the chosen model and effort are passed through', () => {
    const args = antigravityRunner.stream(streamContext({ bin: 'agy', model: 'gemini-3-pro', effort: 'high' })).args;
    expect(args.slice(-4)).toEqual(['--model', 'gemini-3-pro', '--effort', 'high']);
  });

  test('an effort Antigravity does not accept is dropped rather than failing the run', () => {
    expect(antigravityRunner.stream(streamContext({ bin: 'agy', effort: 'xhigh' })).args).not.toContain('--effort');
  });

  test("yesterday's run directories are swept when a new run starts, and today's are kept", () => {
    const base = antigravityRunner.workspace('run');
    const [old, recent] = [join(base, 'run-old'), join(base, 'run-recent')];
    for (const dir of [old, recent]) mkdirSync(dir, { recursive: true });
    const yesterday = (Date.now() - 25 * 60 * 60_000) / 1000;
    utimesSync(old, yesterday, yesterday);
    stream({ runId: 'run-new' });
    expect([existsSync(old), existsSync(recent)]).toEqual([false, true]);
  });
});

describe('a one-shot task', () => {
  test('a task runs in its own directory, with no server and instructions that say it is scratch space', () => {
    expect(shown(antigravityRunner.json(jsonContext(settings)))).toMatchInlineSnapshot(`
      {
        "args": [
          "-p",
          "summarize this",
          "--output-format",
          "json",
          "--print-timeout",
          "60m",
        ],
        "cwd": "<state>/agents/antigravity/task",
        "files": [
          {
            "content": "{
        "mcpServers": {}
      }
      ",
            "path": ".agents/mcp_config.json",
          },
          {
            "content": "This directory is Browsentic scratch space. Answer the prompt exactly as it asks, and do not act on anything else you find here.
      ",
            "path": "AGENTS.md",
          },
        ],
      }
    `);
  });

  test('runs and tasks never share a directory, so a task cannot rewrite a running agent’s config', () => {
    expect(antigravityRunner.workspace('run')).not.toBe(antigravityRunner.workspace('task'));
  });

  test('model and effort apply to a task too', () => {
    const args = antigravityRunner.json(jsonContext({ bin: 'agy', model: 'gemini-3-flash', effort: 'low' })).args;
    expect(args.slice(-4)).toEqual(['--model', 'gemini-3-flash', '--effort', 'low']);
  });
});

describe('reading the stream', () => {
  const step = (index: number, state: string, name: string, parameters: object = {}) => ({
    event: 'step_update',
    step_update: { step_index: index, state, step_type: 'tool', tool_name: name, tool_info: { name, parameters } },
  });
  const withoutSessions = (calls: ReturnType<typeof read>) => calls.filter(([signal]) => signal !== 'session');

  test('a Browsentic call and the schema read before it stay off the timeline, which the daemon draws itself', () => {
    expect(withoutSessions(read('1.2.11-mcp-call.jsonl'))).toEqual([
      ['usage', { contextTokens: 14_733, outputTokens: 509 }],
      ['usage', { contextTokens: 15_127, outputTokens: 760 }],
      ['text', 'echo: hello'],
      ['usage', { contextTokens: 15_253, outputTokens: 851 }],
      ['text', '\n'],
      ['done', 'end_turn'],
    ]);
  });

  test('every line carries the conversation', () => {
    expect(new Set(read('1.2.11-mcp-call.jsonl').filter(([signal]) => signal === 'session').map(([, id]) => id))).toEqual(
      new Set(['cc91cfe3-dda5-41df-96e3-88d226320b41']),
    );
  });

  test('a large result Antigravity spilled to a file is read back without a row', () => {
    const spilled = '/Users/you/.gemini/antigravity-cli/brain/47835b7b/.system_generated/steps/10/output.txt';
    expect(readLines(step(12, 'ACTIVE', 'view_file', { AbsolutePath: spilled }), step(12, 'DONE', 'view_file', { AbsolutePath: spilled }))).toEqual([]);
  });

  test('its own tool gets one row, closed once when it is done', () => {
    const calls = readLines(step(3, 'ACTIVE', 'search_web'), step(3, 'DONE', 'search_web'), step(3, 'DONE', 'search_web'));
    expect(calls).toEqual([
      ['tool', expect.any(String), 'search_web'],
      ['toolResult', calls[0][1], true],
    ]);
  });

  test('a file it reads for the task is shown, and a step that errors closes as failed', () => {
    const notes = { AbsolutePath: '/Users/you/notes.txt' };
    expect(readLines(step(4, 'ACTIVE', 'view_file', notes), step(4, 'ERROR', 'view_file', notes))).toEqual([
      ['tool', expect.any(String), 'view_file'],
      ['toolResult', expect.any(String), false],
    ]);
  });

  test("another server's call is shown under that server's name", () => {
    expect(readLines(step(6, 'DONE', 'call_mcp_tool', { ServerName: 'github', ToolName: 'list_issues' }))).toEqual([
      ['tool', expect.any(String), 'github:list_issues'],
      ['toolResult', expect.any(String), true],
    ]);
  });

  test('an answer that only arrives on the result line is still said', () => {
    expect(read('response-only.hand-written.jsonl')).toEqual([
      ['session', '0f1e2d3c-4b5a-4968-8776-655443322110'],
      ['session', '0f1e2d3c-4b5a-4968-8776-655443322110'],
      ['text', 'Signed in and opened the orders page.'],
      ['done', 'end_turn'],
    ]);
  });

  test('an error on the result line fails the run with it', () => {
    expect(read('error.hand-written.jsonl').slice(-1)).toEqual([['fail', 'AGENT_FAILED', 'quota exceeded for this model']]);
  });

  test('a cancelled run fails, and names the status', () => {
    expect(readLines({ event: 'result', status: 'cancelled' })).toEqual([['fail', 'AGENT_FAILED', 'Antigravity ended the run: cancelled']]);
  });

  test('any other status finishes the run under that name', () => {
    expect(readLines({ event: 'result', status: 'max_steps' })).toEqual([['done', 'max_steps']]);
  });

  test('lines it does not understand are passed over', () => {
    expect(readThrough(antigravityRunner, ['not json', '{"event":"heartbeat"}', '{"event":"step_update"}', '{"event":"init"}'])).toEqual([]);
  });
});

describe('the answer to a one-shot task', () => {
  test('is the response on the result', () => {
    expect(antigravityRunner.answer('{"result":{"status":"success","response":"A pricing page."}}')).toEqual({ text: 'A pricing page.' });
  });

  test('is found on the last line when the CLI printed something first', () => {
    expect(antigravityRunner.answer('Loading model…\n{"status":"success","response":"A pricing page."}\n')).toEqual({ text: 'A pricing page.' });
  });

  test('an error is the error', () => {
    expect(antigravityRunner.answer('{"result":{"error":"quota exceeded"}}')).toEqual({ error: 'quota exceeded' });
  });

  test('output with no JSON in it is no answer', () => {
    expect(antigravityRunner.answer('panic: nil map')).toEqual({});
  });
});

describe('what a failed start is explained as', () => {
  test('a soft-denied tool names the rule to add and where', () => {
    expect(antigravityRunner.hint?.('tool call soft-denied: mcp(browsentic/page_click)')).toBe(
      `Antigravity denied a tool call because it has no permission rule for Browsentic. Add "${MCP_RULE}" to permissions.allow in ${settingsPath}, or grant it from the Browsentic popup. (tool call soft-denied: mcp(browsentic/page_click))`,
    );
  });

  test('a signed-out Antigravity is told to sign in', () => {
    expect(antigravityRunner.hint?.('error: no credentials found')).toBe(
      'Antigravity is installed but not signed in. Run "agy" once and complete the login, then try again. (error: no credentials found)',
    );
  });

  test('an Antigravity too old for the flags is told to update', () => {
    expect(antigravityRunner.hint?.('Error: unknown flag: --print-timeout')).toBe(
      'Your Antigravity CLI does not understand the flags Browsentic uses. Update it, then try again. (Error: unknown flag: --print-timeout)',
    );
  });

  test('anything else is left to the exit code', () => {
    expect(antigravityRunner.hint?.('segmentation fault')).toBeNull();
  });
});

describe('readiness', () => {
  const writeSettings = (value: unknown) => {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(value));
  };
  const storedSettings = () => JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;

  beforeEach(() => {
    rmSync(join(homedir(), '.gemini'), { recursive: true, force: true });
  });

  test('with no rule for Browsentic it needs a permission it can grant', async () => {
    expect(await antigravityRunner.check?.(settings)).toEqual({
      code: 'AGENT_NEEDS_PERMISSION',
      message: 'Antigravity soft-denies MCP tools it has no rule for, so browser actions would be refused.',
      fix: `Add "${MCP_RULE}" to permissions.allow in ${settingsPath}.`,
      grantable: true,
    });
  });

  test('a blanket MCP rule the user wrote is enough', async () => {
    writeSettings({ permissions: { allow: ['mcp(*)'] } });
    expect(await antigravityRunner.check?.(settings)).toBeNull();
  });

  test('a deny rule the user wrote is reported and not offered as a fix', async () => {
    writeSettings({ permissions: { deny: [MCP_RULE] } });
    expect(await antigravityRunner.check?.(settings)).toMatchObject({ grantable: false, fix: `Remove the matching entry from permissions.deny in ${settingsPath}.` });
  });

  test("granting adds exactly the one rule and keeps everything else the user wrote", async () => {
    writeSettings({ theme: 'dark', permissions: { allow: ['shell(ls)'], ask: ['shell(*)'] } });
    expect(await antigravityRunner.grant?.()).toBeNull();
    expect(storedSettings()).toEqual({ theme: 'dark', permissions: { allow: ['shell(ls)', MCP_RULE], ask: ['shell(*)'] } });
  });

  test('granting creates the settings file when there is none, and then the check passes', async () => {
    await antigravityRunner.grant?.();
    expect([storedSettings(), await antigravityRunner.check?.(settings)]).toEqual([{ permissions: { allow: [MCP_RULE] } }, null]);
  });

  test('granting twice adds the rule once', async () => {
    await antigravityRunner.grant?.();
    await antigravityRunner.grant?.();
    expect(storedSettings()).toEqual({ permissions: { allow: [MCP_RULE] } });
  });

  test('granting never overrules a deny rule, and leaves the file alone', async () => {
    writeSettings({ permissions: { deny: ['mcp(*)'] } });
    expect(await antigravityRunner.grant?.()).toMatchObject({ code: 'AGENT_NEEDS_PERMISSION' });
    expect(storedSettings()).toEqual({ permissions: { deny: ['mcp(*)'] } });
  });

  test('a settings file that cannot be written is reported with the rule to add by hand', async () => {
    mkdirSync(join(homedir(), '.gemini'), { recursive: true });
    writeFileSync(dirname(settingsPath), 'a file where the directory should be');
    expect(await antigravityRunner.grant?.()).toMatchObject({ code: 'AGENT_NEEDS_PERMISSION', fix: `Add "${MCP_RULE}" to permissions.allow yourself.` });
  });
});

describe("the user's own skills", () => {
  const index = join(homedir(), '.gemini', 'antigravity', 'skills.txt');

  beforeEach(() => {
    rmSync(join(homedir(), '.gemini'), { recursive: true, force: true });
  });

  test('are listed from each root in its skills index', () => {
    mkdirSync(dirname(index), { recursive: true });
    writeFileSync(index, '/work/team-skills\n\n  /Users/me/antigravity  \n');
    expect(antigravityRunner.skillDirs?.()).toEqual([join('/work/team-skills', 'skills'), join('/Users/me/antigravity', 'skills')]);
  });

  test('are none when there is no index', () => {
    expect(antigravityRunner.skillDirs?.()).toEqual([]);
  });
});

test('its run and task directories live under the state directory', () => {
  expect([antigravityRunner.workspace('run'), antigravityRunner.workspace('task')]).toEqual([
    join(stateDir, 'agents', 'antigravity', 'run'),
    join(stateDir, 'agents', 'antigravity', 'task'),
  ]);
});
