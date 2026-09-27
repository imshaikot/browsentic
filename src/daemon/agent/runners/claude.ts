import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stateDir } from '../../lockfile';
import { log } from '../../log';
import { browserToolsDidNotStart, effortOf, parseJsonLine } from './util';
import type { JsonContext, Plan, Runner, StreamContext, StreamReader, StreamSink } from './types';

export const MCP_SERVER_NAME = 'browsentic';

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

interface UsageLine {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

/** A server still `pending` may yet connect; anything else but `connected` never will this run. */
const STARTING = ['connected', 'pending'];

type StreamLine =
  | {
      type: 'system';
      subtype?: string;
      session_id?: string;
      tools?: string[];
      mcp_servers?: { name?: string; status?: string }[];
    }
  | {
      type: 'user';
      parent_tool_use_id?: string | null;
      message?: { content?: string | { type?: string; tool_use_id?: string; is_error?: boolean }[] };
    }
  | {
      type: 'stream_event';
      parent_tool_use_id?: string | null;
      event?: {
        type?: string;
        delta?: { type?: string; text?: string };
        content_block?: { type?: string; id?: string; name?: string };
        message?: { usage?: UsageLine };
        usage?: UsageLine;
      };
    }
  | {
      type: 'result';
      is_error?: boolean;
      subtype?: string;
      stop_reason?: string | null;
      result?: string;
      usage?: UsageLine;
    };

export const claudeRunner: Runner = {
  kind: 'claude',
  versionArgs: ['--version'],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  opens: ['text', 'pdf', 'image'],
  // Claude Code records the system prompt on a session's first request and resends that record on every
  // resume, whatever --append-system-prompt says (`--system-prompt-snapshot`, on by default in 2.1.283).
  keepsFirstPrompt: true,

  workspace: () => stateDir,

  skillDirs: () => [join(homedir(), '.claude', 'skills')],

  stream(context: StreamContext): Plan {
    const { settings, research } = context;
    const effort = effortOf(settings, this.efforts);
    return {
      cwd: this.workspace('run'),
      env: { BROWSENTIC_AGENT_RUN: context.runId },
      args: [
        '-p',
        context.instruction,
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--mcp-config',
        JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: context.mcp } }),
        '--strict-mcp-config',
        '--tools',
        ...(research ? WEB_TOOLS : ['']),
        '--allowedTools',
        `mcp__${MCP_SERVER_NAME}`,
        ...(research ? WEB_TOOLS : []),
        '--disallowedTools',
        ...BUILTIN_DENIED,
        ...(research ? [] : WEB_TOOLS),
        '--append-system-prompt',
        context.systemPrompt,
        ...(context.sessionId ? ['--resume', context.sessionId] : ['--session-id', randomUUID()]),
        ...(settings.model ? ['--model', settings.model] : []),
        ...(effort ? ['--effort', effort] : []),
      ],
    };
  },

  reader(): StreamReader {
    // A message's usage is only final in its message_delta. The assistant lines repeat the
    // opening snapshot once per content block, so counting those under-reports and double-counts.
    let prompt = 0;
    let generated = 0;
    let counted = false;

    // Its own web tools are the only rows this reader opens, so only their results close one.
    const opened = new Set<string>();

    const promptOf = (usage: UsageLine) =>
      (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);

    const report = (usage: UsageLine, sink: StreamSink) => {
      counted = true;
      generated += usage.output_tokens ?? 0;
      sink.usage({ contextTokens: prompt + (usage.output_tokens ?? 0), outputTokens: generated });
    };

    return (line, sink) => {
      const message = parseJsonLine<StreamLine>(line);
      if (!message) return;

      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            if (message.session_id) sink.session(message.session_id);
            const builtins = (message.tools ?? []).filter((tool) => !tool.startsWith('mcp__'));
            log(`claude session ${message.session_id} up, built-ins: ${builtins.join(', ') || 'none'}`);
            const browser = message.mcp_servers?.find((server) => server.name === MCP_SERVER_NAME);
            // Claude Code carries on without a server that failed, and the model answers without the page.
            if (browser?.status && !STARTING.includes(browser.status)) {
              log(`claude session ${message.session_id}: the ${MCP_SERVER_NAME} server is ${browser.status}`);
              return sink.fail('AGENT_FAILED', browserToolsDidNotStart('Claude Code'));
            }
          }
          return;

        case 'user': {
          if (message.parent_tool_use_id || !Array.isArray(message.message?.content)) return;
          for (const block of message.message.content) {
            if (block.type !== 'tool_result' || !block.tool_use_id || !opened.has(block.tool_use_id)) continue;
            opened.delete(block.tool_use_id);
            sink.toolResult(block.tool_use_id, block.is_error !== true);
          }
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
            if (!WEB_TOOLS.includes(name)) return;
            const id = event.content_block.id ?? randomUUID();
            opened.add(id);
            sink.tool(id, name);
          }
          if (event?.type === 'message_start') prompt = promptOf(event.message?.usage ?? {});
          if (event?.type === 'message_delta' && event.usage) report(event.usage, sink);
          return;
        }

        case 'result':
          if (message.is_error) {
            return sink.fail('AGENT_FAILED', message.result || message.subtype || 'Claude Code reported an error');
          }
          if (!counted && message.usage) {
            prompt = promptOf(message.usage);
            report(message.usage, sink);
          }
          return sink.done(message.stop_reason || 'end_turn');
      }
    };
  },

  json(context: JsonContext): Plan {
    const { settings, reads } = context;
    const allowed = reads ? ['Read'] : [];
    const effort = effortOf(settings, this.efforts);
    return {
      cwd: this.workspace('task'),
      args: [
        '-p',
        context.prompt,
        '--output-format',
        'json',
        '--no-session-persistence',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--strict-mcp-config',
        '--tools',
        ...(allowed.length ? allowed : ['']),
        ...(allowed.length ? ['--allowedTools', ...allowed] : []),
        '--disallowedTools',
        ...ONE_SHOT_DENIED.filter((tool) => !allowed.includes(tool)),
        ...(settings.model ? ['--model', settings.model] : []),
        ...(effort ? ['--effort', effort] : []),
      ],
    };
  },

  answer(stdout: string) {
    let parsed: { is_error?: boolean; subtype?: string; result?: unknown };
    try {
      parsed = JSON.parse(stdout) as typeof parsed;
    } catch {
      return {};
    }
    if (parsed.is_error) {
      return { error: String(parsed.result || parsed.subtype || 'Claude Code reported an error') };
    }
    return { text: typeof parsed.result === 'string' ? parsed.result : undefined };
  },

  hint(stderrTail: string) {
    if (!OLD_CLAUDE.test(stderrTail)) return null;
    return (
      'Your Claude Code does not understand the flags Browsentic uses to sandbox a run. ' +
      `Update Claude Code, then try again. (${stderrTail.trim()})`
    );
  },
};
