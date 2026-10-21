import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentProblem } from '@/lib/agents/catalog';
import { stateDir } from '../../lockfile';
import type { AgentSettings } from '../config';
import { acpConversation, type ConfigOption, type ModelEntry, type Update } from './acp';
import { MCP_SERVER_NAME } from './claude';
import { spawnCli, stopTree, type CliProcess } from './command';
import { childEnv } from './drive';
import { conversationDir, effortOf, parseJsonLine, sweepRunDirs } from './util';
import type { JsonContext, McpServer, Plan, Runner, RunMode, StreamContext, StreamReader, StreamSink } from './types';

/**
 * DeepSeek Harness is a tree of plugins, each a row of a profile, and containment is a patch over
 * that tree: every row that gives the model a tool of its own is switched off, so the shell, the
 * disk, the web, sub-agents and scripted workflows are never offered at all. The patch is written
 * as JSON, which a YAML loader reads as it is and which can carry no `!!js` expression.
 *
 * Runs keep a dsh home of their own, so nothing of the user's composes into one — their home patch,
 * their profiles' plugins, their AGENTS.md and skills — and borrow only the sign-in, by pointing
 * the credentials row at the file `dsh web` keeps it in.
 *
 * A streamed turn is held over ACP (`--profile acp`), which takes the browser's MCP server with the
 * session. One-shots, and a turn ACP would not hold, run once through `--profile headless --json`.
 */

/** Rows that hand the model a tool, or run work of its own beside the turn. A row a profile lacks fails the whole patch. */
const SWITCHED_OFF = [
  'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search',
  'tool-skill', 'skill', 'skill-filesystem',
  'tool-subagent', 'tool-subagent-fork', 'tool-subagent-control', 'tool-subagent-list-agents',
  'tool-workflow', 'workflow-ptc', 'ptc-runtime',
  'tool-goal', 'goal', 'goal-round-driver', 'command-goal', 'tool-working-directory',
  'plan-mode', 'mcp-resources', 'user-questions', 'commands', 'command-feedback', 'command-compact',
  'otel', 'session-telemetry-otel',
];

/** The web tools, offered on a research run alone. */
const WEB = 'tool-web';
const WEB_TOOLS = ['web_fetch', 'web_search'];

/** A run's to-do list stays inside the turn. */
const TODO = 'tool-todo';

const PATCH = 'browsentic.patch.yml';
const TASK_PATCH = 'task.patch.yml';
const INSTRUCTIONS = 'AGENTS.md';

/** dsh calls itself a coding agent unless told otherwise. `{{model}}` is its own placeholder. */
const PERSONA = "You are Browsentic's browser agent, powered by the {{model}} model.";

/** Claude Code's 25,000-token MCP ceiling. dsh cuts a result at 12,500 into a file the run has no tool to read. */
const RESULT_TOKENS = 25_000;

/** Browsentic's prompt runs well past dsh's 64 KiB budget for workspace instructions. */
const INSTRUCTION_BYTES = 256 * 1024;

/** An MCP call dsh makes is abandoned at the SDK's 60 s, and the server is told it was cancelled. Measured on 0.2.1-rc.2. */
const LIMITS = { callMs: 60_000 };

const INSTALL = 'npm i -g @deepseek-ai/dsh';
const SIGN_IN = 'dsh web';
const PROVIDERS = { account: 'deepseek-account', key: 'deepseek-official' } as const;
const DEFAULT_MODEL = 'deepseek-flash';

/** Headless switches the sign-in off altogether, so every patch switches these rows back on. */
const SIGN_IN_ROWS = ['authorization', 'deepseek-account'];

/** A one-shot the file analyst runs may read a file, and change nothing. */
const READ_ONLY = { read: true, readImage: false, write: false, edit: false };

const root = () => join(stateDir, 'agents', 'deepseek');
const runHome = () => join(root(), 'home');
const taskHome = () => join(root(), 'task-home');
/** Kept empty: dsh reads AGENTS.md and skills from it. */
const agentsHome = () => join(root(), 'agents-home');

/** Where the user's own dsh keeps the sign-in `dsh web` wrote. */
const userHome = () => process.env.DSH_HOME || join(homedir(), '.dsh');
const credentials = () => join(userHome(), '.credentials.yaml');

/** Bins whose dsh would not hold a conversation, whose turns run headless until the daemon restarts. */
const noConversation = new Set<string>();

