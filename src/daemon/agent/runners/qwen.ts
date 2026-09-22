import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentProblem } from '@/lib/agents/catalog';
import { stateDir } from '../../lockfile';
import { log } from '../../log';
import { MCP_SERVER_NAME } from './claude';
import { parseJsonLine } from './util';
import type { JsonContext, Plan, Runner, RunMode, StreamContext, StreamReader, StreamSink } from './types';

/**
 * Qwen takes every setting a run needs as a flag, so this runner writes nothing to disk.
 *
 * `--safe-mode` is what makes that safe: it drops the user's hooks, extensions, bundled skills,
 * settings-sourced MCP servers, `.mcp.json` and permission rules, while keeping `--mcp-config` —
 * an explicit per-invocation argument rather than ambient state. It is Qwen's `--strict-mcp-config`
 * and then some. Its one cost is that it also ignores `--core-tools`, the fail-closed allowlist
 * over Qwen's twenty-one core tools, so the built-ins are closed with deny rules instead and the
 * `init` line is read back to prove they took.
 */

/** The shell and the disk. `Read` and `Edit` are Qwen's own meta-rules, each covering several tools. */
const MACHINE = ['Bash', 'exec', 'Edit', 'Read', 'zoom_image', 'monitor', 'lsp', 'save_memory'];

/**
 * Not the shell, but a way around the gate. `skill` is the one that matters: Qwen ships bundled
 * browser-use and computer-use skills, and the first drives a second browser Browsentic never sees
 * while the second runs `qwen mcp add --scope user` and `npm install` by itself on first use.
 * Browsentic's own skill picker reads SKILL.md off disk, so denying the tool costs it nothing.
 */
const ESCAPES = [
  'skill',
  'agent',
  'create_sub_session',
  'workflow',
  'send_message',
  'team_create',
  'team_delete',
  'cron_create',
  'cron_list',
  'cron_delete',
  'loop_wakeup',
  'propose_goal',
  'artifact',
  'record_artifact',
  'record_source',
  'image_gen',
  'read_mcp_resource',
];

const WEB_TOOLS = ['web_search', 'web_fetch'];

const READ_TOOL = 'read_file';

/** The rest of what `Read` covers, for a one-shot that may open its own scratch file and nothing else. */
const OTHER_READS = ['grep_search', 'glob', 'list_directory'];

/** Qwen's default is `auto`, which spends an LLM classifier call per tool call; this one just refuses. */
const APPROVAL = 'default';

/**
 * Families that hand a run the machine, whether or not this version of Browsentic knew to name
 * them. A deny list cannot be fail-closed the way `--core-tools` would have been, so the `init`
 * line — which names every tool that actually registered — is read back against this.
 */
const DANGEROUS =
  /^(run_shell_command|exec|edit|write_file|notebook_edit|read_file|grep_search|glob|list_directory|agent|skill|monitor|save_memory|lsp|zoom_image|image_gen|workflow|send_message|create_sub_session|propose_goal|cron_|team_|computer_use__|omni_)/;

const qwenHome = () => process.env.QWEN_HOME || join(homedir(), '.qwen');

const INSTALL = 'npm i -g @qwen-code/qwen-code';

/** The env keys that select an auth type on their own, narrowed to what a sealed run can still see. */
const AUTH_KEYS = ['QWEN_API_KEY', 'OPENAI_API_KEY', 'DASHSCOPE_API_KEY'];

const AUTH_PREFIX = /^(QWEN_|DASHSCOPE_|BAILIAN_|OPENAI_).*(API_KEY|TOKEN)$/;

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface Block {
  type?: string;
  id?: string;
  name?: string;
}

type Line =
  | {
      type: 'system';
      subtype?: string;
      session_id?: string;
      tools?: string[];
      mcp_servers?: { name?: string; status?: string }[];
      permission_mode?: string;
    }
  | {
      type: 'assistant';
      session_id?: string;
      parent_tool_use_id?: string | null;
      message?: { usage?: Usage };
    }
  | {
      type: 'stream_event';
      parent_tool_use_id?: string | null;
      event?: { type?: string; delta?: { type?: string; text?: string }; content_block?: Block };
    }
  | {
      type: 'result';
      subtype?: string;
      session_id?: string;
      is_error?: boolean;
      result?: string;
      usage?: Usage;
      error?: { message?: string };
    };

