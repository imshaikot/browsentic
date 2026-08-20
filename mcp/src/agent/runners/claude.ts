import { randomUUID } from 'node:crypto';
import { stateDir } from '../../lockfile';
import { log } from '../../log';
import { effortOf, parseJsonLine } from './util';
import type { JsonContext, Plan, Runner, StreamContext, StreamReader } from './types';

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

export const claudeRunner: Runner = {
  kind: 'claude',
  versionArgs: ['--version'],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],

  workspace: () => stateDir,

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
    return (line, sink) => {
      const message = parseJsonLine<StreamLine>(line);
      if (!message) return;

      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            if (message.session_id) sink.session(message.session_id);
            const builtins = (message.tools ?? []).filter((tool) => !tool.startsWith('mcp__'));
            log(`claude session ${message.session_id} up, built-ins: ${builtins.join(', ') || 'none'}`);
          }
          return;

        case 'stream_event': {
          if (message.parent_tool_use_id) return;
          const event = message.event;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
            return sink.text(event.delta.text);
          }
          if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            const name = event.content_block.name ?? 'tool';
            if (WEB_TOOLS.includes(name)) sink.tool(event.content_block.id ?? randomUUID(), name);
          }
          return;
        }

        case 'result':
          if (message.is_error) {
            return sink.fail('AGENT_FAILED', message.result || message.subtype || 'Claude Code reported an error');
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
