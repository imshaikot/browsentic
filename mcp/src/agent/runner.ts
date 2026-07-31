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
  systemPrompt: string;
  config: AgentConfig;
  research?: boolean;
  sessionId: string;
  resume: boolean;
  signal: AbortSignal;
  emit: (event: RunEvent) => void;
}

export interface RunOutcome {
  stopReason: string;
  established: boolean;
}

const cliPath = join(dirname(fileURLToPath(import.meta.url)), 'cli.js');

const MCP_SERVER_NAME = 'browsentic';

const KILL_GRACE_MS = 5_000;

export function spawnClaude(
  args: string[],
  config: AgentConfig,
  signal: AbortSignal,
  extraEnv?: Record<string, string>,
) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.BROWSENTIC_AGENT_RUN;
  Object.assign(env, extraEnv);

  const child = spawn(config.claudeBin, args, { cwd: stateDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = () => {
    child.kill('SIGTERM');
    const hardKill = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    hardKill.unref();
  };
  if (signal.aborted) kill();
  else signal.addEventListener('abort', kill, { once: true });
  return { child, release: () => signal.removeEventListener('abort', kill) };
}

const BUILTIN_DENIED = [
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'Glob',
  'Grep',
  'Read',
  'Task',
  'Monitor',
  'Workflow',
  'Skill',
  'ToolSearch',
  'SendMessage',
  'TaskOutput',
  'TaskStop',
  'TodoWrite',
  'ReportFindings',
  'CronCreate',
  'CronDelete',
  'CronList',
  'ScheduleWakeup',
  'RemoteTrigger',
  'PushNotification',
  'DesignSync',
  'EnterWorktree',
  'ExitWorktree',
];

const WEB_TOOLS = ['WebSearch', 'WebFetch'];

const ONE_SHOT_DENIED = [...BUILTIN_DENIED, ...WEB_TOOLS];

const OLD_CLAUDE = /unknown option|unrecognized option/i;

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
    '--mcp-config',
    '{"mcpServers":{}}',
    '--strict-mcp-config',
    '--tools',
    ...(allowedTools.length ? allowedTools : ['']),
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

export function runInstruction(request: RunRequest): Promise<RunOutcome> {
  const { config, emit, signal } = request;

  const args = [
    '-p',
    request.instruction,
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--mcp-config',
    JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: process.execPath, args: [cliPath] } } }),
    '--strict-mcp-config',
    '--tools',
    ...(request.research ? WEB_TOOLS : ['']),
    '--allowedTools',
    `mcp__${MCP_SERVER_NAME}`,
    ...(request.research ? WEB_TOOLS : []),
    '--disallowedTools',
    ...BUILTIN_DENIED,
    ...(request.research ? [] : WEB_TOOLS),
    '--append-system-prompt',
    request.systemPrompt,
    ...(request.resume ? ['--resume', request.sessionId] : ['--session-id', request.sessionId]),
    ...(config.model ? ['--model', config.model] : []),
    ...(config.effort ? ['--effort', config.effort] : []),
  ];

  return new Promise<RunOutcome>((resolve, reject) => {
    const { child, release } = spawnClaude(args, config, signal, { BROWSENTIC_AGENT_RUN: request.runId });

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
        return;
      }

      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            established = true;
            const builtins = (message.tools ?? []).filter((tool) => !tool.startsWith('mcp__'));
            log(
              `agent run ${request.runId}: claude session ${message.session_id} up, built-ins: ${builtins.join(', ') || 'none'}`,
            );
          }
          return;

        case 'stream_event': {
          if (message.parent_tool_use_id) return;
          const event = message.event;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            emit({ kind: 'text', delta: event.delta.text });
            return;
          }
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
      if (signal.aborted) reject(new RunError('CANCELLED', 'Run cancelled.'));
      else if (OLD_CLAUDE.test(stderrTail)) {
        reject(
          new RunError(
            'AGENT_FAILED',
            `Your Claude Code does not understand the flags Browsentic uses to sandbox a run. Update Claude Code, then try again. (${stderrTail.trim()})`,
          ),
        );
      } else {
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

type StreamLine =
  | { type: 'system'; subtype?: string; session_id?: string; tools?: string[] }
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
