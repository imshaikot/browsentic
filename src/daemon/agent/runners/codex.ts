import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stateDir } from '../../lockfile';
import { log } from '../../log';
import { isModelId } from '@/lib/agents/catalog';
import type { AgentSettings } from '../config';
import { MCP_SERVER_NAME } from './claude';
import { browserToolsDidNotStart, effortOf, MCP_CALL_TIMEOUT_MS, parseJsonLine } from './util';
import { appServerTurn } from './codex-app-server';
import type { Conversation, JsonContext, Plan, Runner, StreamContext, StreamReader, StreamSink } from './types';

/**
 * Codex has no per-run tool allowlist; the read-only sandbox is what keeps a run inside the browser.
 * Set through `-c` because `exec resume` takes neither `--sandbox` nor `--ask-for-approval`, and
 * `exec` itself dropped the latter.
 */
const SANDBOX = ['-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"', '--skip-git-repo-check'];

/**
 * A `-c` override merges into the user's config.toml rather than replacing it: `mcp_servers={}` clears
 * nothing, every server the file names still starts, and keys the user gave their own `browsentic`
 * entry — an `enabled_tools` list, a tool that asks first — land on the run's. Leaving the file out is
 * the only way to one server. Sign-in is still read from CODEX_HOME.
 */
const WITHOUT_USER_CONFIG = '--ignore-user-config';

/** The same, for the app-server, which takes no `exec` flag. */
const SANDBOX_CONFIG = ['-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"'];

/** A Codex whose app-server turned a conversation down, so later turns go straight to `exec`. */
const noConversation = new Set<string>();

/**
 * The shell and the image viewer read the machine, and a run has the page for that. A code-mode
 * model keeps its `exec` and reaches the browser tools from inside it, and the sub-agents it can
 * spawn inherit both switches. `apply_patch` has no switch; the read-only sandbox refuses its writes.
 */
const NO_SHELL = ['-c', 'features.shell_tool=false'];
const NO_IMAGE_VIEWER = ['-c', 'features.view_image=false'];

/**
 * Codex features a browsing run has no use for, each of which costs a tool or a block of
 * instructions in every turn: sub-agents, its goal memory, connector apps and plugins, the list of
 * plugins it suggests installing, the user's own skills, image generation, and its own browser and
 * computer use, which drive something other than the user's browser, outside the run's gate. A
 * feature name Codex no longer knows is ignored rather than refused, so these stay harmless as it moves on.
 */
