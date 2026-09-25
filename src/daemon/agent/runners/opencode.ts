import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { AgentProblem } from '@/lib/agents/catalog';
import { stateDir } from '../../lockfile';
import { MCP_SERVER_NAME } from './claude';
import { conversationDir, effortOf, parseJsonLine, sweepRunDirs } from './util';
import type { JsonContext, McpServer, Plan, Runner, RunMode, StreamContext, StreamReader, StreamSink } from './types';

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

/** OpenCode abandons an MCP call after a minute; an approval card waits on the user, and page_awaitMonitor up to ten. */
const TOOL_TIMEOUT_MS = 30 * 60_000;

const TRUNCATION = `A tool result over ${RESULT_BYTES / 1000} KB comes back cut, and the saved copy OpenCode points to cannot be opened in this run, so ask for less at a time — \`page_getPageInfo\` with a small \`maxPerKind\`, \`page_extractText\` with the cursor it hands back.`;

/** A user's `share: auto` would publish every browsing session; project config would load from folders above the workspace. */
const SEALED = { OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_DISABLE_SHARE: '1' };

/** Every folder outside git is one project to OpenCode, so runs kept in its own store would fill the user's session list. */
const sessionsDb = () => join(stateDir, 'agents', 'opencode', 'sessions.db');

const configHome = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');

const INSTALL = 'npm i -g opencode-ai';

type Permission = Record<string, string | Record<string, string>>;

interface Part {
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: { status?: string };
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
}

interface Failure {
  name?: string;
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

  workspace: (mode: RunMode) => join(stateDir, 'agents', 'opencode', mode),

  skillDirs: () => [
    join(configHome(), 'skills'),
    join(configHome(), 'skill'),
    join(homedir(), '.opencode', 'skills'),
    join(homedir(), '.agents', 'skills'),
    join(homedir(), '.claude', 'skills'),
  ],

  stream(context: StreamContext): Plan {
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

  reader(): StreamReader {
    let spoke = false;
    let generated = 0;

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
        case 'text':
          if (!part?.text) return;
          sink.text(spoke ? `\n\n${part.text}` : part.text);
          spoke = true;
          return;

        case 'tool_use': {
          const name = part?.tool;
          if (!name || ownTool(name)) return;
          if (WEB_TOOLS.includes(name)) return sink.tool(part.callID ?? randomUUID(), name);
          // A refused call is the model reaching for a tool it was never offered; one that ran means the ruleset did not hold.
          if (part.state?.status !== 'completed') return;
          return sink.fail(
            'AGENT_UNSAFE',
            `OpenCode ran its own ${name} tool in this run, which Browsentic denied, so the run was stopped. ` +
              'Update OpenCode and Browsentic; if it persists, please report it.',
          );
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
    for (const line of stdout.split('\n')) {
      const event = parseJsonLine<Event>(line);
      if (event?.type === 'error') return { error: explain(event.error) };
      if (event?.type === 'step_start') said = [];
      if (event?.type === 'text' && event.part?.text) said.push(event.part.text);
    }
    return { text: said.length ? said.join('\n\n') : undefined };
  },

  hint(stderrTail: string) {
    if (/Unknown arguments?|Not enough arguments|Invalid values/i.test(stderrTail)) {
      return `Your OpenCode does not understand the flags Browsentic uses. Update it (${INSTALL}), then try again. (${stderrTail.trim()})`;
    }
    return null;
  },

  async check(): Promise<AgentProblem | null> {
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

const ownTool = (name: string) => name.startsWith(`${MCP_SERVER_NAME}_`);

const server = (mcp: McpServer) => ({
  type: 'local',
  command: [mcp.command, ...mcp.args],
  environment: mcp.env,
  enabled: true,
  timeout: TOOL_TIMEOUT_MS,
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

/**
 * OpenCode matches a read against its path relative to the project root — `/` outside git, the
 * repository when the home directory is one — so the scratch folder is allowed as seen from every
 * ancestor. Never from the workspace itself: `tmp/*` under a root of `/` is the machine's /tmp.
 */
function scratchReads(workspace: string): Record<string, string> {
  const scratch = join(workspace, 'tmp');
  const rules: Record<string, string> = { '*': 'deny' };
  for (let root = dirname(workspace); ; root = dirname(root)) {
    rules[`${relative(root, scratch)}/*`] = 'allow';
    if (root === dirname(root)) return rules;
  }
}

function explain(failure: Failure | undefined): string {
  const message = oneLine(failure?.data?.message ?? failure?.name ?? 'OpenCode reported an error');
  const status = failure?.data?.statusCode;
  // Zen serves its free models only to requests carrying OpenCode's own built-in tools.
  if (failure?.data?.responseBody?.includes('FreeTierError')) {
    return (
      `OpenCode Zen's free models refuse a run whose tools Browsentic has narrowed to the browser. Run "opencode auth login" ` +
      `to sign in to a provider, then pick one of its models in the Browsentic popup. (${message})`
    );
  }
  if (failure?.name === 'ProviderAuthError' || status === 401 || status === 403) {
    return (
      `${message} If that is a login problem, run "opencode auth login" — a key kept only in an environment ` +
      'variable is not passed to a Browsentic run.'
    );
  }
  if (status === 429) return `The provider behind OpenCode is rate-limiting this account. Wait and try again. (${message})`;
  if (failure?.name === 'UnknownError') {
    return (
      `OpenCode could not start this turn, most often because it does not know the model. Pick one in the ` +
      `Browsentic popup as "opencode models" lists it — provider/model — then try again. (${message})`
    );
  }
  return message;
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
function declaresProvider(): boolean {
  return ['opencode.json', 'opencode.jsonc', 'config.json'].some((name) => {
    try {
      return /"provider"\s*:/.test(readFileSync(join(configHome(), name), 'utf8'));
    } catch {
      return false;
    }
  });
}
