import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import type { AgentProblem } from '@/lib/agents/catalog';
import { stateDir } from '../../lockfile';
import type { AgentSettings } from '../config';
import { MCP_SERVER_NAME } from './claude';
import { spawnCli, stopTree, type CliProcess } from './command';
import { childEnv } from './drive';
import { acpTurn, type TurnModel } from './opencode-acp';
import { conversationDir, effortOf, MCP_CALL_TIMEOUT_MS, parseJsonLine, sweepRunDirs } from './util';
import type { CommandLister, JsonContext, McpServer, Plan, Runner, RunMode, StreamContext, StreamReader, StreamSink } from './types';

/**
 * The whole config travels in OPENCODE_CONFIG_CONTENT, and its containment is one rule: the agent
 * it defines opens on `"*": "deny"`. OpenCode applies the last matching rule and puts an agent's
 * rules after the user's, so every tool not named after it — built-in, custom, another MCP
 * server's — is denied, and a tool denied outright is never offered to the model.
 *
 * OpenCode expands `{env:…}` and `{file:…}` anywhere in that JSON, so page text never goes in it:
 * the system prompt is a file the config points at, and instruction files are read verbatim.
 *
 * `opencode run` waits for stdin to close and appends it to the message; drive.ts spawns it ignored.
 *
 * OpenCode 2 is a second line of releases (`@opencode/cli`, beside 1's `opencode-ai`) with its own
 * flags, config, database and protocol; which one a plan is for comes from the `--version` probed.
 */

/**
 * OpenCode deep-merges an agent the user defined under the same name, keeping the user's key
 * order, so their `{"*": "allow", "bash": "allow"}` would sit after this deny and win. Measured.
 */
const AGENT = 'browsentic-contained';

const INSTRUCTIONS = 'instructions.md';

const WEB_TOOLS = ['webfetch', 'websearch'];

/** Claude Code's 25,000-token MCP ceiling. OpenCode's own 50 KB cut points the model at a saved copy it has no tool to open. */
const RESULT_BYTES = 100_000;

const TRUNCATION = `A tool result over ${RESULT_BYTES / 1000} KB comes back cut, and the saved copy OpenCode points to cannot be opened in this run, so ask for less at a time — \`page_getPageInfo\` with a small \`maxPerKind\`, \`page_extractText\` with the cursor it hands back.`;

/** A user's `share: auto` would publish every browsing session; project config would load from folders above the workspace. */
const SEALED = { OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_DISABLE_SHARE: '1' };

/** OpenCode 2 renamed the project switch, reading the old name only when the new one is unset, and dropped the share one. */
const SEALED_2 = {
  OPENCODE_CONFIG_PROJECT_DISABLE: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
};

/** Every folder outside git is one project to OpenCode, so runs kept in its own store would fill the user's session list. */
const sessionsDb = () => join(stateDir, 'agents', 'opencode', 'sessions.db');

/**
 * OpenCode 2 keeps its logins in the same database as its sessions, and migrates one 1 cannot open
 * again. Runs keep their own, so the user's background service never sees one, and it holds the
 * sign-in the user gave Browsentic.
 */
const database2 = () => join(stateDir, 'agents', 'opencode', 'opencode-2.db');

const configHome = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');

const INSTALL = 'npm i -g opencode-ai';

/** OpenCode Zen's provider id, whose free models serve only requests carrying OpenCode's own tools. */
const ZEN = 'opencode';

const NARROWED = 'a run whose tools Browsentic has narrowed to the browser';

/** `opencode v2.0.32` from 2.x, a bare `1.19.3` from 1.x. */
export const isOpenCode2 = (version?: string): boolean => Number(/^(?:opencode\s+)?v?(\d+)\./i.exec(version?.trim() ?? '')?.[1] ?? 0) >= 2;

/** Bins whose OpenCode would not hold a conversation, whose turns go through `opencode run` until the daemon restarts. */
const noConversation = new Set<string>();

type Permission = Record<string, string | Record<string, string>>;

interface Rule {
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
}

const rule = (action: string, effect: Rule['effect'] = 'allow', resource = '*'): Rule => ({ action, resource, effect });