type Row = { id: string; disabled?: boolean; config?: Record<string, unknown> } | { insert: { id: string; name: string; config: Record<string, unknown> }[] };

interface Route {
  provider: string;
  model: string;
  effort?: string;
}

interface HeadlessEvent {
  type?: string;
  sessionId?: string;
  phase?: string;
  text?: string;
  message?: string;
  callId?: string;
  tool?: string;
  status?: string;
  result?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  reason?: { kind?: string; error?: { message?: string; code?: string } };
}

export const deepseekRunner: Runner = {
  kind: 'deepseek',
  versionArgs: ['--version'],
  efforts: ['off', 'low', 'high', 'max'],
  delivery: () => 'on-demand',
  limits: LIMITS,

  workspace: (mode: RunMode) => join(root(), mode),

  skillDirs: () => [join(userHome(), 'skills'), join(process.env.DSH_AGENTS_HOME || join(homedir(), '.agents'), 'skills')],

  /** Headless, for a dsh that would not hold the turn over ACP: one turn, the browser's server mounted by the patch. */
  stream(context: StreamContext): Plan {
    const turn = turnOf(context);
    // Headless names its sessions `session-…` and ACP does not, so a session ACP began is not resumed here.
    const resume = context.sessionId?.startsWith('session-') ? ['--session-id', context.sessionId] : [];
    const chosen = { provider: provider(), model: context.settings.model ?? DEFAULT_MODEL, effort: effortOf(context.settings, this.efforts) };
    return {
      ...turn,
      files: [
        { path: PATCH, content: patch([...runRows(context.research, chosen), insertServer(context.mcp)]) },
        { path: INSTRUCTIONS, content: context.systemPrompt },
      ],
      args: ['--profile', 'headless', '--patch', join(turn.cwd, PATCH), ...resume, '--json', '-'],
      input: context.instruction,
    };
  },

  converse(context: StreamContext) {
    const { bin } = context.settings;
    if (noConversation.has(bin)) return null;
    const turn = turnOf(context);
    // A session opens on a model the route surely has; the turn then asks for the one the side panel pinned, by name.
    const opening = { provider: provider(), model: DEFAULT_MODEL };
    const plan: Plan = {
      ...turn,
      files: [
        { path: PATCH, content: patch([...runRows(context.research, opening), { id: 'acp', config: { provider: opening.provider, model: opening.model } }]) },
        { path: INSTRUCTIONS, content: context.systemPrompt },
      ],
      args: ['--profile', 'acp', '--patch', join(turn.cwd, PATCH)],
    };
    return acpConversation(context, {
      plan,
      label: 'DeepSeek Harness',
      // A resumed session reconnects only the servers it is handed, and the run id lives in theirs.
      mcpServers: [acpServer(context.mcp)],
      declined: () => noConversation.add(bin),
      explain,
      stoppedFor,
      effortOption: 'reasoning_effort',
      models: modelsOffered,
      own: (name) => name.startsWith(`mcp__${MCP_SERVER_NAME}__`),
      drawn: WEB_TOOLS,
      quiet: ['todo_write'],
      ran,
      // Its servers have listed their tools before `session/new` answers.
      settleMs: 0,
      paragraphs: true,
    });
  },

  reader(): StreamReader {
    let spoke = false;
    let generated = 0;
    const calls = new Map<string, string>();

    return (line, sink) => {
      const event = parseJsonLine<HeadlessEvent>(line);
      if (!event) return;
      switch (event.type) {
        case 'session':
          if (event.sessionId) sink.session(event.sessionId);
          return;
        case 'text':
          if (!event.text) return;
          sink.text(spoke ? `\n\n${event.text}` : event.text);
          spoke = true;
          return;
        case 'tool_call':
          if (!event.callId || !event.tool) return;
          calls.set(event.callId, event.tool);
          if (WEB_TOOLS.includes(event.tool)) sink.tool(event.callId, event.tool);
          return;
        case 'tool_result':
          return onResult(event, calls, sink);
        case 'status':
          if (event.phase === 'step_end' && event.usage) {
            const { inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheWriteTokens = 0 } = event.usage;
            generated += outputTokens;
            sink.usage({ contextTokens: inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens, outputTokens: generated });
          }
          if (event.phase === 'turn_end') return ended(event, sink);
          return;
        case 'error':
          return sink.fail('AGENT_FAILED', explain(event.message));
      }
    };
  },

  json(context: JsonContext): Plan {
    const cwd = this.workspace('task');
    mkdirSync(taskHome(), { recursive: true });
    sweepSessions(taskHome());
    const off = [...SWITCHED_OFF, WEB, TODO].filter((id) => !(context.reads && id === 'tool-fs'));
    const rows: Row[] = [
      ...off.map((id) => ({ id, disabled: true })),
      ...signIn(),
      defaultModel({ provider: provider(), model: context.settings.model ?? DEFAULT_MODEL, effort: effortOf(context.settings, this.efforts) }),
      instructionsRow(TASK_PATCH),
      ...(context.reads ? [{ id: 'tool-fs', config: READ_ONLY }] : []),
    ];
    return {
      cwd,
      env: environment(cwd, taskHome()),
      files: [{ path: TASK_PATCH, content: patch(rows) }],
      args: ['--profile', 'headless', '--patch', join(cwd, TASK_PATCH), '--json', '-'],
      input: context.prompt,
    };
  },

  answer(stdout: string) {
    let text: string | undefined;
    for (const line of stdout.split('\n')) {
      const event = parseJsonLine<HeadlessEvent>(line);
      if (event?.type === 'error') return { error: explain(event.message) };
      if (event?.type === 'status' && event.phase === 'turn_end' && event.reason?.kind === 'error') return { error: explain(event.reason.error?.message) };
      if (event?.type === 'final' && event.text) text = event.text;
    }
    return { text };
  },

  hint(stderrTail: string) {
    const said = /dsh: ([A-Z_]+): (.+)/.exec(stderrTail);
    if (/patch: entry .+ not found/i.test(stderrTail)) {
      return `Your DeepSeek Harness has changed in a way this Browsentic has not been checked against. Update both (${INSTALL}), then try again. (${stderrTail.trim()})`;
    }
    return said ? explain(said[2]) : null;
  },

  async check(settings: AgentSettings, version?: string): Promise<AgentProblem | null> {
    if (tooOld(version)) {
      return { code: 'AGENT_UNUSABLE', message: `Browsentic needs DeepSeek Harness ${FLOOR.join('.')} or later; this one is ${version?.trim()}.`, fix: INSTALL };
    }
    if (!signedIn('account') && !signedIn('key') && !process.env.DEEPSEEK_API_KEY) {
      return {
        code: 'AGENT_NEEDS_PERMISSION',
        message: 'DeepSeek Harness is not signed in to a DeepSeek account, and no DEEPSEEK_API_KEY is set.',
        fix: SIGN_IN,
      };
    }
    return vetted(settings.bin, version);
  },
};

