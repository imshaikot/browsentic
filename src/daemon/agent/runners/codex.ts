import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stateDir } from '../../lockfile';
import { MCP_SERVER_NAME } from './claude';
import { effortOf, parseJsonLine } from './util';
import type { JsonContext, Plan, Runner, StreamContext, StreamReader } from './types';

/**
 * Codex has no per-run tool allowlist; the read-only sandbox is what keeps a run inside the browser.
 * Set through `-c` because `exec resume` takes neither `--sandbox` nor `--ask-for-approval`, and
 * `exec` itself dropped the latter.
 */
const SANDBOX = ['-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"', '--skip-git-repo-check'];

/**
 * Codex features a browsing run has no use for, each of which costs a tool or a block of
 * instructions in every turn: sub-agents, its goal memory, connector apps, and the list of
 * plugins it suggests installing. A feature name Codex no longer knows is ignored rather than
 * refused, so these stay harmless as it moves on.
 */
const QUIETED = [
  '-c',
  'features.multi_agent=false',
  '-c',
  'features.goals=false',
  '-c',
  'features.tool_suggest=false',
  '-c',
  'include_apps_instructions=false',
];

const WEB_TOOL = 'web_search';

/**
 * Codex 0.155 dropped `tools.web_search` for a top-level mode and ignores a key it does not know
 * without saying so, which left web search switched on for every run — the one tool a model whose
 * browser tools are deferred can still see, and so the one it reached for.
 */
const searching = (research: boolean): string[] => ['-c', `web_search=${tomlString(research ? 'live' : 'disabled')}`];

/**
 * Codex cuts a tool result at 10,000 tokens, which a dense page snapshot passes. This raises it to
 * the 25,000 Claude Code allows an MCP result. A code-mode model's `exec` keeps its own 10,000
 * unless the script's first line asks for more, which only the prompt can tell it to do.
 */
const RESULT_TOKENS = 25_000;

/**
 * Codex keeps an MCP server's tools out of the model's tool list: they are deferred behind
 * `tool_search`, and a code-mode model reaches them only from inside `exec`. A run that does not
 * say so watches the model answer from memory or a web search, because those it can see.
 */
const reachingTheBrowser = (research: boolean) => `# Reaching the browser from Codex

Your browsentic tools are not in your tool list yet, because Codex defers them. Before you plan anything, call \`tool_search\` for what this job needs — query "browsentic page", limit 20 — and search again for a tool you have not loaded. If the only way you can call a tool is \`exec\`, the same tools are there as \`tools.mcp__browsentic__<name>({ ... })\`: find them by filtering \`ALL_TOOLS\`, and pass a screenshot on with \`image(result.content[0])\`, because \`text()\` alone drops the picture.

The page the user means is the one open in their browser. Read it with these tools. Never answer from memory${research ? '' : ', from a web search,'} or by fetching the page from the shell${research ? ', and keep a web search to background the page cannot give you' : ''}.

When you reach the tools through \`exec\`, start every script that reads the page with the line \`// @exec: {"max_output_tokens": ${RESULT_TOKENS}}\`, or its output is cut at 10,000 tokens. Even then a tool result over ${RESULT_TOKENS} tokens comes back cut, so ask for less at a time — \`page_getPageInfo\` with a small \`maxPerKind\`, \`page_extractText\` with the cursor it hands back — rather than one large read whose middle goes missing.`;

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
  efforts: ['low', 'medium', 'high', 'xhigh'],

  workspace: () => stateDir,

  skillDirs: () => [join(homedir(), '.codex', 'skills'), join(homedir(), '.codex', 'prompts')],

  // Codex keeps the account's models in a cache it refreshes itself, so reading them spawns nothing.
  models: {
    file: () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'models_cache.json'),
    parse: listedModels,
  },

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
        ...QUIETED,
        '-c',
        `${server}.command=${tomlString(mcp.command)}`,
        '-c',
        `${server}.args=${tomlArray(mcp.args)}`,
        '-c',
        `${server}.env=${tomlTable(mcp.env)}`,
        '-c',
        `${server}.required=true`,
        // Headless Codex refuses an MCP call it would have asked about; the daemon gates these tools itself.
        '-c',
        `${server}.default_tools_approval_mode="approve"`,
        '-c',
        `developer_instructions=${tomlString(`${context.systemPrompt.trim()}\n\n${reachingTheBrowser(research)}`)}`,
        ...searching(research),
        '-c',
        `tool_output_token_limit=${RESULT_TOKENS}`,
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
            return sink.fail('AGENT_FAILED', explain(msg.error || msg.message) || 'Codex reported an error');
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
          return sink.fail('AGENT_FAILED', explain(frame.error?.message) || 'Codex could not finish the turn');

        case 'error':
          return sink.fail('AGENT_FAILED', explain(frame.message || frame.error?.message) || 'Codex reported an error');

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
        ...QUIETED,
        '-c',
        'mcp_servers={}',
        ...searching(false),
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

/** The API's error arrives as a JSON document inside the message; say the sentence, and what to do about a refused model. */
function explain(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const message = parseJsonLine<{ error?: { message?: string } }>(raw)?.error?.message ?? raw;
  return /model .*(not supported|does not exist|not found)/i.test(message)
    ? `${message} Pick another model for Codex in the Browsentic popup, then try again.`
    : message;
}

function kindOf(item: Item | undefined): string | undefined {
  return item?.type ?? item?.item_type;
}

const tomlString = (value: string): string => JSON.stringify(value);

const tomlArray = (values: string[]): string => `[${values.map(tomlString).join(',')}]`;

const tomlTable = (values: Record<string, string>): string =>
  `{${Object.entries(values)
    .map(([key, value]) => `${key}=${tomlString(value)}`)
    .join(',')}}`;

interface CachedModel {
  slug?: unknown;
  visibility?: unknown;
  priority?: unknown;
}

/** The models Codex's own picker offers, in its order. Hidden ones are Codex's internal helpers. */
function listedModels(content: string): string[] | null {
  const models = parseJsonLine<{ models?: CachedModel[] }>(content)?.models;
  if (!Array.isArray(models)) return null;
  return models
    .filter((model) => model.visibility === 'list' && typeof model.slug === 'string')
    .sort((a, b) => rank(a) - rank(b))
    .map((model) => model.slug as string);
}

const rank = (model: CachedModel) => (typeof model.priority === 'number' ? model.priority : Number.MAX_SAFE_INTEGER);