/**
 * Plugins run inside OpenCode, and another MCP server of the user's would start beside the run's own.
 * A policy in the user's global or managed config outranks these, which the containment note says.
 */
const POLICIES = [
  { action: 'integration.use', resource: 'plugin:*', effect: 'deny' },
  { action: 'integration.use', resource: 'mcp:*', effect: 'deny' },
  { action: 'integration.use', resource: `mcp:${MCP_SERVER_NAME}`, effect: 'allow' },
];

interface Part {
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  id?: string;
  messageID?: string;
  state?: { status?: string };
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
}

/** 1.x names an error and nests what the provider said; 2.x types it, `provider.auth` and the like. */
interface Failure {
  name?: string;
  type?: string;
  message?: string;
  status?: number;
  response?: { body?: string };
  data?: { message?: string; statusCode?: number; responseBody?: string };
}

interface Event {
  type?: string;
  sessionID?: string;
  part?: Part;
  error?: Failure;
}

export const opencodeRunner: Runner = {
  kind: 'opencode',
  versionArgs: ['--version'],
  // Passed as --variant, whose names each model defines; a model ignores one it lacks.
  efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  endsOnExit: true,
  delivery: () => 'on-demand',

  workspace: (mode: RunMode) => join(stateDir, 'agents', 'opencode', mode),

  skillDirs: () => [
    join(configHome(), 'skills'),
    join(configHome(), 'skill'),
    join(homedir(), '.opencode', 'skills'),
    join(homedir(), '.agents', 'skills'),
    join(homedir(), '.claude', 'skills'),
  ],

  models: (version) => (isOpenCode2(version) ? models2 : undefined),

  stream(context: StreamContext): Plan {
    if (isOpenCode2(context.version)) return standalone(context);
    const { settings, research } = context;
    const base = this.workspace('run');
    sweepRunDirs(base);
    const cwd = conversationDir(base, context.conversation ?? context.runId);
    const allowed = [...context.mcpTools.map((tool) => `${MCP_SERVER_NAME}_${tool}`), ...(research ? WEB_TOOLS : [])];
    const effort = effortOf(settings, this.efforts);

    return {
      cwd,
      env: {
        ...SEALED,
        OPENCODE_DB: sessionsDb(),
        OPENCODE_CONFIG_CONTENT: config({
          mcp: { [MCP_SERVER_NAME]: server(context.mcp) },
          instructions: [join(cwd, INSTRUCTIONS)],
          permission: { '*': 'deny', ...Object.fromEntries(allowed.map((tool) => [tool, 'allow'])) },
        }),
        BROWSENTIC_AGENT_RUN: context.runId,
      },
      files: [{ path: INSTRUCTIONS, content: `${context.systemPrompt.trim()}\n\n${TRUNCATION}\n` }],
      args: [
        ...invocation(),
        ...(context.sessionId ? ['--session', context.sessionId] : []),
        ...(settings.model ? ['--model', settings.model] : []),
        ...(effort ? ['--variant', effort] : []),
        '--',
        context.instruction,
      ],
    };
  },

  /**
   * OpenCode 2's `run` sends its first request before the run's MCP server has connected, and that
   * step's tool list is fixed when it is sent, so the turn is held over ACP until the tools are there.
   */
  converse(context: StreamContext) {
    const { bin } = context.settings;
    if (!isOpenCode2(context.version) || noConversation.has(bin)) return null;
    return acpTurn(context, {
      plan: { ...turn2(context), args: ['acp'] },
      agent: AGENT,
      declined: () => noConversation.add(bin),
      explain: (message, model) => explain({ message }, bin, model),
      stoppedFor: (tool) => stoppedFor(tool),
    });
  },

  reader(): StreamReader {
    let spoke = false;
    let generated = 0;
    const continues = continuation();

    const report = (tokens: NonNullable<Part['tokens']>, sink: StreamSink) => {
      const made = (tokens.output ?? 0) + (tokens.reasoning ?? 0);
      const prompt = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0);
      generated += made;
      sink.usage({ contextTokens: prompt + made, outputTokens: generated });
    };

    return (line, sink) => {
      const event = parseJsonLine<Event>(line);
      if (!event) return;
      if (event.sessionID) sink.session(event.sessionID);
      const part = event.part;

      switch (event.type) {
        case 'text': {
          if (!part?.text) return;
          const goesOn = continues(part);
          sink.text(spoke && !goesOn ? `\n\n${part.text}` : part.text);
          spoke = true;
          return;
        }

        case 'tool_use': {
          const name = part?.tool;
          if (!name || ownTool(name)) return;
          if (WEB_TOOLS.includes(name)) return sink.tool(part.callID ?? part.id ?? randomUUID(), name);
          // A refused call is the model reaching for a tool it was never offered; one that ran means the ruleset did not hold.
          if (part.state?.status !== 'completed') return;
          return sink.fail('AGENT_UNSAFE', stoppedFor(name));
        }

        case 'step_finish':
          if (part?.tokens) report(part.tokens, sink);
          return;

        case 'error':
          return sink.fail('AGENT_FAILED', explain(event.error));
      }
    };
  },

  json(context: JsonContext): Plan {
    const { settings, reads } = context;
    const cwd = this.workspace('task');
    if (isOpenCode2(context.version)) {
      return {
        cwd,
        env: {
          ...SEALED_2,
          PWD: cwd,
          OPENCODE_DB: database2(),
          // A path inside the folder a run starts in is matched as seen from it, and anything outside is an external directory the deny covers.
          OPENCODE_CONFIG_CONTENT: config2({ servers: {}, allowed: reads ? [rule('read', 'allow', 'tmp/*')] : [] }),
        },
        args: [...invocation2(), ...(settings.model ? ['--model', settings.model] : [])],
        input: context.prompt,
      };
    }
    const permission: Permission = { '*': 'deny', ...(reads ? { read: scratchReads(cwd) } : {}) };
    return {
      cwd,
      env: {
        ...SEALED,
        OPENCODE_DB: sessionsDb(),
        // Merged over the user's servers rather than replacing them: it adds none, and the ruleset hides theirs.
        OPENCODE_CONFIG_CONTENT: config({ mcp: {}, permission }),
      },
      args: [...invocation(), ...(settings.model ? ['--model', settings.model] : []), '--', context.prompt],
    };
  },

  answer(stdout: string) {
    let said: string[] = [];
    const continues = continuation();
    for (const line of stdout.split('\n')) {
      const event = parseJsonLine<Event>(line);
      if (event?.type === 'error') return { error: explain(event.error) };
      if (event?.type === 'step_start') said = [];
      if (event?.type === 'text' && event.part?.text) {
        if (continues(event.part) && said.length) said[said.length - 1] += event.part.text;
        else said.push(event.part.text);
      }
    }
    return { text: said.length ? said.join('\n\n') : undefined };
  },

  hint(stderrTail: string) {
    if (/Unknown arguments?|Not enough arguments|Invalid values/i.test(stderrTail)) {
      return `Your OpenCode does not understand the flags Browsentic uses. Update it (${INSTALL}), then try again. (${stderrTail.trim()})`;
    }
    // Each release line refuses the other's flags, which happens when OpenCode is swapped while Browsentic is running.
    if (/Unrecognized flag/i.test(stderrTail) || /V2 permissions are not supported/i.test(stderrTail)) {
      return `OpenCode changed version since Browsentic last checked it. Send the message again. (${oneLine(stderrTail)})`;
    }
    return null;
  },

  async check(settings: AgentSettings, version?: string): Promise<AgentProblem | null> {
    if (isOpenCode2(version)) return check2(settings);
    if (process.env.OPENCODE_API_KEY || process.env.OPENCODE_AUTH_CONTENT || signedIn() || declaresProvider()) return null;
    return {
      code: 'AGENT_NEEDS_PERMISSION',
      message:
        'OpenCode is signed in to no model provider, and its free OpenCode Zen models refuse a run whose tools Browsentic has narrowed to the browser.',
      fix: 'opencode auth login',
    };
  },
};