export const qwenRunner: Runner = {
  kind: 'qwen',
  versionArgs: ['--version'],
  // No reasoning-effort flag; the model id is the only lever.
  efforts: [],

  // Sessions are filed under ~/.qwen/projects/<sanitized-cwd>, so a resume only finds the
  // conversation it began in when this stays put.
  workspace: (mode: RunMode) => join(stateDir, 'agents', 'qwen', mode),

  skillDirs: () => [join(qwenHome(), 'skills'), join(homedir(), '.agents', 'skills')],

  stream(context: StreamContext): Plan {
    const { settings, research } = context;
    return {
      cwd: this.workspace('run'),
      env: { BROWSENTIC_AGENT_RUN: context.runId },
      args: [
        // First, and a string-typed flag: an array-typed flag upstream would swallow a positional
        // prompt, and the bare positional Qwen now prefers is exactly that.
        '-p',
        context.instruction,
        '--safe-mode',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--approval-mode',
        APPROVAL,
        '--mcp-config',
        JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: context.mcp } }),
        // Only this server may load, whatever else the user gave Qwen itself.
        '--allowed-mcp-server-names',
        MCP_SERVER_NAME,
        // A headless turn refuses anything it would have prompted for, so what a run may do has
        // to be auto-approved by name. One entry covers every tool the server offers.
        '--allowed-tools',
        `mcp__${MCP_SERVER_NAME}`,
        ...(research ? WEB_TOOLS : []),
        '--exclude-tools',
        ...MACHINE,
        ...ESCAPES,
        ...(research ? [] : WEB_TOOLS),
        '--append-system-prompt',
        context.systemPrompt,
        ...(context.sessionId ? ['--resume', context.sessionId] : ['--session-id', randomUUID()]),
        ...(settings.model ? ['--model', settings.model] : []),
      ],
    };
  },

  reader(): StreamReader {
    // Qwen has no message_delta, so a message's usage arrives once, on the assistant line that
    // closes it. The terminal result repeats the run's total, which is only worth reporting when
    // no assistant line carried one.
    let prompt = 0;
    let generated = 0;
    let counted = false;

    const promptOf = (usage: Usage) =>
      (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);

    const report = (usage: Usage, sink: StreamSink) => {
      counted = true;
      prompt = promptOf(usage);
      generated += usage.output_tokens ?? 0;
      sink.usage({ contextTokens: prompt + (usage.output_tokens ?? 0), outputTokens: generated });
    };

    return (line, sink) => {
      const message = parseJsonLine<Line>(line);
      if (!message) return;

      switch (message.type) {
        case 'system': {
          if (message.session_id) sink.session(message.session_id);
          // Qwen re-announces the session whenever the tool set is refreshed, so this is read
          // back on every such line, not only the first.
          if (!message.tools && !message.mcp_servers && !message.permission_mode) return;
          const unsafe = escaped(message);
          if (unsafe) return sink.fail('AGENT_UNSAFE', unsafe);
          log(`qwen session ${message.session_id} up, ${message.tools?.length ?? 0} tools registered`);
          return;
        }

        case 'stream_event': {
          if (message.parent_tool_use_id) return;
          const event = message.event;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            return sink.text(event.delta.text);
          }
          if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            const name = event.content_block.name ?? 'tool';
            // The daemon already puts its own MCP calls on the timeline; repeating them double-draws.
            if (WEB_TOOLS.includes(name)) sink.tool(event.content_block.id ?? randomUUID(), name);
          }
          return;
        }

        case 'assistant':
          if (message.parent_tool_use_id) return;
          if (message.message?.usage) report(message.message.usage, sink);
          return;

        case 'result':
          if (message.session_id) sink.session(message.session_id);
          if (!counted && message.usage) report(message.usage, sink);
          if (message.is_error) {
            return sink.fail(
              'AGENT_FAILED',
              explain(message.error?.message) ?? (message.result?.trim() || 'Qwen Code reported an error'),
            );
          }
          return sink.done(message.subtype === 'success' ? 'end_turn' : message.subtype || 'end_turn');
      }
    };
  },

  json(context: JsonContext): Plan {
    const { settings, reads } = context;
    const denied = reads ? [...MACHINE.filter((tool) => tool !== 'Read'), ...OTHER_READS] : MACHINE;
    return {
      cwd: this.workspace('task'),
      args: [
        '-p',
        context.prompt,
        '--safe-mode',
        '--output-format',
        'json',
        '--approval-mode',
        APPROVAL,
        // Safe mode drops the user's own servers, so an empty set here means a one-shot loads none
        // at all and cannot reach the browser however the daemon is configured.
        '--mcp-config',
        '{"mcpServers":{}}',
        ...(reads ? ['--allowed-tools', READ_TOOL] : []),
        '--exclude-tools',
        ...denied,
        ...ESCAPES,
        ...WEB_TOOLS,
        ...(settings.model ? ['--model', settings.model] : []),
      ],
    };
  },

  answer(stdout: string) {
    const answer = lastResult(stdout);
    if (!answer) return {};
    if (answer.is_error) {
      return { error: explain(answer.error?.message) ?? (answer.result?.trim() || 'Qwen Code reported an error') };
    }
    return { text: typeof answer.result === 'string' ? answer.result : undefined };
  },

  hint(stderrTail: string) {
    // `-p` is soft-deprecated in favour of a bare positional, which array-typed flags would swallow.
    const tail = stderrTail.replace(/^.*Use the positional prompt instead.*$/gm, '').trim();
    if (/No auth type is selected|API key not found|not authenticated/i.test(tail)) {
      return (
        'Qwen Code is installed but has no model provider configured. Run "qwen" and use /auth, ' +
        'or export OPENAI_API_KEY with OPENAI_BASE_URL, then try again.'
      );
    }
    if (/Session Id .* already exists/i.test(tail)) {
      return `Qwen Code refused the session id Browsentic minted. This is a bug in Browsentic — please report it. (${tail})`;
    }
    if (/unknown argument|unknown option|invalid values|not a valid choice/i.test(tail)) {
      return `Your Qwen Code does not understand the flags Browsentic uses. Update it (${INSTALL}), then try again. (${tail})`;
    }
    return null;
  },

  async check(): Promise<AgentProblem | null> {
    const named = Object.entries(process.env).some(([name, value]) => value && AUTH_PREFIX.test(name));
    if (named || AUTH_KEYS.some((name) => process.env[name])) return null;
    if (configured()) return null;
    return {
      code: 'AGENT_NEEDS_PERMISSION',
      message: 'Qwen Code is installed but has no model provider configured.',
      // Qwen OAuth's free tier ended on 2026-04-15 and new requests are rejected, so "just log in"
      // is no longer true for this CLI.
      fix: 'qwen  → /auth   (or export OPENAI_API_KEY and OPENAI_BASE_URL)',
    };
  },
};

