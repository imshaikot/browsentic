import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentProblem } from '@/lib/agents/catalog';
import { stateDir } from '../../lockfile';
import { MCP_SERVER_NAME } from './claude';
import { effortOf, parseJsonLine, sweepRunDirs } from './util';
import type { JsonContext, McpServer, Plan, Runner, RunMode, StreamContext, StreamReader, StreamSink } from './types';

/** Grok takes every setting a run needs as a flag except its MCP server, which only a project config can add. */
const CONFIG = '.grok/config.toml';

/** `--tools` with nothing in it switches every tool on, so a run that needs none names the one that touches nothing. */
const INERT = 'todo_write';
const WEB_TOOLS = ['web_search', 'web_fetch'];
const READ_TOOL = 'read_file';

/** Every MCP call goes through these two, and Grok offers them whatever `--tools` says. */
const SEARCH_TOOL = 'search_tool';
const USE_TOOL = 'use_tool';

/** All a run can be offered. Anything else means Grok did not honour the list it was given. */
const OFFERED = [SEARCH_TOOL, USE_TOOL, INERT, ...WEB_TOOLS];

const DENIED = ['Bash', 'Edit', 'Write'];

/** Its MCP servers and memory are switched in the environment; see CONTAINMENT.grok for why. */
const SEALED = { GROK_MEMORY: '0', GROK_CLAUDE_MCPS_ENABLED: 'false', GROK_CURSOR_MCPS_ENABLED: 'false' };

/** Headless Grok skips a project's MCP server in a folder nobody trusted, without a word; this trusts one process, not the folder. */
const TRUSTED = { GROK_FOLDER_TRUST: '0' };

/** The skill prompts name tools as the server lists them; Grok reaches them under its own prefix. */
const TOOL_NAMES =
  `Browsentic's tools are on the MCP server named ${MCP_SERVER_NAME}. ` +
  `Call them with ${USE_TOOL}, prefixing each name with "${MCP_SERVER_NAME}__": page_getPageInfo is ${MCP_SERVER_NAME}__page_getPageInfo.`;

const grokHome = () => process.env.GROK_HOME || join(homedir(), '.grok');

interface Usage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
}

interface Event {
  type?: string;
  data?: string;
  tools?: string[];
  toolCallId?: string;
  toolName?: string;
  rawInput?: { tool_name?: string };
  usage?: Usage;
  stopReason?: string;
  sessionId?: string;
  message?: string;
}

interface Answer {
  type?: string;
  text?: string;
  message?: string;
}

export const grokRunner: Runner = {
  kind: 'grok',
  versionArgs: ['--version'],
  efforts: ['low', 'medium', 'high', 'xhigh'],

  workspace: (mode: RunMode) => join(stateDir, 'agents', 'grok', mode),

  skillDirs: () => [join(grokHome(), 'skills'), join(homedir(), '.agents', 'skills'), join(homedir(), '.claude', 'skills')],

  stream(context: StreamContext): Plan {
    const { settings, research } = context;
    const effort = effortOf(settings, this.efforts);
    const base = this.workspace('run');
    sweepRunDirs(base);
    // A conversation keeps one directory, so a resume finds its session wherever Grok files it.
    const conversation = context.sessionId ?? randomUUID();
    return {
      cwd: join(base, conversation.replace(/[^\w-]/g, '_')),
      env: { BROWSENTIC_AGENT_RUN: context.runId, ...SEALED, ...TRUSTED },
      files: [{ path: CONFIG, content: config(context.mcp) }],
      args: [
        '-p',
        context.instruction,
        '--output-format',
        'streaming-json',
        '--permission-mode',
        'dontAsk',
        '--allow',
        `MCPTool(${MCP_SERVER_NAME}__*)`,
        '--tools',
        (research ? WEB_TOOLS : [INERT]).join(','),
        ...denying([...DENIED, 'Read']),
        '--no-subagents',
        '--sandbox',
        'workspace',
        '--rules',
        `${context.systemPrompt.trim()}\n\n${TOOL_NAMES}`,
        ...(context.sessionId ? ['--resume', context.sessionId] : ['--session-id', conversation]),
        ...(settings.model ? ['--model', settings.model] : []),
        ...(effort ? ['--reasoning-effort', effort] : []),
      ],
    };
  },

  reader(): StreamReader {
    const reported = new Set<string>();
    let said = false;
    let turned = false;
    let counted = false;
    let generated = 0;

    const report = (usage: Usage, sink: StreamSink) => {
      counted = true;
      generated += usage.output_tokens ?? 0;
      sink.usage({
        contextTokens:
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.output_tokens ?? 0),
        outputTokens: generated,
      });
    };

    return (line, sink) => {
      const event = parseJsonLine<Event>(line);
      if (!event) return;

      switch (event.type) {
        case 'available_commands': {
          const unexpected = (event.tools ?? []).filter((tool) => !OFFERED.includes(tool));
          if (!unexpected.length) return;
          return sink.fail(
            'AGENT_UNSAFE',
            `Grok Build offered this run ${unexpected.join(', ')}, which Browsentic never asks for, so the run was stopped before the model saw them. ` +
              'Update Grok Build and Browsentic; if it persists, please report it.',
          );
        }

        case 'text':
          if (!event.data) return;
          sink.text(said && turned ? `\n\n${event.data}` : event.data);
          said = true;
          turned = false;
          return;

        case 'tool_call': {
          turned = true;
          const id = event.toolCallId;
          const name = toolOf(event);
          if (!id || !name || reported.has(id)) return;
          reported.add(id);
          if (name !== SEARCH_TOOL && !ownTool(name)) sink.tool(id, name);
          return;
        }

        case 'usage':
          turned = true;
          if (event.usage) report(event.usage, sink);
          return;

        case 'end':
          if (event.sessionId) sink.session(event.sessionId);
          if (!counted && event.usage) report(event.usage, sink);
          return sink.done(event.stopReason || 'end_turn');

        case 'error':
          return sink.fail('AGENT_FAILED', explain(event.message) ?? 'Grok Build reported an error');

        default:
          return;
      }
    };
  },

  json(context: JsonContext): Plan {
    const { settings } = context;
    const effort = effortOf(settings, this.efforts);
    return {
      cwd: this.workspace('task'),
      env: { ...SEALED },
      args: [
        '-p',
        context.prompt,
        '--output-format',
        'json',
        '--permission-mode',
        'dontAsk',
        '--tools',
        context.reads ? READ_TOOL : INERT,
        ...denying(['MCPTool', ...DENIED]),
        '--no-subagents',
        '--sandbox',
        'read-only',
        ...(settings.model ? ['--model', settings.model] : []),
        ...(effort ? ['--reasoning-effort', effort] : []),
      ],
    };
  },

  answer(stdout: string) {
    const answer = lastLine<Answer>(stdout);
    if (answer?.type === 'error') return { error: explain(answer.message) ?? 'Grok Build reported an error' };
    return { text: answer?.text };
  },

  hint(stderrTail: string) {
    const error = /^Error: ([\s\S]+)/m.exec(stderrTail)?.[1]?.trim();
    if (error) return explain(error) ?? null;
    if (/unexpected argument|unrecognized|invalid value/i.test(stderrTail)) {
      return `Your Grok Build does not understand the flags Browsentic uses. Run "grok update", then try again. (${stderrTail.trim()})`;
    }
    return null;
  },

  async check(): Promise<AgentProblem | null> {
    if (process.env.XAI_API_KEY || existsSync(join(grokHome(), 'auth.json'))) return null;
    return {
      code: 'AGENT_NEEDS_PERMISSION',
      message: 'Grok Build is installed but not signed in.',
      fix: 'grok login',
    };
  },
};