const invocation = () => ['run', '--format', 'json', '--pure', '--agent', AGENT];

/** No message on argv: 2.x quotes any word with a space in it, and appends what follows `--` a second time. */
const invocation2 = () => ['run', '--standalone', '--format', 'json', '--agent', AGENT];

const ownTool = (name: string) => name.startsWith(`${MCP_SERVER_NAME}_`);

/**
 * Whether a text part goes on with one already said. 2.x ends a turn by sending whatever of a text
 * block it had not yet printed, under that block's number in its message — `prt_<message>_text-<n>` —
 * and a block printed in part before goes on where it stopped. 1.x's parts never carry the number.
 */
function continuation(): (part: Part) => boolean {
  const blocks = new Map<string, number>();
  return (part) => {
    const message = part.messageID ?? '';
    const shown = blocks.get(message) ?? 0;
    const numbered = /_text-(\d+)$/.exec(part.id ?? '');
    if (numbered && Number(numbered[1]) < shown) return true;
    blocks.set(message, numbered ? Number(numbered[1]) + 1 : shown + 1);
    return false;
  };
}

const stoppedFor = (tool: string) =>
  `OpenCode ran its own ${tool} tool in this run, which Browsentic denied, so the run was stopped. ` +
  'Update OpenCode and Browsentic; if it persists, please report it.';

