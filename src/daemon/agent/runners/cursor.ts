import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentProblem } from '@/lib/agents/catalog';
import { stateDir } from '../../lockfile';
import type { AgentSettings } from '../config';
import { MCP_SERVER_NAME } from './claude';
import { conversationDir, parseJsonLine, sweepRunDirs } from './util';
import type { JsonContext, Plan, Runner, RunMode, StreamContext, StreamReader, StreamSink } from './types';

/**
 * Cursor takes its MCP server, its permissions and its sandbox from files in the folder it starts
 * in; only the sandbox switch is a flag. Nothing here may be a flag instead — there is no
 * per-invocation MCP registration, and no way to say "use this config and not the user's".
 */
const MCP_FILE = '.cursor/mcp.json';
const RULES = '.cursor/cli.json';
const SANDBOX = '.cursor/sandbox.json';
const PROMPT = 'AGENTS.md';

/** `-p` grants write and shell by its own account, so the deny list is what takes them back. */
const DENIED = ['Shell(*)', 'Write(**)', 'Read(**)'];
const WEB_TOOL = 'WebFetch(*)';

const cursorHome = () => join(homedir(), '.cursor');

const STATUS_TIMEOUT_MS = 5_000;

interface Content {
  type?: string;
  text?: string;
}

interface Event {
  type?: string;
  subtype?: string;
  session_id?: string;
  call_id?: string;
  tool_call?: Record<string, { args?: Record<string, unknown> } | unknown>;
  message?: { role?: string; content?: Content[] };
  result?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  is_error?: boolean;
  error?: string;
  /** Present on a genuine delta. A buffered flush adds `model_call_id`; a final flush has neither. */
  timestamp_ms?: number;
  model_call_id?: string;
}

export const cursorRunner: Runner = {
  kind: 'cursor',
  versionArgs: ['--version'],
  // Cursor has no effort flag; reasoning is a bracket override inside the model id instead.
  efforts: [],

  workspace: (mode: RunMode) => join(stateDir, 'agents', 'cursor', mode),

  skillDirs: () => [join(cursorHome(), 'skills'), join(homedir(), '.agents', 'skills')],

  stream(context: StreamContext): Plan {
    const { settings, research } = context;
    const base = this.workspace('run');
    sweepRunDirs(base);
    // One folder per conversation, rewritten each turn: the config and the prompt are read off
    // disk, so a fresh folder per run would strand both at the first turn.
    return {
      cwd: conversationDir(base, context.conversation ?? context.runId),
      env: { BROWSENTIC_AGENT_RUN: context.runId },
      files: [
        { path: MCP_FILE, content: `${JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: context.mcp } }, null, 2)}\n` },
        { path: RULES, content: permissions({ browser: true, research }) },
        { path: SANDBOX, content: sandbox() },
        { path: PROMPT, content: `${context.systemPrompt.trim()}\n` },
      ],
      args: [
        '-p',
        '--output-format',
        'stream-json',
        '--stream-partial-output',
        '--sandbox',
        'enabled',
        // Headless refuses to start in a folder nobody trusted. The folder is Browsentic's own,
        // holding only files Browsentic wrote, and this grants no tool permission of its own.
        '--trust',
        ...(context.sessionId ? ['--resume', context.sessionId] : []),
        ...(settings.model ? ['--model', settings.model] : []),
        // Last, behind `--`, so an instruction opening with a dash is a prompt and not a flag.
        '--',
        context.instruction,
      ],
    };
  },

  reader(): StreamReader {
    // Deltas arrive as fragments, and Cursor flushes the whole message again at least twice —
    // once before a tool call and once at the end. Say each fragment once, and let the closing
    // `result` supply only whatever the deltas had not already covered.
    let said = '';
    const reported = new Set<string>();

    const push = (text: string, sink: StreamSink) => {
      if (!text) return;
      said += text;
      sink.text(text);
    };

    const finish = (full: string | undefined, sink: StreamSink) => {
      // A flush that does not continue what was already said is the duplicate, not the remainder.
      if (full && (!said || full.startsWith(said))) {
        const rest = full.slice(said.length);
        if (rest) sink.text(rest);
      }
      said = '';
    };

    return (line, sink) => {
      const event = parseJsonLine<Event>(line);
      if (!event) return;

      switch (event.type) {
        case 'system':
          return event.session_id ? sink.session(event.session_id) : undefined;

        case 'assistant': {
          // Only a genuine delta carries a timestamp and no model call id; the rest repeat it.
          if (event.timestamp_ms === undefined || event.model_call_id !== undefined) return;
          return push(textOf(event.message?.content), sink);
        }

        case 'tool_call': {
          if (event.subtype !== 'started') return;
          const id = event.call_id;
          const name = toolOf(event);
          if (!id || !name || reported.has(id)) return;
          reported.add(id);
          return sink.tool(id, name);
        }

        case 'result': {
          if (event.session_id) sink.session(event.session_id);
          if (event.usage) {
            const { inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0 } = event.usage;
            sink.usage({
              contextTokens: inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
              outputTokens,
            });
          }
          if (event.is_error) {
            return sink.fail('AGENT_FAILED', event.error?.trim() || event.result?.trim() || 'Cursor CLI reported an error');
          }
          finish(event.result, sink);
          return sink.done(event.subtype === 'success' ? 'end_turn' : event.subtype || 'end_turn');
        }

        default:
          return;
      }
    };
  },

  json(context: JsonContext): Plan {
    const { settings } = context;
    return {
      cwd: this.workspace('task'),
      files: [
        { path: RULES, content: permissions({ browser: false, reads: context.reads }) },
        { path: SANDBOX, content: sandbox() },
      ],
      args: [
        '-p',
        '--output-format',
        'json',
        '--sandbox',
        'enabled',
        '--trust',
        ...(settings.model ? ['--model', settings.model] : []),
        '--',
        context.prompt,
      ],
    };
  },

  answer(stdout: string) {
    const answer = lastResult(stdout);
    if (!answer) return { error: undefined };
    if (answer.is_error) return { error: answer.error?.trim() || answer.result?.trim() || 'Cursor CLI reported an error' };
    return { text: answer.result };
  },

  hint(stderrTail: string) {
    const tail = plain(stderrTail);
    if (/Authentication required/i.test(tail)) {
      return 'Cursor CLI is installed but not signed in. Run "cursor-agent login", or set CURSOR_API_KEY, then try again.';
    }
    if (/unknown option|argument .* is invalid|unknown command/i.test(tail)) {
      return `Your Cursor CLI does not understand the flags Browsentic uses. Run "cursor-agent update", then try again. (${tail.trim()})`;
    }
    return null;
  },

  async check(settings: AgentSettings): Promise<AgentProblem | null> {
    if (process.env.CURSOR_API_KEY || process.env.CURSOR_AUTH_TOKEN) return null;
    if (await signedIn(settings.bin)) return null;
    return {
      code: 'AGENT_NEEDS_PERMISSION',
      message: 'Cursor CLI is installed but not signed in.',
      fix: 'cursor-agent login',
    };
  },
};

