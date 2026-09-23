import { once } from 'node:events';
import { existsSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { RunEvent } from '@/lib/actions/protocol';
import { AGENTS } from '@/lib/agents/catalog';
import { logPath, stateDir } from '../../lockfile';
import { configPath } from '../config';
import { antigravityRunner } from './antigravity';
import { launch, runJson, runStream } from './drive';
import { jsonContext, streamContext } from './fixtures/support';
import { RunError, type Plan, type Runner, type StreamReader, type StreamSink } from './types';

/** Each line the stand-in prints is one sink call, as JSON: ["text", "hello"]. */
const replay: StreamReader = (line, sink) => {
  const [signal, ...args] = JSON.parse(line) as [keyof StreamSink, ...unknown[]];
  (sink[signal] as (...values: unknown[]) => void)(...args);
};

/**
 * Antigravity's real plans with a Node script in place of the CLI. Its containment only asks for
 * the two workspace files those plans write, so the stand-in passes the same vetting a real run does.
 */
const standIn = (script: string, plan: (real: Plan) => Plan = (real) => real): Runner => ({
  ...antigravityRunner,
  stream: (context) => plan({ ...antigravityRunner.stream(context), args: ['-e', script] }),
  json: (context) => plan({ ...antigravityRunner.json(context), args: ['-e', script] }),
  reader: () => replay,
});

const printing = (...lines: unknown[]) =>
  `for (const line of ${JSON.stringify(lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))))}) console.log(line);`;

const node = { bin: process.execPath };

const run = async (runner: Runner, { runId = 'drive-run', signal = new AbortController().signal, bin = node.bin } = {}) => {
  const events: RunEvent[] = [];
  const outcome = await runStream(runner, streamContext({ bin }, { runId }), signal, (event) => events.push(event));
  return { outcome, events, said: events.flatMap((event) => (event.kind === 'text' ? [event.delta] : [])).join('') };
};

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected the run to fail');
    },
    (error: unknown) => (error instanceof RunError ? { code: error.code, message: error.message } : error),
  );