const server = (mcp: McpServer) => ({
  type: 'local',
  command: [mcp.command, ...mcp.args],
  environment: mcp.env,
  enabled: true,
  timeout: MCP_CALL_TIMEOUT_MS,
});

/** Code Mode would hide the tools behind an `execute` tool the ruleset denies, and that tool is a script with the network. */
const server2 = (mcp: McpServer) => ({
  type: 'local',
  command: [mcp.command, ...mcp.args],
  environment: mcp.env,
  codemode: false,
  timeout: { execution: MCP_CALL_TIMEOUT_MS },
});

/** Title generation is a model call per new session that the panel already makes for itself. */
function config({ mcp, instructions, permission }: { mcp: Record<string, unknown>; instructions?: string[]; permission: Permission }): string {
  return JSON.stringify({
    share: 'disabled',
    autoupdate: false,
    snapshot: false,
    tool_output: { max_bytes: RESULT_BYTES, max_lines: RESULT_BYTES },
    mcp,
    ...(instructions ? { instructions } : {}),
    agent: { title: { disable: true }, [AGENT]: { mode: 'primary', permission } },
  });
}

/** 2.x's own shape: the rules are a list where the last match wins, and an ACP session starts in `default_agent`. */
function config2({ servers, instructions, allowed }: { servers: Record<string, unknown>; instructions?: string[]; allowed: Rule[] }): string {
  return JSON.stringify({
    share: 'disabled',
    update: 'disable',
    snapshots: false,
    tool_output: { max_bytes: RESULT_BYTES, max_lines: RESULT_BYTES },
    ...(instructions ? { instructions } : {}),
    default_agent: AGENT,
    mcp: { servers },
    policies: POLICIES,
    agents: { title: { disabled: true }, [AGENT]: { mode: 'primary', permissions: [rule('*', 'deny'), ...allowed] } },
  });
}

/** What a 2.x turn starts from, however it is then spoken to. 2.x moves to `$PWD` before its own working directory. */
function turn2(context: StreamContext): Omit<Plan, 'args'> {
  const base = opencodeRunner.workspace('run');
  sweepRunDirs(base);
  const cwd = conversationDir(base, context.conversation ?? context.runId);
  const allowed = [...context.mcpTools.map((tool) => `${MCP_SERVER_NAME}_${tool}`), ...(context.research ? WEB_TOOLS : [])];
  return {
    cwd,
    env: {
      ...SEALED_2,
      PWD: cwd,
      OPENCODE_DB: database2(),
      OPENCODE_CONFIG_CONTENT: config2({
        servers: { [MCP_SERVER_NAME]: server2(context.mcp) },
        instructions: [join(cwd, INSTRUCTIONS)],
        allowed: allowed.map((action) => rule(action)),
      }),
      BROWSENTIC_AGENT_RUN: context.runId,
    },
    files: [{ path: INSTRUCTIONS, content: `${context.systemPrompt.trim()}\n\n${TRUNCATION}\n` }],
  };
}