/**
 * `cursor-agent status` says "Not logged in" and still exits 0, so the words are the only answer.
 * Anything else — a timeout, a crash, a sentence nobody expected — reads as signed in, because a
 * popup that wrongly says *needs setup* blocks a working agent, while the run's own hint catches
 * the opposite case.
 */
function signedIn(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const child = spawn(bin, ['status'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(true);
    }, STATUS_TIMEOUT_MS);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    child.on('error', () => done(true));
    child.on('close', () => done(!/not logged in/i.test(plain(output))));
  });
}

/**
 * What a run may do, as Cursor reads it. Deny beats allow, including over anything the user's
 * own global config allows, which is the only reason this is containment rather than a request.
 */
function permissions({ browser, research, reads }: { browser: boolean; research?: boolean; reads?: boolean }): string {
  const deny = browser ? [...DENIED] : DENIED.filter((rule) => !reads || !rule.startsWith('Read('));
  if (!research) deny.push(WEB_TOOL);
  // A run allows only its own server by name. A task denies every server there is, because the
  // user's global mcp.json still loads and a one-shot must not reach the browser at all.
  const allow = browser ? [`Mcp(${MCP_SERVER_NAME}:*)`] : [];
  if (browser) deny.push(...otherServers().map((name) => `Mcp(${name}:*)`));
  else deny.push('Mcp(*)');
  return `${JSON.stringify({ permissions: { allow, deny } }, null, 2)}\n`;
}

/** Read-only, no network of its own — the page is reached through the MCP server, not the shell. */
function sandbox(): string {
  return `${JSON.stringify({ type: 'workspace_readonly', networkPolicy: { default: 'deny' } }, null, 2)}\n`;
}

/**
 * Every MCP server the user configured for Cursor itself. A project config does not replace the
 * global one, so their own Browsentic entry — which reaches the browser outside a run's gate —
 * would load beside ours unless each one is denied by name. Read, never written.
 */
function otherServers(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(join(cursorHome(), 'mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    return Object.keys(parsed.mcpServers ?? {}).filter((name) => name !== MCP_SERVER_NAME);
  } catch {
    return [];
  }
}

const textOf = (content: Content[] | undefined): string =>
  (content ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('');

/** A tool call names itself by the key it arrives under — `readToolCall`, `shellToolCall`. */
function toolOf(event: Event): string | undefined {
  // `tool_call` also carries toolCallId, startedAtMs and hook contexts; only one key names a tool.
  const [key, value] = Object.entries(event.tool_call ?? {}).find(([name]) => name.endsWith('ToolCall')) ?? [];
  if (!key) return undefined;
  const args = (value as { args?: Record<string, unknown> } | undefined)?.args;
  const server = args?.['server'];
  // The daemon already puts its own MCP calls on the timeline; reporting them again double-draws.
  if (typeof server === 'string') {
    if (server === MCP_SERVER_NAME) return undefined;
    const tool = args?.['name'];
    return `${server}:${typeof tool === 'string' ? tool : key}`;
  }
  return key.replace(/ToolCall$/, '');
}

/** Cursor colours its output, so a pattern has to see the sentence rather than the escapes. */
const plain = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, '');

function lastResult(stdout: string): Event | null {
  for (const line of stdout.trim().split('\n').reverse()) {
    const parsed = parseJsonLine<Event>(line.trim());
    if (parsed?.type === 'result') return parsed;
  }
  return null;
}