/** The first release measured: its ACP server, patch rows and headless events are what this runner is written against. */
const FLOOR = [0, 2, 1];

function tooOld(version: string | undefined): boolean {
  const parts = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version?.trim() ?? '');
  if (!parts) return false;
  const [major, minor, patch] = parts.slice(1).map(Number);
  return major !== FLOOR[0] ? major < FLOOR[0] : minor !== FLOOR[1] ? minor < FLOOR[1] : patch < FLOOR[2];
}

/** Tool plugins a run may keep on: the to-do list, the timeout every call runs under, and the web on research. */
const VETTED = ['@deepseek-ai/dsh-tool-todo', '@deepseek-ai/dsh-tool-call-timeout-policy', '@deepseek-ai/dsh-tool-web'];

/** Plugins that hand the model a tool of their own, by the package they come from. */
const TOOLISH = /^@deepseek-ai\/dsh-(tool-|mcp-client|browser-use|computer-use|terminal|ptc|workflow)/;

const DUMP_TIMEOUT_MS = 10_000;

/** The tree each dsh a run would compose was last found in, by bin and version: a release can add a tool row that starts on. */
const trees = new Map<string, Promise<AgentProblem | null>>();

/**
 * The plugin tree a research turn would run on, as this dsh composes it with the patch: any tool
 * plugin left on that Browsentic has not vetted means the patch no longer covers this release.
 * An answer that cannot be read is no objection; the plan is still vetted, and the run tripped.
 */