/**
 * What the `init` line has to say for the run to be contained: nothing that reaches the machine
 * still registered, no MCP server but ours, and the approval mode we asked for. Returns the
 * sentence to fail with, or undefined when the run may go on.
 */
function escaped(init: { tools?: string[]; mcp_servers?: { name?: string }[]; permission_mode?: string }): string | undefined {
  const denied = new Set([...MACHINE, ...ESCAPES]);
  const live = (init.tools ?? []).filter((tool) => denied.has(tool) || DANGEROUS.test(tool));
  if (live.length) {
    return (
      `Qwen Code registered ${live.join(', ')} for this run, which Browsentic denied, so the run was stopped before the model saw them. ` +
      'Update Qwen Code and Browsentic; if it persists, please report it.'
    );
  }

  const others = (init.mcp_servers ?? []).map((server) => server.name).filter((name) => name && name !== MCP_SERVER_NAME);
  if (others.length) {
    return (
      `Qwen Code loaded the MCP server${others.length > 1 ? 's' : ''} ${others.join(', ')} beside Browsentic's own, which would reach the browser outside this run's gate, so the run was stopped. ` +
      'Update Qwen Code and Browsentic; if it persists, please report it.'
    );
  }

  if (init.permission_mode && init.permission_mode !== APPROVAL) {
    return (
      `Qwen Code started this run in "${init.permission_mode}" rather than "${APPROVAL}", which approves what Browsentic asked it to refuse, so the run was stopped. ` +
      'Update Qwen Code and Browsentic; if it persists, please report it.'
    );
  }

  return undefined;
}

/** Qwen's own sentence, with what to do about it where Browsentic knows. */
function explain(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (/No auth type is selected|API key not found/i.test(message)) {
    return (
      'Qwen Code has no model provider configured. Run "qwen" and use /auth, or export OPENAI_API_KEY ' +
      `with OPENAI_BASE_URL, then try again. (${oneLine(message)})`
    );
  }
  if (/qwen-oauth|Qwen OAuth/i.test(message)) {
    return `Qwen OAuth's free tier was discontinued, so its requests are rejected. Configure another provider with /auth. (${oneLine(message)})`;
  }
  if (/rate limit|429|quota/i.test(message)) {
    return `The provider behind Qwen Code is rate-limiting this account. Wait and try again. (${oneLine(message)})`;
  }
  if (/unknown model|model not found/i.test(message)) {
    return `${oneLine(message)} Pick another model for Qwen Code in the Browsentic popup, then try again.`;
  }
  return oneLine(message);
}

const oneLine = (message: string) => message.replace(/\s+/g, ' ').trim().slice(0, 240);

/** A provider declared on disk, whose key Qwen reads itself. Unreadable counts as configured. */
function configured(): boolean {
  let parsed: { modelProviders?: unknown; security?: { auth?: unknown }; env?: unknown };
  try {
    parsed = JSON.parse(readFileSync(join(qwenHome(), 'settings.json'), 'utf8')) as typeof parsed;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  return Boolean(parsed.modelProviders || parsed.security?.auth || parsed.env);
}

/** `--output-format json` prints an array of every message, so the answer is its last result. */
function lastResult(stdout: string): Extract<Line, { type: 'result' }> | null {
  let messages: unknown;
  try {
    messages = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(messages)) return null;
  for (const message of [...messages].reverse()) {
    if ((message as Line | null)?.type === 'result') return message as Extract<Line, { type: 'result' }>;
  }
  return null;
}
