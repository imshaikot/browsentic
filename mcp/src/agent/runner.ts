import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunEvent } from '@/lib/actions/protocol';
import { stateDir } from '../lockfile';
import { log } from '../log';
import type { AgentConfig } from './config';

export interface RunRequest {
  runId: string;
  instruction: string;
  /** Already composed by the caller, which needs `dropped` and must not build it twice. */
  systemPrompt: string;
  config: AgentConfig;
  /**
   * Enable Claude Code's own `WebSearch`/`WebFetch` for this run. Only a mapping run sets it,
   * and only to satisfy "public info about this domain".
   *
   * Worth being plain about what this costs: these are not MCP tools, so they do not pass
   * through the daemon, the approval gate, or `invokeForRun`. Nothing can gate them; the
   * `tool_use` rows below exist so they are at least *visible* on the timeline.
   */
  research?: boolean;
  /** The Claude Code session this browser's conversation lives in. */
  sessionId: string;
  /** False on the first instruction, true once the session exists to be resumed. */
  resume: boolean;
  signal: AbortSignal;
  emit: (event: RunEvent) => void;
}

export interface RunOutcome {
  stopReason: string;
  /** True once Claude Code has persisted the session, so the next run may `--resume` it. */
  established: boolean;
}

/** Same directory as this bundle in `dist/` — the stdio MCP entry the spawned agent loads. */
const cliPath = join(dirname(fileURLToPath(import.meta.url)), 'cli.js');

const KILL_GRACE_MS = 5_000;

/**
 * Spawn the user's Claude Code with the daemon's env hygiene, shared by the interactive run
 * loop and the one-shot file summarizer: drop the nested-session markers a daemon started from
 * inside Claude Code would otherwise inherit, run in a fixed cwd so no project CLAUDE.md leaks
 * in, and wire abort → SIGTERM/SIGKILL. The caller owns stdout parsing; call `release()` once
 * the process has closed so the abort listener does not outlive it.
 */
export function spawnClaude(
  args: string[],
  config: AgentConfig,
  signal: AbortSignal,
  extraEnv?: Record<string, string>,
) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const child = spawn(config.claudeBin, args, { cwd: stateDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = () => {
    child.kill('SIGTERM');
    const hardKill = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    hardKill.unref();
  };
  // A listener added to an already-aborted signal never fires, so a signal that aborted while the
  // caller was awaiting something before this point would spawn a child nothing could ever kill.
  if (signal.aborted) kill();
  else signal.addEventListener('abort', kill, { once: true });
  return { child, release: () => signal.removeEventListener('abort', kill) };
}

/**
 * Everything a one-shot run must not be able to reach; `allowedTools` opens back only what it needs,
 * and is filtered out of this list so the two flags never name the same tool. `Read` is on it
 * because denying by default is the point — the summarizer asks for it back, the namer does not.
 */
const ONE_SHOT_DENIED = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'Task'];

/**
 * One run of `claude -p --output-format json`, resolving the `result` text or rejecting `RunError`.
 * The stateless side of the harness: no MCP config, no `VOICELINK_AGENT_RUN`, no stream parsing —
 * these runs answer a question and drive nothing.
 *
 * Shared by the file summarizer and the session namer rather than copied into each: the stdout
 * shape, the ENOENT wording and the abort handling are all things that must not drift between them.
 */
export function runClaudeJson(
  prompt: string,
  config: AgentConfig,
  signal: AbortSignal,
  { allowedTools = [], timedOut, empty }: { allowedTools?: string[]; timedOut: string; empty: string },
): Promise<string> {
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    // Whatever the caller needs and nothing else, so the material being read cannot talk the
    // one-shot out of its lane. An empty list is the honest default: most of these read nothing.
    ...(allowedTools.length ? ['--allowedTools', ...allowedTools] : []),
    '--disallowedTools',
    ...ONE_SHOT_DENIED.filter((tool) => !allowedTools.includes(tool)),
    ...(config.model ? ['--model', config.model] : []),
    ...(config.effort ? ['--effort', config.effort] : []),
  ];

  return new Promise<string>((resolve, reject) => {
    const { child, release } = spawnClaude(args, config, signal);
    let stdout = '';
    let stderrTail = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      release();
      if (error.code === 'ENOENT') {
        reject(
          new RunError(
            'NO_CLAUDE',
            `Could not find "${config.claudeBin}". Install Claude Code, or set {"claudeBin": "/path/to/claude"} in the daemon's config.json.`,
          ),
        );
      } else {
        reject(new RunError('AGENT_FAILED', error.message));
      }
    });

    child.on('close', () => {
      release();
      if (signal.aborted) return reject(new RunError('TIMEOUT', timedOut));
      let parsed: { is_error?: boolean; subtype?: string; result?: unknown };
      try {
        parsed = JSON.parse(stdout) as typeof parsed;
      } catch {
        return reject(
          new RunError(
            'AGENT_FAILED',
            `Claude Code returned no parseable result${stderrTail ? `: ${stderrTail.trim()}` : ''}`,
          ),
        );
      }
      if (parsed.is_error) {
        return reject(
          new RunError('AGENT_FAILED', String(parsed.result || parsed.subtype || 'Claude Code reported an error')),
        );
      }
      const text = typeof parsed.result === 'string' ? parsed.result.trim() : '';
      if (!text) return reject(new RunError('AGENT_FAILED', empty));
      resolve(text);
    });
  });
}