function vetted(bin: string, version?: string): Promise<AgentProblem | null> {
  const key = `${bin}|${version ?? ''}`;
  let asked = trees.get(key);
  if (!asked) {
    asked = composedTree(bin).then((tree) => {
      const left = tree ? unvetted(tree) : [];
      if (!left.length) return null;
      return {
        code: 'AGENT_UNUSABLE',
        message: `This DeepSeek Harness has tool plugins Browsentic has not checked, so it would not keep a run to the browser: ${left.join(', ')}. Update Browsentic, or install the DeepSeek Harness it was checked against.`,
      } satisfies AgentProblem;
    });
    trees.set(key, asked);
  }
  return asked;
}

interface TreeRow {
  id: string;
  name: string;
  on: boolean;
}

function composedTree(bin: string): Promise<TreeRow[] | null> {
  const cwd = join(root(), 'check');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, PATCH), patch([...runRows(true, { provider: provider(), model: DEFAULT_MODEL }), { id: 'acp', config: { provider: provider(), model: DEFAULT_MODEL } }]));
  let child: CliProcess;
  try {
    child = spawnCli(bin, ['--profile', 'acp', '--patch', join(cwd, PATCH), '--dump-config'], { cwd, env: { ...childEnv('deepseek'), ...environment(cwd, runHome()) } });
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let output = '';
    const timer = setTimeout(() => {
      stopTree(child, 'SIGKILL');
      resolve(null);
    }, DUMP_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? rowsOfTree(output) : null);
    });
  });
}

/** The tool rows a composed tree leaves on that Browsentic has not vetted. */
export const unvetted = (tree: TreeRow[]): string[] => tree.filter((row) => row.on && TOOLISH.test(row.name) && !VETTED.includes(row.name)).map((row) => row.id);

/** The rows of a `--dump-config` tree: each starts `- id:` at the margin, and is off only where it says `disabled: true`. */
export function rowsOfTree(yaml: string): TreeRow[] {
  return yaml
    .split(/\n(?=- )/)
    .flatMap((block) => {
      const id = /^- id: (\S+)/.exec(block)?.[1];
      const name = /^\s+name: '?([^'\s]+)'?/m.exec(block)?.[1];
      return id && name ? [{ id, name, on: !/^\s+disabled: true$/m.test(block) }] : [];
    });
}

/** What every streamed turn starts from: its conversation's folder, and the run's own dsh home. */
function turnOf(context: StreamContext): Omit<Plan, 'args' | 'files'> {
  const base = deepseekRunner.workspace('run');
  sweepRunDirs(base);
  mkdirSync(runHome(), { recursive: true });
  const cwd = conversationDir(base, context.conversation ?? context.runId);
  return { cwd, env: environment(cwd, runHome()) };
}

function environment(cwd: string, home: string): Record<string, string> {
  mkdirSync(agentsHome(), { recursive: true });
  return {
    DSH_HOME: home,
    DSH_AGENTS_HOME: agentsHome(),
    DSH_PERMISSION_MODE: 'read-only',
    DSH_TELEMETRY_MODE: 'DISABLED',
    DSH_TELEMETRY_DISABLED: '1',
    PWD: cwd,
  };
}

/** A sign-in `dsh web` wrote, as an account record or a stored key. Only the key names are read. */
function signedIn(as: 'account' | 'key'): boolean {
  try {
    const text = readFileSync(credentials(), 'utf8');
    return as === 'account' ? /^\s+deepseek-account-platform\/default:/m.test(text) : /^\s+DEEPSEEK_API_KEY:/m.test(text);
  } catch {
    return false;
  }
}

/** A DeepSeek account where there is one, which is how `dsh web` signs in, and an API key otherwise. */
const provider = () => (signedIn('account') ? PROVIDERS.account : PROVIDERS.key);

/** The user's sign-in, and the rows headless needs to use it. */
const signIn = (): Row[] => [
  { id: 'credentials', disabled: false, config: { path: credentials() } },
  ...SIGN_IN_ROWS.map((id) => ({ id, disabled: false })),
];

function runRows(research: boolean, turn: Route): Row[] {
  return [
    ...[...SWITCHED_OFF, ...(research ? [] : [WEB])].map((id) => ({ id, disabled: true })),
    ...signIn(),
    defaultModel(turn),
    instructionsRow(PATCH),
    { id: 'system-prompt', config: { personaPrefix: PERSONA } },
    { id: 'spill-policy', config: { maxInlineTokens: RESULT_TOKENS } },
  ];
}