const QUIETED = [
  '-c',
  'features.multi_agent=false',
  '-c',
  'features.goals=false',
  '-c',
  'features.tool_suggest=false',
  '-c',
  'features.apps=false',
  '-c',
  'features.plugins=false',
  '-c',
  'features.image_generation=false',
  '-c',
  'features.browser_use=false',
  '-c',
  'features.computer_use=false',
  '-c',
  'include_apps_instructions=false',
  '-c',
  'skills.include_instructions=false',
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

/** Codex gives a server ten seconds to start, which a cold start of the browser tools' own process can pass. */
const STARTUP_SECONDS = 30;

/** What every Codex run is told, however its tools reach it. */
const keepToThePage = (research: boolean) => `The page the user means is the one open in their browser. Read it with these tools. Never answer from memory${research ? '' : ', from a web search,'} or by fetching the page from the shell${research ? ', and keep a web search to background the page cannot give you' : ''}. Do the job yourself rather than spawning sub-agents: what they say never reaches the user.

When you reach the tools through \`exec\`, start every script that reads the page with the line \`// @exec: {"max_output_tokens": ${RESULT_TOKENS}}\`, or its output is cut at 10,000 tokens. Even then a tool result over ${RESULT_TOKENS} tokens comes back cut, so ask for less at a time — \`page_getPageInfo\` with a small \`maxPerKind\`, \`page_extractText\` with the cursor it hands back — rather than one large read whose middle goes missing.`;

/**
 * Codex keeps an MCP server's tools out of the model's tool list: they are deferred behind
 * `tool_search`, and a code-mode model reaches them only from inside `exec`. A run that does not
 * say so watches the model answer from memory or a web search, because those it can see.
 */
const reachingTheBrowser = (research: boolean) => `# Reaching the browser from Codex

Your browsentic tools are not in your tool list yet, because Codex defers them. Before you plan anything, call \`tool_search\` for what this job needs — query "browsentic page", limit 20 — and search again for a tool you have not loaded. If the only way you can call a tool is \`exec\`, the same tools are there as \`tools.mcp__browsentic__<name>({ ... })\`: find them by filtering \`ALL_TOOLS\`, and pass a screenshot on with \`image(result.content[0])\`, because \`text()\` alone drops the picture.

${keepToThePage(research)}`;

/**
 * Held through the app-server, the browser tools are the model's own. A code-mode model calls them
 * inside `exec`, where a result comes back as one string, a picture's data URL on its first line.
 */
const holdingTheBrowser = (research: boolean) => `# Your browser tools in Codex

Your browsentic tools — \`page_getPageInfo\`, \`page_clickElement\` and the rest — are in your tool list. If the only way you can call a tool is \`exec\`, they are there as \`tools.page_getPageInfo({ ... })\` and the like; a result that holds a picture comes back as text whose first line is a \`data:image/\` URL, and passing that line to \`image()\` is how you see it.

${keepToThePage(research)}`;

interface Item {
  id?: string;
  type?: string;
  item_type?: string;
  text?: string;
  message?: string;
  query?: string;
  command?: string;
}

/**
 * What Codex does outside the browser, which a run has switched off: seeing one means a switch
 * stopped working. A patch the sandbox refuses reports no item at all, so one that arrives was applied.
 */
const OFF_LIMITS: Record<string, string> = {
  command_execution: 'ran a shell command',
  file_change: 'changed a file',
};

const stoppedFor = (what: string) =>
  `Codex ${what} in a run Browsentic keeps to the browser, so the run was stopped. ` +
  'Update Codex and Browsentic; if it persists, please report it.';

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
  error?: { message?: string };
  message?: string;
}

interface LegacyEvent {
  msg?: {
    type?: string;
    delta?: string;
    message?: string;
    session_id?: string;
    call_id?: string;
    query?: string;
    error?: string;
    info?: { total_token_usage?: TokenCounts; last_token_usage?: TokenCounts };
  };
}

