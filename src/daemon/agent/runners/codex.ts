import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stateDir } from '../../lockfile';
import { MCP_SERVER_NAME } from './claude';
import { effortOf, parseJsonLine } from './util';
import type { JsonContext, Plan, Runner, StreamContext, StreamReader } from './types';

/** Codex has no per-run tool allowlist; the read-only sandbox is what keeps a run inside the browser. */
const SANDBOX = ['--sandbox', 'read-only', '--ask-for-approval', 'never', '--skip-git-repo-check'];

const WEB_TOOL = 'web_search';

interface Item {
  id?: string;
  type?: string;
  item_type?: string;
  text?: string;
  message?: string;
  query?: string;
  command?: string;
}

/** Codex counts cached input inside `input_tokens`; it is a subset, not an addition. */
interface TokenCounts {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface TypedEvent {
  type?: string;
  thread_id?: string;
  item?: Item;
  usage?: TokenCounts;
  error?: { message?: string };
  message?: string;
}

interface LegacyEvent {
  msg?: {
    type?: string;
    delta?: string;
    message?: string;
    session_id?: string;
    query?: string;
    error?: string;
    info?: { total_token_usage?: TokenCounts; last_token_usage?: TokenCounts };
  };
}

export const codexRunner: Runner = {
  kind: 'codex',
  versionArgs: ['--version'],
  efforts: ['minimal', 'low', 'medium', 'high'],

  workspace: () => stateDir,

  skillDirs: () => [join(homedir(), '.codex', 'skills'), join(homedir(), '.codex', 'prompts')],

  stream(context: StreamContext): Plan {
    const { settings, mcp, research } = context;
    const server = `mcp_servers.${MCP_SERVER_NAME}`;
    const effort = effortOf(settings, this.efforts);
    return {
      cwd: this.workspace('run'),
      env: { BROWSENTIC_AGENT_RUN: context.runId },
      args: [
        'exec',
        ...(context.sessionId ? ['resume', context.sessionId] : []),
        '--json',
        ...SANDBOX,
        '-c',
        `${server}.command=${tomlString(mcp.command)}`,
        '-c',
        `${server}.args=${tomlArray(mcp.args)}`,
        '-c',
        `${server}.env=${tomlTable(mcp.env)}`,
        '-c',
        `${server}.required=true`,
        '-c',
        `developer_instructions=${tomlString(context.systemPrompt)}`,
        '-c',
        `tools.web_search=${research}`,
        ...(settings.model ? ['--model', settings.model] : []),
        ...(effort ? ['-c', `model_reasoning_effort=${tomlString(effort)}`] : []),
        '--',
        context.instruction,
      ],
    };
  },

  reader(): StreamReader {
    // Codex reports a message as deltas, as growing snapshots, or only once at the end — take all three
    // without saying anything twice.
    let said = '';

    const push = (text: string | undefined, sink: { text(delta: string): void }) => {
      if (!text) return;
      const delta = said && text.startsWith(said) ? text.slice(said.length) : text;
      if (!delta) return;
      said = said && text.startsWith(said) ? text : said + delta;
      sink.text(delta);
    };

    const finish = (text: string | undefined, sink: { text(delta: string): void }) => {
      push(text, sink);
      said = '';
    };

    return (line, sink) => {
      const frame = parseJsonLine<TypedEvent & LegacyEvent>(line);
      if (!frame) return;

      if (frame.msg) {
        const msg = frame.msg;
        switch (msg.type) {
          case 'session_configured':
            return msg.session_id ? sink.session(msg.session_id) : undefined;
          case 'agent_message_delta':
            return push(msg.delta, sink);
          case 'agent_message':
            return finish(msg.message, sink);
          case 'web_search_begin':
            return sink.tool(randomUUID(), WEB_TOOL);
          case 'token_count': {
            const last = msg.info?.last_token_usage ?? msg.info?.total_token_usage;
            const total = msg.info?.total_token_usage ?? last;
            if (last) {
              sink.usage({
                contextTokens: (last.input_tokens ?? 0) + (last.output_tokens ?? 0),
                outputTokens: total?.output_tokens ?? 0,
              });
            }
            return;
          }
          case 'task_complete':
            return sink.done('end_turn');
          case 'error':
            return sink.fail('AGENT_FAILED', msg.error || msg.message || 'Codex reported an error');
          default:
            return;
        }
      }

      switch (frame.type) {
        case 'thread.started':
          return frame.thread_id ? sink.session(frame.thread_id) : undefined;

        case 'item.updated': {
          const item = frame.item;
          if (kindOf(item) === 'agent_message') push(item?.text ?? item?.message, sink);
          return;
        }

        case 'item.completed': {
          const item = frame.item;
          const kind = kindOf(item);
          if (kind === 'agent_message') return finish(item?.text ?? item?.message, sink);
          if (kind === 'web_search') return sink.tool(item?.id ?? randomUUID(), WEB_TOOL);
          return;
        }

        case 'turn.completed': {
          const usage = frame.usage;
          if (usage) {
            sink.usage({
              contextTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
              outputTokens: usage.output_tokens ?? 0,
            });
          }
          return sink.done('end_turn');
        }

        case 'turn.failed':
          return sink.fail('AGENT_FAILED', frame.error?.message || 'Codex could not finish the turn');

        case 'error':
          return sink.fail('AGENT_FAILED', frame.message || frame.error?.message || 'Codex reported an error');

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
      args: [
        'exec',
        '--json',
        '--ephemeral',
        ...SANDBOX,
        '-c',
        'mcp_servers={}',
        '-c',
        'tools.web_search=false',
        ...(settings.model ? ['--model', settings.model] : []),
        ...(effort ? ['-c', `model_reasoning_effort=${tomlString(effort)}`] : []),
        '--',
        context.prompt,
      ],
    };
  },

  answer(stdout: string) {
    let text: string | undefined;
    let error: string | undefined;
    for (const line of stdout.split('\n')) {
      const frame = parseJsonLine<TypedEvent & LegacyEvent>(line.trim());
      if (!frame) continue;
      if (frame.msg?.type === 'agent_message' && frame.msg.message) text = frame.msg.message;
      if (frame.type === 'item.completed' && kindOf(frame.item) === 'agent_message') {
        text = frame.item?.text ?? frame.item?.message ?? text;
      }
      if (frame.type === 'turn.failed') error = frame.error?.message ?? error;
      if (frame.type === 'error') error = frame.message ?? error;
      if (frame.msg?.type === 'error') error = frame.msg.error ?? error;
    }
    return text ? { text } : { error };
  },

  hint(stderrTail: string) {
    if (/not inside a trusted directory/i.test(stderrTail)) {
      return `Codex refused to run in ${stateDir}. Run "codex" there once and trust the directory, then try again.`;
    }
    if (/401|unauthorized|not logged in|run `?codex login/i.test(stderrTail)) {
      return 'Codex is installed but not signed in. Run "codex login", then try again.';
    }
    if (/unexpected argument|unrecognized subcommand|invalid value/i.test(stderrTail)) {
      return `Your Codex does not understand the flags Browsentic uses. Update Codex, then try again. (${stderrTail.trim()})`;
    }
    return null;
  },
};

function kindOf(item: Item | undefined): string | undefined {
  return item?.type ?? item?.item_type;
}

const tomlString = (value: string): string => JSON.stringify(value);

const tomlArray = (values: string[]): string => `[${values.map(tomlString).join(',')}]`;

const tomlTable = (values: Record<string, string>): string =>
  `{${Object.entries(values)
    .map(([key, value]) => `${key}=${tomlString(value)}`)
    .join(',')}}`;