/**
 * A 2.x turn through `opencode run`, for an OpenCode that would not hold a conversation. Its first step
 * may not see the browser tools yet. No effort: 2.x refuses the run when the model lacks that variant.
 */
function standalone(context: StreamContext): Plan {
  return {
    ...turn2(context),
    args: [
      ...invocation2(),
      ...(context.sessionId ? ['--session', context.sessionId] : []),
      ...(context.settings.model ? ['--model', context.settings.model] : []),
    ],
    input: context.instruction,
  };
}

/**
 * OpenCode matches a read against its path relative to the project root — `/` outside git, the
 * repository when the home directory is one — so the scratch folder is allowed as seen from every
 * ancestor. Never from the workspace itself: `tmp/*` under a root of `/` is the machine's /tmp.
 */
function scratchReads(workspace: string): Record<string, string> {
  const scratch = join(workspace, 'tmp');
  const rules: Record<string, string> = { '*': 'deny' };
  for (let root = dirname(workspace); ; root = dirname(root)) {
    const seen = relative(root, scratch);
    rules[`${seen.replaceAll(sep, '/')}/*`] = 'allow';
    // Windows spells it with backslashes. Which spelling OpenCode matches there is unmeasured, and each names only the scratch folder.
    if (sep !== '/') rules[`${seen}${sep}*`] = 'allow';
    if (root === dirname(root)) return rules;
  }
}

/**
 * The command that signs Browsentic's own OpenCode 2 database in, in the user's shell. PowerShell has
 * no variable for one command, so its line puts back what the window had: the user's own `opencode`
 * there would otherwise open this database, and start their background service on it.
 */
export function signInLine(bin: string, platform: NodeJS.Platform = process.platform): string {
  const db = database2();
  if (platform === 'win32') {
    const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
    return `$before=$env:OPENCODE_DB; $env:OPENCODE_DB=${literal(db)}; try { & ${literal(bin)} auth login --standalone } finally { $env:OPENCODE_DB=$before }`;
  }
  const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
  return `OPENCODE_DB=${quote(db)} ${/^[\w./-]+$/.test(bin) ? bin : quote(bin)} auth login --standalone`;
}

function explain(failure: Failure | undefined, bin = 'opencode', model?: TurnModel): string {
  const message = oneLine(failure?.data?.message ?? failure?.message ?? failure?.name ?? failure?.type ?? 'OpenCode reported an error');
  const status = failure?.data?.statusCode ?? failure?.status;
  const body = failure?.data?.responseBody ?? failure?.response?.body ?? '';
  // 1.x names its errors and nests what the provider said; 2.x types them, and over ACP passes on only a message.
  const v1 = failure?.name !== undefined || failure?.data !== undefined;
  // Zen serves its free models only to requests carrying OpenCode's own built-in tools.
  if (v1 && body.includes('FreeTierError')) {
    return (
      `OpenCode Zen's free models refuse a run whose tools Browsentic has narrowed to the browser. Run "opencode auth login" ` +
      `to sign in to a provider, then pick one of its models in the Browsentic side panel. (${message})`
    );
  }
  if (!v1 && body.includes('FreeTierError')) {
    return (
      `OpenCode Zen's free models refuse ${NARROWED}. Pick a paid model in the side panel, which Zen bills to your OpenCode account, ` +
      `or sign Browsentic's OpenCode in to another provider with ${signInLine(bin)}. (${message})`
    );
  }
  // Over ACP, 2.x says only this, for a provider with no sign-in and for Zen's free tier alike.
  if (!v1 && /authentication required/i.test(message)) return `${refused(model, bin)} (${message})`;
  if (failure?.name === 'ProviderAuthError' || failure?.type === 'provider.auth' || status === 401 || status === 403) {
    if (!v1) return `${message} If that is a login problem, sign Browsentic's OpenCode in with ${signInLine(bin)}.`;
    return (
      `${message} If that is a login problem, run "opencode auth login" — a key kept only in an environment ` +
      'variable is not passed to a Browsentic run.'
    );
  }
  if (status === 429 || failure?.type === 'provider.rate-limit') return `The provider behind OpenCode is rate-limiting this account. Wait and try again. (${message})`;
  if (failure?.type === 'provider.quota') return `The provider behind OpenCode says this account is out of credit or quota. Top it up, or pick another provider's model. (${message})`;
  if (/variant unavailable/i.test(message)) {
    return `The model OpenCode is using has no such level of effort. Clear the effort in Browsentic's settings, or pick another, then try again. (${message})`;
  }
  if (failure?.name === 'UnknownError' || /model unavailable|invalid model reference/i.test(message)) {
    return (
      `OpenCode could not start this turn, most often because it does not know the model. Pick one in the ` +
      `Browsentic side panel as "opencode models" lists it — provider/model — then try again. (${message})`
    );
  }
  return message;
}