export const codexRunner: Runner = {
  kind: 'codex',
  versionArgs: ['--version'],
  efforts: ['low', 'medium', 'high', 'xhigh'],
  opens: ['text', 'image'],
  keepsFirstPrompt: true,

  workspace: () => stateDir,

  skillDirs: () => [join(codexHome(), 'skills'), join(codexHome(), 'prompts')],

  // Codex keeps the account's models in a cache it refreshes itself, so reading them spawns nothing.
  models: {
    file: () => join(codexHome(), 'models_cache.json'),
    parse: listedModels,
  },

  /**
   * Codex's app-server, unless the config says `exec` or this Codex already turned it down. It takes
   * the browser tools as its own, streams its words, and counts tokens per request; `exec` is the
   * fallback, and a thread either one began, the other resumes.
   */
  converse(context: StreamContext): Conversation | null {
    const { settings, research } = context;
    if (settings.transport === 'exec' || noConversation.has(settings.bin)) return null;
    return appServerTurn(context, {
      plan: {
        cwd: this.workspace('run'),
        args: [
          'app-server',
          ...SANDBOX_CONFIG,
          ...NO_SHELL,
          ...NO_IMAGE_VIEWER,
          ...QUIETED,
          ...searching(research),
          '-c',
          `tool_output_token_limit=${RESULT_TOKENS}`,
        ],
      },
      settings,
      effort: effortOf(settings, this.efforts),
      developerInstructions: `${context.systemPrompt.trim()}\n\n${holdingTheBrowser(research)}`,
      declined: (reason) => {
        noConversation.add(settings.bin);
        log(`codex at ${settings.bin} holds no conversation from now on: ${reason}`);
      },
      explain,
      stoppedFor,
    });
  },

  stream(context: StreamContext): Plan {
    const { mcp, research } = context;
    const settings = withUserDefaults(context.settings);
    const server = `mcp_servers.${MCP_SERVER_NAME}`;
    const effort = effortOf(settings, this.efforts);
    return {
      cwd: this.workspace('run'),
      env: { BROWSENTIC_AGENT_RUN: context.runId },
      args: [
        'exec',
        ...(context.sessionId ? ['resume', context.sessionId] : []),
        '--json',
        WITHOUT_USER_CONFIG,
        ...SANDBOX,
        ...NO_SHELL,
        ...NO_IMAGE_VIEWER,
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
        `${server}.startup_timeout_sec=${STARTUP_SECONDS}`,
        // Codex documents a one-minute default. 0.155.1 waited out a call of five and a half minutes; a later one may not.
        '-c',
        `${server}.tool_timeout_sec=${MCP_CALL_TIMEOUT_MS / 1000}`,
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

    // A search is announced when it starts and closed when it ends, under whichever id Codex gave it.
    const searches = new Set<string>();
    const openSearch = (id: string, sink: StreamSink) => {
      if (searches.has(id)) return;
      searches.add(id);
      sink.tool(id, WEB_TOOL);
    };
    const closeSearch = (id: string, sink: StreamSink) => {
      openSearch(id, sink);
      sink.toolResult(id, true);
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
            return openSearch(msg.call_id ?? randomUUID(), sink);
          case 'web_search_end':
            return msg.call_id ? closeSearch(msg.call_id, sink) : undefined;
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

        case 'item.started': {
          const item = frame.item;
          const kind = kindOf(item);
          if (kind && OFF_LIMITS[kind]) return sink.fail('AGENT_UNSAFE', stoppedFor(OFF_LIMITS[kind]));
          if (kind === 'web_search' && item?.id) return openSearch(item.id, sink);
          return;
        }

        case 'item.completed': {
          const item = frame.item;
          const kind = kindOf(item);
          if (kind && OFF_LIMITS[kind]) return sink.fail('AGENT_UNSAFE', stoppedFor(OFF_LIMITS[kind]));
          if (kind === 'agent_message') return finish(item?.text ?? item?.message, sink);
          if (kind === 'web_search') return closeSearch(item?.id ?? randomUUID(), sink);
          return;
        }

        // Its usage adds up every request of the turn, and every turn of the thread before it, so it
        // says nothing about the window the model is working in. The panel is better off without it.
        case 'turn.completed':
          return sink.done('end_turn');

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
    const { reads, image } = context;
    const settings = withUserDefaults(context.settings);
    const effort = effortOf(settings, this.efforts);
    return {
      cwd: this.workspace('task'),
      args: [
        'exec',
        '--json',
        '--ephemeral',
        WITHOUT_USER_CONFIG,
        ...SANDBOX,
        // A text file is read through the shell, inside the read-only sandbox; a picture comes attached.
        ...(reads && !image ? [] : NO_SHELL),
        ...NO_IMAGE_VIEWER,
        ...QUIETED,
        ...searching(false),
        ...(image ? ['--image', image] : []),
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
    if (/required MCP servers failed to initialize/i.test(stderrTail)) return browserToolsDidNotStart('Codex');
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

const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');

/**
 * A run leaves the user's config.toml out, so the model and effort they chose for Codex itself are
 * carried over by hand, beneath whatever was picked in Browsentic. Only top-level string keys are
 * read, which is where Codex keeps them.
 */
function withUserDefaults(settings: AgentSettings): AgentSettings {
  let content: string;
  try {
    content = readFileSync(join(codexHome(), 'config.toml'), 'utf8');
  } catch {
    return settings;
  }
  const own = topLevelStrings(content);
  const model = settings.model ?? own.model;
  return {
    ...settings,
    model: model && isModelId(model) ? model : undefined,
    effort: settings.effort ?? own.model_reasoning_effort,
  };
}

function topLevelStrings(toml: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const line of toml.split('\n')) {
    if (/^\s*\[/.test(line)) break;
    const pair = /^\s*([A-Za-z_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (pair) found[pair[1]] = pair[3] ?? parseJsonLine<string>(`"${pair[2]}"`) ?? pair[2];
  }
  return found;
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