const task = (runner: Runner, { signal = new AbortController().signal, bin = node.bin } = {}) =>
  runJson(runner, jsonContext({ bin }), signal, { timedOut: 'The summary took too long.', empty: 'The agent said nothing.' });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('a streamed run', () => {
  test('each line the agent prints reaches the reader in order, and the run ends where the reader says', async () => {
    const { outcome, events } = await run(
      standIn(
        printing(
          ['session', 'conv-1'],
          '',
          ['tool', 'search-1', 'search_web'],
          ['usage', { contextTokens: 900, outputTokens: 12 }],
          ['text', 'It costs $12.'],
          ['done', 'end_turn'],
        ),
      ),
    );
    expect({ outcome, events }).toEqual({
      outcome: { stopReason: 'end_turn', sessionId: 'conv-1' },
      events: [
        { kind: 'tool', toolId: 'search-1', action: 'search_web', input: {} },
        { kind: 'usage', usage: { contextTokens: 900, outputTokens: 12 } },
        { kind: 'text', delta: 'It costs $12.' },
      ],
    });
  });

  test('a run that never names a session reports none, so a stale one is not resumed', async () => {
    expect((await run(standIn(printing(['done', 'end_turn'])))).outcome).toEqual({ stopReason: 'end_turn', sessionId: null });
  });

  test('a line the reader chokes on is logged and the run carries on', async () => {
    const { said } = await run(standIn(printing('Loading model…', ['text', 'Done.'], ['done', 'end_turn'])));
    expect([said, readFileSync(logPath, 'utf8').includes('antigravity runner could not read a stream line')]).toEqual(['Done.', true]);
  });

  test('a credential the agent repeats is sealed before the user sees it, even split across two lines', async () => {
    const { said } = await run(
      standIn(printing(['text', 'The key is sk-ant-api03-AbCdEfGhIj'], ['text', 'KlMnOpQrStUvWxYz012345, as asked.'], ['done', 'end_turn'])),
    );
    expect([said.includes('AbCdEfGhIj'), said.includes('⟦api-key:'), said.endsWith(', as asked.')]).toEqual([false, true, true]);
  });

  test("the plan's files are in the run's own directory before the agent starts, readable only by the user", async () => {
    const script = `console.log(JSON.stringify(['text', require('node:fs').readFileSync('AGENTS.md', 'utf8')])); console.log('["done","end_turn"]');`;
    const { said } = await run(standIn(script), { runId: 'files-run' });
    const cwd = join(antigravityRunner.workspace('run'), 'files-run');
    expect({
      said,
      directory: statSync(cwd).mode & 0o777,
      instructions: statSync(join(cwd, 'AGENTS.md')).mode & 0o777,
      mcpConfig: statSync(join(cwd, '.agents', 'mcp_config.json')).mode & 0o777,
    }).toEqual({ said: 'You are Browsentic.\n', directory: 0o700, instructions: 0o600, mcpConfig: 0o600 });
  });

  test("a folder a conversation keeps is new again on every turn, so the sweep ages it from its last", async () => {
    const cwd = join(antigravityRunner.workspace('run'), 'kept-run');
    await run(standIn(printing(['done', 'end_turn'])), { runId: 'kept-run' });
    const nearlyADayAgo = new Date(Date.now() - 23 * 60 * 60_000);
    utimesSync(cwd, nearlyADayAgo, nearlyADayAgo);
    await run(standIn(printing(['done', 'end_turn'])), { runId: 'kept-run' });
    expect(statSync(cwd).mtimeMs).toBeGreaterThan(Date.now() - 60_000);
  });

  test('a run that finished is not undone by the exit code that follows', async () => {
    expect((await run(standIn(`${printing(['done', 'end_turn'])} process.exitCode = 2;`))).outcome.stopReason).toBe('end_turn');
  });

  test('a failure the reader reports is the error the run ends with', async () => {
    expect(await failure(run(standIn(printing(['fail', 'AGENT_FAILED', 'quota exceeded']))))).toEqual({
      code: 'AGENT_FAILED',
      message: 'quota exceeded',
    });
  });

  test('a failure the reader reports stops the agent, rather than leaving it running unwatched', async () => {
    const stopped = join(stateDir, 'stopped-after-fail');
    const script =
      `process.on('SIGTERM', () => { require('node:fs').writeFileSync(${JSON.stringify(stopped)}, 'stopped'); process.exit(0); });` +
      `${printing(['fail', 'AGENT_UNSAFE', 'offered the shell'])} setInterval(() => {}, 1000);`;
    const refused = await failure(run(standIn(script)));
    await vi.waitFor(() => expect(existsSync(stopped)).toBe(true));
    expect(refused).toEqual({ code: 'AGENT_UNSAFE', message: 'offered the shell' });
  });

  test("an agent that exits early fails with the runner's explanation of what it printed", async () => {
    expect(await failure(run(standIn(`process.stderr.write('Error: no credentials found\\n'); process.exit(1);`)))).toEqual({
      code: 'AGENT_FAILED',
      message: 'Antigravity is installed but not signed in. Run "agy" once and complete the login, then try again. (Error: no credentials found)',
    });
  });

  test('with no explanation to offer, the error names the agent, the exit code and what it printed', async () => {
    expect(await failure(run(standIn(`process.stderr.write('segmentation fault\\n'); process.exit(3);`)))).toEqual({
      code: 'AGENT_FAILED',
      message: 'Antigravity exited with code 3 before finishing: segmentation fault',
    });
  });

  test('an agent that exits early and silently says only that', async () => {
    expect(await failure(run(standIn('process.exit(3);')))).toEqual({ code: 'AGENT_FAILED', message: 'Antigravity exited with code 3 before finishing' });
  });

  test('a cancelled run ends as cancelled, not as a failure', async () => {
    const controller = new AbortController();
    const running = run(standIn(`${printing(['session', 'conv-1'])} setInterval(() => {}, 1000);`), { signal: controller.signal });
    controller.abort();
    expect(await failure(running)).toEqual({ code: 'CANCELLED', message: 'Run cancelled.' });
  });

  test('an agent that is not installed is missing, with how to install it or where to point Browsentic', async () => {
    const missing = await failure(run(standIn(''), { bin: join(stateDir, 'no-such-agy') }));
    expect(missing).toEqual({
      code: 'AGENT_MISSING',
      message: `Could not run "${join(stateDir, 'no-such-agy')}" — Antigravity is not installed, or not on the daemon's PATH. Install it (${AGENTS.antigravity.install}), or set {"agents":{"antigravity":{"bin":"/absolute/path/to/agy"}}} in ${configPath}.`,
    });
  });
});