/** What a refused 2.x turn needs, told from the provider of the model it ran on. */
function refused(model: TurnModel | undefined, bin: string): string {
  const line = signInLine(bin);
  if (!model) {
    return (
      `OpenCode Zen's free models refuse ${NARROWED}, and any other model needs a sign-in Browsentic's OpenCode holds. ` +
      `Pick a paid model in the side panel, or sign Browsentic's OpenCode in to a provider with ${line}.`
    );
  }
  const chosen = model.picked ? model.id : `${model.id}, which OpenCode chose because no model is picked in Browsentic`;
  const provider = model.id.split('/')[0];
  if (provider === ZEN) {
    return (
      `OpenCode Zen refused ${chosen}. Zen's free models refuse ${NARROWED}, and its paid ones need credit on your OpenCode account. ` +
      `Pick a paid model in the side panel, or sign Browsentic's OpenCode in to another provider with ${line}.`
    );
  }
  return `Browsentic's OpenCode has no working sign-in for ${provider}, so it could not run ${chosen}. Sign it in with ${line}, or pick another model in the side panel.`;
}

const oneLine = (message: string) => message.replace(/\s+/g, ' ').trim().slice(0, 240);

const dataHome = () => join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode');

/** A login `opencode auth login` saved. Unreadable counts as signed in; the run's own error catches the rest. */
function signedIn(): boolean {
  try {
    return Object.keys(JSON.parse(readFileSync(join(dataHome(), 'auth.json'), 'utf8')) as object).length > 0;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

/** A provider the user configured by hand — a local model needs no login. */
function declaresProvider(pattern = /"provider"\s*:/): boolean {
  return ['opencode.json', 'opencode.jsonc', 'config.json'].some((name) => {
    try {
      return pattern.test(readFileSync(join(configHome(), name), 'utf8'));
    } catch {
      return false;
    }
  });
}

const AUTH_TIMEOUT_MS = 5_000;

/** One answer per state of the database, and one question at a time. */
let lastAnswer: { key: string; problem: AgentProblem | null; signIns?: string } | undefined;
let asking: Promise<AgentProblem | null> | undefined;

/**
 * OpenCode 2's sign-ins live in its database, so its own `auth list` is asked, against Browsentic's
 * database and in the environment a run gets: an exported key shows there exactly when a run sees it.
 * `--standalone` keeps the user's background service out of it — without it that service would be
 * started with this environment and run on Browsentic's database. Anything unexpected reads as signed
 * in, because a picker that wrongly says *needs setup* blocks a working agent.
 */
async function check2(settings: AgentSettings): Promise<AgentProblem | null> {
  if (process.env.OPENCODE_API_KEY || declaresProvider(/"providers?"\s*:/)) return null;
  const db = database2();
  // The sign-in line points OpenCode at this file, and its server will not start in a folder that is not there.
  mkdirSync(dirname(db), { recursive: true });
  const stamped = stamp(db);
  if (!stamped) return needsSignIn(settings.bin);
  const key = `${settings.bin}|${stamped}|${stamp(`${db}-wal`)}`;
  if (lastAnswer?.key === key) return lastAnswer.problem;
  asking ??= listSignIns(settings.bin)
    .then((integrations) => {
      const problem = connected(integrations) ? null : needsSignIn(settings.bin);
      lastAnswer = { key, problem, signIns: integrations ? signInsOf(integrations) : undefined };
      return problem;
    })
    .finally(() => (asking = undefined));
  return asking;
}

const stamp = (path: string) => {
  try {
    const { mtimeMs, size } = statSync(path);
    return `${mtimeMs}:${size}`;
  } catch {
    return '';
  }
};

const needsSignIn = (bin: string): AgentProblem => ({
  code: 'AGENT_NEEDS_PERMISSION',
  message:
    "This OpenCode 2 has no sign-in of its own for Browsentic, which keeps one apart from yours. Sign it in to a model provider, or to OpenCode Zen and then pick a paid model: Zen's free models refuse a run whose tools Browsentic has narrowed to the browser.",
  fix: signInLine(bin),
});

interface Integration {
  id?: string;
  connections?: { id?: string; type?: string; status?: { status?: string } }[];
}

const connected = (integrations: Integration[] | null) =>
  !integrations || integrations.some(({ connections }) => connections?.some(({ status }) => !status || status.status === 'connected'));

/** The sign-ins as they stand, which a run writing its sessions to the same database leaves alone. */
const signInsOf = (integrations: Integration[]) =>
  createHash('sha256')
    .update(JSON.stringify(integrations.map(({ id, connections }) => [id, connections?.map(({ id: credential, type, status }) => [credential ?? type, status?.status])])))
    .digest('hex')
    .slice(0, 16);

/** How Browsentic's own OpenCode 2 is asked something: on its database, with the user's plugins and other MCP servers kept out. */
const asked2 = (cwd: string) => ({
  ...SEALED_2,
  PWD: cwd,
  OPENCODE_DB: database2(),
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ policies: POLICIES }),
});