const defaultModel = ({ provider: through, model, effort }: Route): Row => ({
  id: 'agent-default-model',
  config: { provider: through, model, ...(effort ? { reasoningEffort: effort } : {}) },
});

/** AGENTS.md from the run's own folder alone: the patch file marks it as the project's root, so no folder above is searched. */
const instructionsRow = (marker: string): Row => ({
  id: 'agent-instructions',
  config: { maxBytes: INSTRUCTION_BYTES, projectRootMarkers: [marker], localInstructionFileCandidates: [] },
});

const patch = (rows: Row[]) => `${JSON.stringify(rows, null, 1)}\n`;

const acpServer = (mcp: McpServer) => ({
  name: MCP_SERVER_NAME,
  command: mcp.command,
  args: mcp.args,
  env: Object.entries(mcp.env).map(([name, value]) => ({ name, value })),
});

const insertServer = (mcp: McpServer): Row => ({
  insert: [
    {
      id: `mcp-${MCP_SERVER_NAME}`,
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: MCP_SERVER_NAME, transport: 'stdio', command: mcp.command, args: mcp.args, env: mcp.env },
    },
  ],
});

/**
 * dsh lists its models under each provider, each value a `[provider, model]` pair sent back as
 * JSON. A setting names the model alone, so the current provider's is the one picked.
 */
function modelsOffered(choice: ConfigOption | undefined): ModelEntry[] {
  const values = (choice?.options ?? []).flatMap((offered) => offered.options ?? [offered]).flatMap((offered) => (offered.value ? [offered.value] : []));
  const pairs = values.flatMap((value) => {
    const pair = parseJsonLine<unknown>(value);
    return Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string' ? [{ provider: pair[0], id: pair[1], value }] : [];
  });
  const current = parseJsonLine<unknown>(choice?.currentValue ?? '');
  const provider = Array.isArray(current) ? current[0] : undefined;
  return [...pairs.filter((pair) => pair.provider === provider), ...pairs.filter((pair) => pair.provider !== provider)].map(({ id, value }) => ({ id, value }));
}

/** A tool the model only named, which dsh answers as unknown, never ran; any other call that finished did. */
function ran(update: Update): boolean {
  if (update.status === 'completed') return true;
  return !/unknown tool/i.test(JSON.stringify(update.content ?? ''));
}

function onResult(event: HeadlessEvent, calls: Map<string, string>, sink: StreamSink): void {
  const id = event.callId;
  const name = id ? calls.get(id) : undefined;
  if (!id || !name) return;
  if (WEB_TOOLS.includes(name)) return sink.toolResult(id, event.status === 'completed');
  if (name.startsWith(`mcp__${MCP_SERVER_NAME}__`) || name === 'todo_write') return;
  if (event.status === 'completed' || !/unknown tool/i.test(JSON.stringify(event.result ?? ''))) sink.fail('AGENT_UNSAFE', stoppedFor(name));
}

function ended(event: HeadlessEvent, sink: StreamSink): void {
  const kind = event.reason?.kind;
  if (kind === 'error') return sink.fail('AGENT_FAILED', explain(event.reason?.error?.message));
  if (kind === 'cancelled' || kind === 'aborted') return sink.fail('CANCELLED', 'Run cancelled.');
  sink.done(kind === 'completed' || !kind ? 'end_turn' : kind);
}

function explain(message: string | undefined): string {
  if (!message) return 'DeepSeek Harness stopped without saying why.';
  if (/sign in to deepseek|MISSING_CREDENTIAL|no API key for provider/i.test(message)) {
    return `DeepSeek Harness is not signed in. Run "${SIGN_IN}" and sign in with your DeepSeek account, or set DEEPSEEK_API_KEY. (${oneLine(message)})`;
  }
  return `DeepSeek Harness: ${oneLine(message)}`;
}

const stoppedFor = (tool: string) =>
  `DeepSeek Harness ran its own ${tool} tool in this run, which Browsentic switched off, so the run was stopped. ` +
  'Update DeepSeek Harness and Browsentic; if it persists, please report it.';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Headless keeps every one-shot as a session; a day's are enough for anyone looking into one. */
function sweepSessions(home: string): void {
  const sessions = join(home, 'sessions');
  let folders: string[];
  try {
    folders = readdirSync(sessions);
  } catch {
    return;
  }
  for (const folder of folders) sweepRunDirs(join(sessions, folder));
}