describe('what reaches the process', () => {
  const unsafe = (real: Plan): Plan => ({ ...real, cwd: join(stateDir, 'agents', 'unsafe-run'), files: real.files?.filter((file) => file.path !== 'AGENTS.md') });
  const marker = join(stateDir, 'unsafe-ran');
  const leavesMark = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`;

  test('a plan that has lost its containment is refused before anything is spawned or written', async () => {
    const refused = await failure(run(standIn(leavesMark, unsafe)));
    expect([refused, existsSync(marker), existsSync(join(stateDir, 'agents', 'unsafe-run'))]).toEqual([
      {
        code: 'AGENT_UNSAFE',
        message:
          'Browsentic refused to start Antigravity: Antigravity (run) is spawned without AGENTS.md in its workspace. This is a bug in Browsentic, not something you did — please report it.',
      },
      false,
      false,
    ]);
  });

  test('a one-shot task is vetted the same way', async () => {
    expect([await failure(task(standIn(leavesMark, unsafe))), existsSync(marker)]).toEqual([expect.objectContaining({ code: 'AGENT_UNSAFE' }), false]);
  });

  const seen = `JSON.stringify({ present: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AWS_SECRET_ACCESS_KEY', 'GEMINI_API_KEY'].filter((name) => name in process.env), run: process.env.BROWSENTIC_AGENT_RUN ?? null })`;

  const withParentEnv = () => {
    vi.stubEnv('CLAUDECODE', '1');
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    vi.stubEnv('BROWSENTIC_AGENT_RUN', 'the-run-that-started-this-daemon');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'aws-secret');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-key');
  };

  test("a run loses the parent agent's markers and other vendors' credentials, keeps its own, and sees its own run id", async () => {
    withParentEnv();
    const script = `console.log(JSON.stringify(['text', ${seen}])); console.log('["done","end_turn"]');`;
    expect(JSON.parse((await run(standIn(script))).said)).toEqual({ present: ['GEMINI_API_KEY'], run: 'drive-run' });
  });

  test('a one-shot task gets no run id at all', async () => {
    withParentEnv();
    const answer = await task(standIn(`console.log(JSON.stringify({ result: { response: ${seen} } }));`));
    expect(JSON.parse(answer)).toEqual({ present: ['GEMINI_API_KEY'], run: null });
  });

  test('aborting asks the agent to stop, and only kills it once the grace period is over', async () => {
    const controller = new AbortController();
    const script = `process.on('SIGTERM', () => console.log('asked to stop')); console.log('ready'); setInterval(() => {}, 1000);`;
    const plan = { ...antigravityRunner.stream(streamContext(node, { runId: 'stubborn-run' })), args: ['-e', script] };
    const { child } = launch('antigravity', 'run', node, plan, controller.signal);
    await printed(child.stdout, 'ready');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const kill = vi.spyOn(child, 'kill');
    controller.abort();
    await printed(child.stdout, 'asked to stop');
    vi.advanceTimersByTime(4_999);
    const beforeGrace = kill.mock.calls.map(([signal]) => signal);
    vi.advanceTimersByTime(1);
    const [, signal] = await once(child, 'exit');

    expect({ beforeGrace, after: kill.mock.calls.map(([sent]) => sent), signal }).toEqual({
      beforeGrace: ['SIGTERM'],
      after: ['SIGTERM', 'SIGKILL'],
      signal: 'SIGKILL',
    });
  });

  test('a run whose signal already fired is stopped the moment it starts', async () => {
    const plan = { ...antigravityRunner.stream(streamContext(node, { runId: 'late-run' })), args: ['-e', 'setInterval(() => {}, 1000);'] };
    const { child } = launch('antigravity', 'run', node, plan, AbortSignal.abort());
    const [, signal] = await once(child, 'exit');
    expect(signal).toBe('SIGTERM');
  });
});

describe('a one-shot task', () => {
  test('the answer is what the runner reads out of what it printed', async () => {
    expect(await task(standIn(printing({ result: { status: 'success', response: '  A pricing page.  ' } })))).toBe('A pricing page.');
  });

  test('an error in the answer fails the task with it', async () => {
    expect(await failure(task(standIn(printing({ result: { error: 'quota exceeded' } }))))).toEqual({ code: 'AGENT_FAILED', message: 'quota exceeded' });
  });

  test("no answer, and a complaint the runner recognises, is the runner's explanation", async () => {
    expect(await failure(task(standIn(`process.stderr.write('tool call soft-denied');`)))).toMatchObject({
      code: 'AGENT_FAILED',
      message: expect.stringMatching(/^Antigravity denied a tool call because it has no permission rule for Browsentic\./),
    });
  });

  test('no answer, and a complaint it does not recognise, names the agent and repeats it', async () => {
    expect(await failure(task(standIn(`process.stderr.write('disk full\\n');`)))).toEqual({ code: 'AGENT_FAILED', message: 'Antigravity: disk full' });
  });

  test("no answer and nothing said is the caller's own message", async () => {
    expect(await failure(task(standIn('')))).toEqual({ code: 'AGENT_FAILED', message: 'The agent said nothing.' });
  });

  test("a task stopped by its deadline times out with the caller's message", async () => {
    const controller = new AbortController();
    const running = task(standIn('setInterval(() => {}, 1000);'), { signal: controller.signal });
    controller.abort();
    expect(await failure(running)).toEqual({ code: 'TIMEOUT', message: 'The summary took too long.' });
  });

  test('an agent that is not installed is missing', async () => {
    expect(await failure(task(standIn(''), { bin: join(stateDir, 'no-such-agy') }))).toMatchObject({ code: 'AGENT_MISSING' });
  });
});

function printed(stream: Readable, word: string): Promise<void> {
  return new Promise((resolve) => {
    let output = '';
    const listen = (chunk: Buffer) => {
      output += chunk.toString();
      if (!output.includes(word)) return;
      stream.off('data', listen);
      resolve();
    };
    stream.on('data', listen);
  });
}