function listSignIns(bin: string): Promise<Integration[] | null> {
  const cwd = opencodeRunner.workspace('task');
  mkdirSync(cwd, { recursive: true });
  let child: CliProcess;
  try {
    child = spawnCli(bin, ['auth', 'list', '--standalone', '--format', 'json'], { cwd, env: { ...childEnv('opencode'), ...asked2(cwd) } });
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const done = (value: Integration[] | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      stopTree(child, 'SIGKILL');
      done(null);
    }, AUTH_TIMEOUT_MS);
    timer.unref();
    child.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    child.stderr.on('data', () => {});
    child.on('error', () => done(null));
    child.on('close', (code) => {
      const integrations = code === 0 ? parseJsonLine<Integration[]>(output.trim()) : null;
      done(Array.isArray(integrations) ? integrations : null);
    });
  });
}

interface ListedModel {
  providerID?: string;
  id?: string;
  enabled?: boolean;
  capabilities?: { tools?: boolean };
  cost?: { input?: number; output?: number }[];
}

interface Listed {
  data?: ListedModel[];
}

/** Zen bills nothing for its free models, and serves them only to OpenCode's own tools. */
const zenFree = ({ providerID, cost = [] }: ListedModel) => providerID === ZEN && cost.length > 0 && cost.every(({ input, output }) => !input && !output);

function runnable(listed: Listed | null): string[] | null {
  const models = listed?.data;
  if (!Array.isArray(models)) return null;
  const ids = models
    .filter((model) => model.providerID && model.id && model.enabled !== false && model.capabilities?.tools !== false && !zenFree(model))
    .map(({ providerID, id }) => `${providerID}/${id}`)
    .sort();
  return ids.length ? ids : null;
}

/**
 * The models Browsentic's own OpenCode 2 can run a turn on, as its server lists them for the sign-ins
 * that database holds: none that cannot call a tool, and none of Zen's free ones. The list is read
 * again when a sign-in changes.
 */
const models2: CommandLister = {
  args: ['api', '--standalone', 'model.list'],
  env: asked2,
  stamp: () => lastAnswer?.signIns,
  parse: ({ stdout, code }) => (code === 0 ? runnable(parseJsonLine<Listed>(stdout.trim())) : null),
};