/**
 * One instruction, run by the user's own Claude Code (`claude -p`) rather than a direct API
 * call — no key to manage, and the user's existing login, model choice and limits apply.
 *
 * The child reaches the browser through our own MCP server: `--mcp-config` points it back at
 * `cli.js`, which dials this daemon's control socket, so every page tool travels the exact
 * path an external MCP client would use. `VOICELINK_AGENT_RUN` rides along in the child's
 * environment and comes back attached to those invocations, which is how the daemon knows to
 * gate and report them against this run.
 */
export function runInstruction(request: RunRequest): Promise<RunOutcome> {
  const { config, emit, signal } = request;

  const args = [
    '-p',
    request.instruction,
    // stream-json is the machine interface; --verbose is required for it in print mode, and
    // --include-partial-messages is what turns on token-level text deltas.
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    // Only our MCP server — never the user's other configured servers.
    '--mcp-config',
    JSON.stringify({ mcpServers: { voicelink: { command: process.execPath, args: [cliPath] } } }),
    '--strict-mcp-config',
    // Print mode auto-denies tools that would prompt; the server-level grant lets every
    // voicelink tool run. The daemon applies its own approval gate on top. One flag, not two:
    // the option is variadic, so a second `--allowedTools` would replace this list rather than
    // extend it.
    '--allowedTools',
    'mcp__voicelink',
    // The web tools are the one exception to the deny list below, and only for a mapping run,
    // which is asked to report what public sources say about a domain. That run therefore both
    // reads hostile page text and can make outbound requests — the exfiltration shape the deny
    // list otherwise prevents. A deliberate trade, switchable off with `siteMap.research: false`.
    ...(request.research ? ['WebSearch', 'WebFetch'] : []),
    // The job is in the browser. Filesystem, shell and subagent tools stay off, so a hostile
    // page cannot talk the agent into reaching outside it.
    '--disallowedTools',
    'Bash',
    'Edit',
    'Write',
    'NotebookEdit',
    'Read',
    'Glob',
    'Grep',
    ...(request.research ? [] : ['WebFetch', 'WebSearch']),
    'Task',
    '--append-system-prompt',
    request.systemPrompt,
    ...(request.resume ? ['--resume', request.sessionId] : ['--session-id', request.sessionId]),
    ...(config.model ? ['--model', config.model] : []),
    ...(config.effort ? ['--effort', config.effort] : []),
  ];

  return new Promise<RunOutcome>((resolve, reject) => {
    // VOICELINK_AGENT_RUN rides along so the browser invocations this run makes come back
    // tagged to it; the summarizer path spawns without it, since it drives nothing.
    const { child, release } = spawnClaude(args, config, signal, { VOICELINK_AGENT_RUN: request.runId });

    let established = false;
    let settledByResult = false;
    let stderrTail = '';

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
    });

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let message: StreamLine;
      try {
        message = JSON.parse(line) as StreamLine;
      } catch {
        return; // Not every line of a misbehaving child is JSON; skip rather than die.
      }

      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            established = true;
            log(`agent run ${request.runId}: claude session ${message.session_id} up`);
          }
          return;

        case 'stream_event': {
          // Subagent output carries a parent id; only top-level assistant text is the answer.
          if (message.parent_tool_use_id) return;
          const event = message.event;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            emit({ kind: 'text', delta: event.delta.text });
            return;
          }
          // Claude Code's own tools never reach the daemon — they are not MCP calls — so this
          // is the only place a web search can be reported at all. Not a gate; a record.
          if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            const name = event.content_block.name ?? 'tool';
            if (name === 'WebSearch' || name === 'WebFetch') {
              emit({ kind: 'tool', toolId: event.content_block.id ?? `web-${Date.now()}`, action: name, input: {} });
            }
          }
          return;
        }

        case 'result':
          settledByResult = true;
          if (message.is_error) {
            reject(new RunError('AGENT_FAILED', message.result || message.subtype || 'Claude Code reported an error'));
          } else {
            resolve({ stopReason: message.stop_reason || 'end_turn', established });
          }
          return;
      }
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        reject(
          new RunError(
            'NO_CLAUDE',
            `Could not find "${config.claudeBin}". Install Claude Code, or set {"claudeBin": "/path/to/claude"} in the daemon's config.json.`,
          ),
        );
      } else {
        reject(new RunError('AGENT_FAILED', error.message));
      }
    });

    child.on('close', (exitCode) => {
      release();
      if (settledByResult) return;
      // No result line: the child died mid-run or was cancelled.
      if (signal.aborted) reject(new RunError('CANCELLED', 'Run cancelled.'));
      else {
        reject(
          new RunError(
            'AGENT_FAILED',
            `Claude Code exited with code ${exitCode} before finishing${stderrTail ? `: ${stderrTail.trim()}` : ''}`,
          ),
        );
      }
    });
  });
}

/** The stream-json lines this runner reads; everything else on stdout is ignored. */
type StreamLine =
  | { type: 'system'; subtype?: string; session_id?: string }
  | {
      type: 'stream_event';
      parent_tool_use_id?: string | null;
      event?: {
        type?: string;
        delta?: { type?: string; text?: string };
        content_block?: { type?: string; id?: string; name?: string };
      };
    }
  | { type: 'result'; is_error?: boolean; subtype?: string; stop_reason?: string | null; result?: string };

export class RunError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RunError';
  }
}