const denying = (rules: string[]) => rules.flatMap((rule) => ['--deny', rule]);

const ownTool = (name: string) => name.startsWith(`${MCP_SERVER_NAME}__`);

/** An MCP call is reported under the tool it reaches, which only its input names. */
function toolOf(event: Event): string | undefined {
  if (event.toolName !== USE_TOOL) return event.toolName;
  return event.rawInput ? (event.rawInput.tool_name ?? USE_TOOL) : undefined;
}

/** Grok's own sentence, with what to do about it where Browsentic knows. */
function explain(message: string | undefined): string | undefined {
  if (!message) return message;
  if (/not signed in/i.test(message)) {
    return 'Grok Build is installed but not signed in. Run "grok login", or set XAI_API_KEY, then try again.';
  }
  if (/unknown model id|couldn't set model/i.test(message)) {
    return `${sentence(message)} Pick another model for Grok Build in the Browsentic popup, then try again.`;
  }
  if (/unknown effort level/i.test(message)) {
    return `${sentence(message)} Pick another effort for Grok Build in the Browsentic popup, then try again.`;
  }
  if (/resource has been exhausted|requests too quickly/i.test(message)) {
    return `xAI is rate-limiting this Grok account. Wait a few minutes and try again, or upgrade at https://grok.com/supergrok. (${oneLine(message)})`;
  }
  // Grok retries a rate-limited request for minutes before it gives up with this.
  if (/did not respond to this request|service temporarily unavailable/i.test(message)) {
    return `xAI did not answer, after Grok Build had retried for several minutes. A free Grok account is rate-limited this way; wait and try again. (${oneLine(message)})`;
  }
  if (/re-run with --trust|folder untrusted/i.test(message)) {
    return `Grok Build refused to use Browsentic's workspace because it is not trusted. This is a bug in Browsentic — please report it. (${message})`;
  }
  return message;
}

const oneLine = (message: string) => message.replace(/\s+/g, ' ').slice(0, 240);

const sentence = (message: string) => (/[.!?]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`);

function config(server: McpServer): string {
  const quote = (value: string) => JSON.stringify(value);
  const env = Object.entries(server.env).map(([name, value]) => `${name} = ${quote(value)}`);
  return [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = ${quote(server.command)}`,
    `args = [${server.args.map(quote).join(', ')}]`,
    `env = { ${env.join(', ')} }`,
    '',
  ].join('\n');
}

function lastLine<T>(stdout: string): T | null {
  for (const line of stdout.trim().split('\n').reverse()) {
    const parsed = parseJsonLine<T>(line.trim());
    if (parsed) return parsed;
  }
  return null;
}
