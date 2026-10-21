/**
 * Containment for the process the daemon spawns.
 *
 * Everything else in this directory governs what the model may do *to a page*. This
 * governs what it may do *to the machine*, which is a separate problem with a separate
 * blast radius: a side-panel run is a third-party agent CLI running as the user, with
 * its own file and shell tools, and `decide()` never sees those calls. A page that
 * talks the model into reading `~/.aws/credentials` has not touched a single `page.*`
 * action on the way.
 *
 * Containment is delegated, because flags are the only lever those CLIs offer. That is
 * worth having, but it is a request rather than an enforcement: a dropped flag, a
 * renamed option, or a new runner written in a hurry leaves no trace at runtime and no
 * failing check. So the plan is vetted here — at `launch()`, the one place every
 * runner passes through, before `spawn()` — and a plan that has lost its containment
 * does not start.
 *
 * `sealEnv` is the half that does not depend on the CLI cooperating at all. The daemon
 * inherits the environment of whatever shell started it, which on a developer's machine
 * is where cloud keys, registry tokens and database URLs live. None of that belongs to
 * a browsing agent, and an agent that can read its own environment is one convincing
 * paragraph away from typing it into a form.
 *
 * What this cannot do is make a CLI safe that offers no lever. `localTools` records
 * which case each runner is in, so the weak one is visible in the log rather than
 * assumed away.
 */

import { posix, win32 } from 'node:path';
import { AGENTS, isModelId, type AgentKind } from '@/lib/agents/catalog';

/**
 * `run` drives the browser; `task` is a one-shot that must not reach it at all; `conversation` drives
 * the browser too, through a CLI held over stdin and handed the tools in-process rather than over MCP.
 */
export type SpawnMode = 'run' | 'task' | 'conversation';

/** Structural view of a runner's `Plan`. Kept local so guardrails never import runners. */
export interface SpawnPlan {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: readonly { readonly path: string; readonly content: string }[];
  readonly prepare?: readonly (readonly string[])[];
}

/**
 * How a CLI is kept off the local machine.
 *
 *   allowlist  the CLI takes a per-run tool list and we hand it one
 *   sandbox    no tool list, but the process itself runs restricted
 *   host       neither: containment lives in the user's own config for that CLI
 */
export type LocalTools = 'allowlist' | 'sandbox' | 'host';

interface ToolDenial {
  readonly flag: string;
  readonly tools: readonly string[];
}

interface ToolAllowance {
  readonly flag: string;
  /** Every value the plan passes after `flag`, comma lists included, has to be one of these. */
  readonly only: readonly string[];
}

interface Requirements {
  /** Arguments the plan must carry verbatim. */
  readonly required: readonly string[];
  /** `--flag value` pairs the plan must carry, with no later occurrence of the flag saying otherwise. */
  readonly pairs: readonly (readonly [string, string])[];
  /** Tools the plan must name after a deny flag. */
  readonly denies?: ToolDenial;
  /** The whole of what the plan may switch on, for a CLI whose tool flag is an allowlist. */
  readonly allows?: ToolAllowance;
  /** Variables the plan must set for a CLI that takes a switch only from its environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Substrings a variable must contain, for a CLI that takes its whole config as one. */
  readonly envContains?: Readonly<Record<string, readonly string[]>>;
  /** Workspace files the plan must write before the CLI starts. */
  readonly files: readonly string[];
  /**
   * Substrings each workspace file must contain, for a CLI whose containment lives on disk
   * rather than in argv. `files` alone proves a path was written, not that it still says no.
   */
  readonly fileContains?: Readonly<Record<string, readonly string[]>>;
  /** The only set-up commands the plan may run before its turn, each exactly as written here. */
  readonly prepare?: readonly (readonly string[])[];
  /** Variables that must name the plan's own working directory, for a CLI that moves to one before using its cwd. */
  readonly envIsCwd?: readonly string[];
  /** What this shape cannot say, read out of the plan itself: each answer is a clause the label goes in front of. */
  readonly inspect?: (plan: SpawnPlan) => string[];
}

/** One way of being contained, or several a CLI's releases each need, of which a plan has to meet one in full. */
type Rules = Requirements | readonly Requirements[];

interface Containment {
  readonly localTools: LocalTools;
  /** Env prefixes this agent needs to authenticate, kept when the rest is sealed. */
  readonly keepsEnv: readonly string[];
  /**
   * Prefixes that become the agent's own credentials once a flag says so. Claude Code
   * on Bedrock authenticates with `AWS_*`: sealing it would be sealing the agent out of
   * its own model, and the failure would read as a login problem rather than a policy.
   */
  readonly federated?: Readonly<Record<string, readonly string[]>>;
  /**
   * Flags that hand *this* CLI the machine but are legitimate elsewhere, so they cannot join
   * the global list. Vibe requires `--trust`; for Cursor the same spelling is an escape hatch.
   */
  readonly forbidden?: readonly RegExp[];
  /** Why this runner is only as contained as it is. Logged once per run. */
  readonly note: string;
  readonly run: Rules;
  readonly task: Rules;
  /** Only a runner that holds conversations has these; any other refuses to start one. */
  readonly conversation?: Rules;
}

/**
 * Flags that hand a CLI the machine, in every spelling the runners use. Checked
 * against every runner rather than only the one that owns each flag: the cost is
 * nothing and it covers the runner nobody has written yet.
 */
const FORBIDDEN: readonly RegExp[] = [
  /^--dangerously/i,
  /^--yolo$/i,
  /^-y$/,
  /^--force$/i,
  /^-f$/,
  /^--auto-approve$/i,
  /^--always-approve$/i,
  /^--full-auto$/i,
  /^--no-sandbox$/i,
  /^--allow-all/i,
  /danger-full-access/i,
  /^--sandbox=?(workspace-write|danger-full-access|off)$/i,
  /^sandbox_mode=(?!"read-only"$)/i,
  /^approval_policy=(?!"never"$)/i,
  /^--permission-mode=?(bypassPermissions|acceptEdits)$/i,
];

/** Local tools no run may ever have, whatever else it is allowed. */
const NEVER = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep', 'Task'];

/**
 * The same, as Qwen spells it. `Edit` is its meta-rule for edit, write_file and notebook_edit;
 * `agent` is its sub-agent tool and `skill` reaches its bundled browser-use and computer-use
 * skills, which drive a second browser and install packages outside this run's gate.
 */
const NEVER_QWEN = ['Bash', 'exec', 'Edit', 'agent', 'skill', 'monitor'];

/**
 * Grok takes these only from its environment. It loads Claude Code's and Cursor's MCP servers
 * by default — the user's own `browsentic` entry among them, which reaches the browser without
 * a run's gate — and its memory would carry what a page said into the user's next session.
 */
const GROK_SEALED = { GROK_MEMORY: '0', GROK_CLAUDE_MCPS_ENABLED: 'false', GROK_CURSOR_MCPS_ENABLED: 'false' };

/**
 * OpenCode takes these only from its environment. Project config would load agents and tools from
 * the folders above the workspace, and a user's `share: auto` publishes every session it runs.
 */
const OPENCODE_SEALED = { OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1', OPENCODE_DISABLE_SHARE: '1' };

/** The ruleset that denies every tool not named after it, and the switch that keeps a session off opncd.ai. */
const OPENCODE_CONFIG = ['"*":"deny"', '"share":"disabled"'];

/**
 * OpenCode 2 renamed the project switch, keeping the old name only as a fallback the new one overrides
 * when set at all, and reads a global config folder `OPENCODE_DISABLE_PROJECT_CONFIG` never reaches.
 */
const OPENCODE2_SEALED = {
  OPENCODE_CONFIG_PROJECT_DISABLE: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
};

const OPENCODE_AGENT = 'browsentic-contained';

const OPENCODE_WEB = ['webfetch', 'websearch'];

interface OpenCodeStatement {
  action?: unknown;
  resource?: unknown;
  effect?: unknown;
}

interface OpenCode2Config {
  share?: unknown;
  default_agent?: unknown;
  policies?: OpenCodeStatement[];
  agents?: Record<string, { permissions?: OpenCodeStatement[] } | undefined>;
  mcp?: { servers?: Record<string, { codemode?: unknown } | undefined> };
}

/**
 * OpenCode 2's config read rather than searched: its rules are a list, where an allow added after the
 * deny would sit beside it and still match. A run's agent opens on denying everything and then allows
 * the browser's tools, the web's on research, and a one-shot's scratch reads, nothing else; the
 * browser's server is the only one and lists its tools directly, outside Code Mode's `execute`; and
 * policies keep the user's plugins and other MCP servers from loading at all.
 */
const openCode2 =
  (mode: SpawnMode) =>
  (plan: SpawnPlan): string[] => {
    let config: OpenCode2Config;
    try {
      config = JSON.parse(plan.env?.OPENCODE_CONFIG_CONTENT ?? '') as OpenCode2Config;
    } catch {
      return ['is spawned without a readable OPENCODE_CONFIG_CONTENT'];
    }
    const problems: string[] = [];
    if (config.share !== 'disabled') problems.push('is spawned with sharing left on');
    if (mode === 'conversation' && config.default_agent !== OPENCODE_AGENT) problems.push(`starts its sessions in an agent other than ${OPENCODE_AGENT}`);

    const [first, ...rest] = config.agents?.[OPENCODE_AGENT]?.permissions ?? [];
    if (first?.action !== '*' || first.resource !== '*' || first.effect !== 'deny') {
      problems.push(`gives ${OPENCODE_AGENT} rules that do not open on denying everything`);
    }
    const mayAllow = ({ action, resource }: OpenCodeStatement) =>
      mode === 'task'
        ? action === 'read' && typeof resource === 'string' && resource !== '*'
        : typeof action === 'string' && (action.startsWith('browsentic_') || OPENCODE_WEB.includes(action));
    for (const rule of rest) {
      if (rule.effect !== 'deny' && !mayAllow(rule)) problems.push(`lets ${OPENCODE_AGENT} ${String(rule.effect)} ${String(rule.action)} on ${String(rule.resource)}`);
    }

    const servers = config.mcp?.servers ?? {};
    if (mode === 'task' && Object.keys(servers).length) problems.push('gives a one-shot an MCP server');
    if (mode !== 'task' && (Object.keys(servers).join() !== 'browsentic' || servers.browsentic?.codemode !== false)) {
      problems.push("serves the browser's tools other than directly, from its one server");
    }

    const policies = config.policies ?? [];
    for (const resource of ['plugin:*', 'mcp:*']) {
      const last = policies.filter((policy) => policy.action === 'integration.use' && policy.resource === resource).at(-1);
      if (last?.effect !== 'deny') problems.push(`does not keep ${resource} from loading`);
    }
    return problems;
  };

/**
 * Rows of a DeepSeek Harness profile that give the model a tool of its own, or run work beside the
 * turn: the shell, the disk, skills, sub-agents, scripted workflows, goals, its own commands and
 * questions, and the telemetry exporters. The web rows are left to a run in research mode.
 */
const DEEPSEEK_OFF = [
  'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search',
  'tool-skill', 'skill', 'skill-filesystem',
  'tool-subagent', 'tool-subagent-fork', 'tool-subagent-control', 'tool-subagent-list-agents',
  'tool-workflow', 'workflow-ptc', 'ptc-runtime',
  'tool-goal', 'goal', 'goal-round-driver', 'command-goal', 'tool-working-directory',
  'plan-mode', 'mcp-resources', 'user-questions', 'commands', 'command-feedback', 'command-compact',
  'otel', 'session-telemetry-otel',
];

const DEEPSEEK_SIGN_IN = ['credentials', 'authorization', 'deepseek-account'];

const DEEPSEEK_PROVIDERS = ['deepseek-account', 'deepseek-official'];

const DEEPSEEK_EFFORTS = ['off', 'low', 'high', 'max'];

const DEEPSEEK_PERSONA = "You are Browsentic's browser agent, powered by the {{model}} model.";

/** dsh's own environment switches: a sandbox for whatever might still run, and no telemetry. */
const DEEPSEEK_SEALED = { DSH_PERMISSION_MODE: 'read-only', DSH_TELEMETRY_MODE: 'DISABLED', DSH_TELEMETRY_DISABLED: '1' };

interface DeepseekRow {
  id?: unknown;
  name?: unknown;
  disabled?: unknown;
  config?: Record<string, unknown>;
  insert?: DeepseekRow[];
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A DeepSeek Harness plan read rather than searched. Its argv is exactly a profile and a patch; its
 * homes are Browsentic's own, so none of the user's patches, AGENTS.md or skills compose into it;
 * and the patch switches off every row that hands the model a tool. Beyond those it may switch the
 * sign-in back on, point the credentials row at the user's file, pick a route, keep instructions
 * to the run's folder, set the persona and the result ceiling, give a one-shot a read-only `read`
 * and a headless run the browser's server: anything else is refused.
 */
const deepseek =
  (mode: SpawnMode) =>
  (plan: SpawnPlan): string[] => {
    const problems: string[] = [];
    const profile = mode === 'conversation' ? 'acp' : 'headless';
    const patchFile = mode === 'task' ? 'task.patch.yml' : 'browsentic.patch.yml';
    const patchPath = posix.join(plan.cwd, patchFile) === plan.args[3] || win32.join(plan.cwd, patchFile) === plan.args[3] ? plan.args[3] : undefined;
    const tail = plan.args.slice(4);
    const shaped =
      plan.args[0] === '--profile' && plan.args[1] === profile && plan.args[2] === '--patch' && patchPath !== undefined &&
      (mode === 'conversation'
        ? tail.length === 0
        : sameJson(tail.slice(-2), ['--json', '-']) && (tail.length === 2 || (mode === 'run' && tail.length === 4 && tail[0] === '--session-id')));
    if (!shaped) problems.push(`is spawned other than as \`dsh --profile ${profile} --patch <its ${patchFile}>\``);

    const owner = deepseekRoot(plan.cwd);
    for (const name of ['DSH_HOME', 'DSH_AGENTS_HOME']) {
      const value = plan.env?.[name];
      if (!owner || !value || !within(value, owner)) problems.push(`is spawned with a ${name} outside Browsentic's own`);
    }

    let rows: DeepseekRow[];
    try {
      rows = JSON.parse(plan.files?.find((file) => file.path === patchFile)?.content ?? '') as DeepseekRow[];
      if (!Array.isArray(rows)) throw new Error('not a list');
    } catch {
      return [...problems, `writes a ${patchFile} that is not a readable list of rows`];
    }

    const switchedOff = new Set(rows.filter((row) => row.disabled === true && Object.keys(row).length === 2).map((row) => row.id));
    const missing = DEEPSEEK_OFF.filter((id) => !switchedOff.has(id) && !(mode === 'task' && id === 'tool-fs' && readOnly(rows)));
    if (missing.length) problems.push(`leaves ${missing.join(', ')} switched on`);
    for (const row of rows) {
      const clause = deepseekRow(row, mode);
      if (clause) problems.push(clause);
    }
    return problems;
  };

/** Whether the one-shot's patch gives it `read` and no other file tool. */
const readOnly = (rows: DeepseekRow[]) =>
  rows.some((row) => row.id === 'tool-fs' && sameJson(row.config, { read: true, readImage: false, write: false, edit: false }) && row.disabled === undefined);

/** What is wrong with one row of the patch, or null when it is a row the plan may carry. */
function deepseekRow(row: DeepseekRow, mode: SpawnMode): string | null {
  if (row.insert !== undefined) {
    const [server, ...others] = Array.isArray(row.insert) ? row.insert : [];
    const config = server?.config ?? {};
    const browser =
      mode === 'run' && others.length === 0 && Object.keys(row).length === 1 &&
      server?.name === '@deepseek-ai/dsh-mcp-client' && config.serverName === 'browsentic' && config.transport === 'stdio' &&
      Array.isArray(config.args) && config.args.at(-1) === 'mcp' &&
      typeof (config.env as Record<string, unknown> | undefined)?.BROWSENTIC_AGENT_RUN === 'string';
    return browser ? null : 'inserts a row other than the browser’s own server';
  }
  const { id, disabled, config } = row;
  if (typeof id !== 'string') return 'carries a row with no id';
  if (disabled === true) return config === undefined && Object.keys(row).length === 2 ? null : `switches ${id} off with a config besides`;
  if (disabled === false && !DEEPSEEK_SIGN_IN.includes(id)) return `switches ${id} on`;
  if (config === undefined) return disabled === false ? null : `carries a ${id} row that does nothing`;
  switch (id) {
    case 'credentials':
      return Object.keys(config).join() === 'path' && typeof config.path === 'string' && /[\\/]\.credentials\.yaml$/.test(config.path) ? null : 'points the credentials row elsewhere than a sign-in file';
    case 'agent-default-model':
    case 'acp': {
      const known = Object.keys(config).every((key) => ['provider', 'model', ...(id === 'acp' ? [] : ['reasoningEffort'])].includes(key));
      const fits =
        DEEPSEEK_PROVIDERS.includes(config.provider as string) && isModelId(config.model) &&
        (config.reasoningEffort === undefined || DEEPSEEK_EFFORTS.includes(config.reasoningEffort as string));
      return known && fits && (id !== 'acp' || mode === 'conversation') ? null : `picks a route through ${id} it may not`;
    }
    case 'agent-instructions': {
      const marker = mode === 'task' ? 'task.patch.yml' : 'browsentic.patch.yml';
      const keys = Object.keys(config).sort().join();
      return keys === 'localInstructionFileCandidates,maxBytes,projectRootMarkers' && typeof config.maxBytes === 'number' &&
        sameJson(config.projectRootMarkers, [marker]) && sameJson(config.localInstructionFileCandidates, [])
        ? null
        : 'lets workspace instructions come from beyond the run’s own folder';
    }
    case 'system-prompt':
      return sameJson(config, { personaPrefix: DEEPSEEK_PERSONA }) ? null : 'rewrites the system prompt’s persona';
    case 'spill-policy':
      return Object.keys(config).join() === 'maxInlineTokens' && typeof config.maxInlineTokens === 'number' ? null : 'reconfigures the result ceiling';
    case 'tool-fs':
      return mode === 'task' && sameJson(config, { read: true, readImage: false, write: false, edit: false }) ? null : 'gives the model file tools';
    default:
      return `reconfigures ${id}`;
  }
}

/** The `agents/deepseek` folder a plan's working directory lies in, whose homes are the only ones it may use. */
function deepseekRoot(cwd: string): string | undefined {
  const path = cwd.includes('\\') ? win32 : posix;
  for (let dir = cwd; path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    if (path.basename(dir) === 'deepseek' && path.basename(path.dirname(dir)) === 'agents') return dir;
  }
  return undefined;
}

const deepseekRules = (mode: SpawnMode): Requirements => ({
  required: [],
  pairs: [],
  env: DEEPSEEK_SEALED,
  envIsCwd: ['PWD'],
  inspect: deepseek(mode),
  files: mode === 'task' ? ['task.patch.yml'] : ['browsentic.patch.yml', 'AGENTS.md'],
});

const openCode2Rules = (mode: SpawnMode): Requirements => ({
  required: mode === 'conversation' ? ['acp'] : ['--standalone'],
  pairs:
    mode === 'conversation'
      ? []
      : [
          ['--agent', OPENCODE_AGENT],
          ['--format', 'json'],
        ],
  env: OPENCODE2_SEALED,
  envIsCwd: ['PWD'],
  inspect: openCode2(mode),
  files: mode === 'task' ? [] : ['instructions.md'],
});

export const CONTAINMENT: Record<AgentKind, Containment> = {
  claude: {
    localTools: 'allowlist',
    keepsEnv: ['ANTHROPIC_', 'CLAUDE_'],
    federated: {
      CLAUDE_CODE_USE_BEDROCK: ['AWS_'],
      CLAUDE_CODE_USE_VERTEX: ['GOOGLE_', 'GCLOUD_', 'CLOUDSDK_'],
    },
    note: 'per-run tool allowlist plus an explicit deny list',
    run: {
      required: ['--strict-mcp-config', '--allowedTools'],
      pairs: [],
      // A browser run reads pages, never the disk.
      denies: { flag: '--disallowedTools', tools: [...NEVER, 'Read'] },
      files: [],
    },
    task: {
      // `{"mcpServers":{}}` is the assertion that matters here: a one-shot summarizing
      // job must not be able to reach the browser at all. `Read` is deliberately left
      // out of the deny list — some tasks are handed a file in the scratch workspace.
      required: ['--strict-mcp-config', '{"mcpServers":{}}'],
      pairs: [],
      denies: { flag: '--disallowedTools', tools: NEVER },
      files: [],
    },
  },

  codex: {
    localTools: 'sandbox',
    keepsEnv: ['OPENAI_', 'CODEX_', 'AZURE_OPENAI_'],
    // A `-c` merges into the user's config.toml, so turning a switch back on takes one later flag; a
    // profile layers a second config file back on, with whatever MCP servers it names.
    forbidden: [/^features\.(shell_tool|view_image)=(?!false$)/i, /^--enable(=|$)/i, /^--profile(=|$)/i],
    note:
      'no per-run tool list: the user’s config.toml is left out, so the browser is the only MCP server; the shell and the image viewer are switched off, ' +
      'and the read-only sandbox refuses the writes its patch tool still offers. A one-shot that reads a text file keeps the shell, read-only, so it can read any file the user can',
    run: {
      // Sub-agents are spawned outside the run's gate and report nothing to the panel.
      required: [
        '--ignore-user-config',
        'sandbox_mode="read-only"',
        'approval_policy="never"',
        'features.multi_agent=false',
        'features.shell_tool=false',
        'features.view_image=false',
      ],
      pairs: [],
      files: [],
    },
    task: {
      // Left out, config.toml takes its MCP servers with it; `mcp_servers={}` alone clears none of them.
      required: ['--ignore-user-config', 'sandbox_mode="read-only"', 'approval_policy="never"', 'features.multi_agent=false'],
      pairs: [],
      files: [],
    },
    // The app-server has no --ignore-user-config. It is handed the browser tools in-process and no MCP
    // server of Browsentic's; each one config.toml names is switched off for the thread once Codex has
    // said which there are, and one that starts anyway stops the run.
    conversation: {
      required: [
        'app-server',
        'sandbox_mode="read-only"',
        'approval_policy="never"',
        'features.multi_agent=false',
        'features.shell_tool=false',
        'features.view_image=false',
      ],
      pairs: [],
      files: [],
    },
  },

  antigravity: {
    localTools: 'host',
    keepsEnv: ['GEMINI_', 'GOOGLE_', 'ANTIGRAVITY_'],
    note: 'no per-run tool list and no sandbox flag; its built-in tools are governed by the user’s own CLI settings, so a sealed environment is the only containment Browsentic applies',
    run: {
      required: [],
      pairs: [],
      files: ['.agents/mcp_config.json', 'AGENTS.md'],
    },
    task: {
      required: [],
      pairs: [],
      files: ['.agents/mcp_config.json', 'AGENTS.md'],
    },
  },

  vibe: {
    localTools: 'allowlist',
    keepsEnv: ['MISTRAL_', 'VIBE_'],
    note: 'per-run tool allowlist; the shell and file tools are never loaded, and approvals follow a config Browsentic writes',
    run: {
      required: ['--trust'],
      pairs: [['--agent', 'ask']],
      allows: { flag: '--enabled-tools', only: ['browsentic_*', 'web_search', 'web_fetch'] },
      files: ['.vibe/config.toml', 'AGENTS.md'],
    },
    task: {
      required: ['--trust'],
      pairs: [['--agent', 'ask']],
      // A one-shot reaches no browser: nothing but the scratch-file reader, or a pattern that matches no tool.
      allows: { flag: '--enabled-tools', only: ['read_file', 're:^$'] },
      files: ['.vibe/config.toml', 'AGENTS.md'],
    },
  },

  grok: {
    localTools: 'allowlist',
    keepsEnv: ['XAI_', 'GROK_'],
    note: 'per-run built-in tool list, approvals that refuse whatever was not granted up front, and a kernel sandbox that keeps writes in its own directory; reads are closed by the tool list and a Read deny rather than the sandbox, and MCP servers the user gave Grok itself still load',
    run: {
      required: ['--no-subagents'],
      // `--always-approve` would be the headless default; dontAsk runs only what was allowed.
      pairs: [
        ['--permission-mode', 'dontAsk'],
        ['--sandbox', 'workspace'],
      ],
      // Deny beats every allow Grok merges in, including the user's Claude Code rules.
      denies: { flag: '--deny', tools: ['Bash', 'Edit', 'Write', 'Read'] },
      allows: { flag: '--tools', only: ['todo_write', 'web_search', 'web_fetch'] },
      env: GROK_SEALED,
      files: ['.grok/config.toml'],
    },
    task: {
      required: ['--no-subagents'],
      pairs: [
        ['--permission-mode', 'dontAsk'],
        ['--sandbox', 'read-only'],
      ],
      // A bare MCPTool refuses every MCP call, from whichever server the user configured.
      denies: { flag: '--deny', tools: ['MCPTool', 'Bash', 'Edit', 'Write'] },
      allows: { flag: '--tools', only: ['todo_write', 'read_file'] },
      env: GROK_SEALED,
      files: [],
    },
  },

  cursor: {
    localTools: 'allowlist',
    keepsEnv: ['CURSOR_'],
    // `--trust` skips the workspace-trust prompt and `--approve-mcps` approves every server the
    // user ever configured; `--auto-review` hands the decision to a server-side classifier.
    forbidden: [/^--approve-mcps$/i, /^--auto-review$/i],
    note: 'per-run deny rules in a project .cursor/cli.json, where deny beats allow — measured refusing a shell command in a headless run; the OS sandbox is asked for as well but not depended on',
    run: {
      // Headless refuses to start in an untrusted folder; the folder is Browsentic's own.
      required: ['--trust'],
      pairs: [['--sandbox', 'enabled']],
      files: ['.cursor/mcp.json', '.cursor/cli.json', '.cursor/sandbox.json', 'AGENTS.md'],
      // The deny rules are the containment, so the file has to still carry them at spawn. Every
      // plugin's MCP server loads in every run, so those are denied as one pattern.
      fileContains: {
        '.cursor/cli.json': ['"Shell(*)"', '"Write(**)"', '"Read(**)"', '"Mcp(browsentic:*)"', '"Mcp(plugin-*:*)"'],
        '.cursor/sandbox.json': ['"workspace_readonly"'],
      },
      // A project's MCP server loads only once approved, and only this one is: not every server
      // the user has, which is what `--approve-mcps` would do.
      prepare: [['mcp', 'enable', 'browsentic']],
    },
    task: {
      required: ['--trust'],
      pairs: [['--sandbox', 'enabled']],
      // No .cursor/mcp.json at all, and a bare Mcp(*) deny in case the user's global one loads.
      files: ['.cursor/cli.json', '.cursor/sandbox.json'],
      fileContains: {
        '.cursor/cli.json': ['"Shell(*)"', '"Write(**)"', '"Mcp(*)"'],
        '.cursor/sandbox.json': ['"workspace_readonly"'],
      },
    },
  },

  qwen: {
    localTools: 'allowlist',
    // The documented way to point Qwen at a provider is OPENAI_API_KEY with OPENAI_BASE_URL, so
    // sealing that prefix would seal most installs out of their own model; Codex already keeps it.
    // ANTHROPIC_ and GEMINI_ are auth types Qwen accepts and this does not hand it.
    keepsEnv: ['QWEN_', 'DASHSCOPE_', 'BAILIAN_', 'OPENAI_'],
    // `--bare` reads like a quieter --safe-mode and is the one flag that switches off the
    // non-interactive refusal of shell, edit and write; `--insecure` drops TLS verification.
    forbidden: [/^--bare$/i, /^--insecure$/i, /^--approval-mode=(?!default$)/i],
    note:
      'per-run tool allowlist over an explicit deny list, and only one MCP server may load; ' +
      'the built-ins are closed by deny rules rather than by --core-tools, whose fail-closed ' +
      'allowlist --safe-mode silently ignores, so a built-in a future Qwen release adds would ' +
      'register — the init line names every tool that did, and the reader stops the run on one ' +
      'Browsentic did not ask for',
    run: {
      // Without it the user's own MCP servers, hooks, extensions and permission rules all load.
      required: ['--safe-mode', '--include-partial-messages'],
      pairs: [
        ['--approval-mode', 'default'],
        ['--output-format', 'stream-json'],
        ['--allowed-mcp-server-names', 'browsentic'],
      ],
      // A browser run reads pages, never the disk. `Read` and `Edit` are Qwen's own meta-rules.
      denies: { flag: '--exclude-tools', tools: [...NEVER_QWEN, 'Read'] },
      files: [],
    },
    task: {
      required: ['--safe-mode'],
      pairs: [
        ['--approval-mode', 'default'],
        ['--output-format', 'json'],
        // Safe mode drops the user's own servers, so an empty set is the whole MCP surface:
        // a one-shot cannot reach the browser at all. `Read` is left out of the deny list —
        // some tasks are handed a file in the scratch workspace.
        ['--mcp-config', '{"mcpServers":{}}'],
      ],
      denies: { flag: '--exclude-tools', tools: NEVER_QWEN },
      files: [],
    },
  },

  opencode: {
    localTools: 'allowlist',
    // A key in ANTHROPIC_* or OPENAI_* would be one of a dozen providers OpenCode reads; `opencode auth login` keeps them in a file.
    keepsEnv: ['OPENCODE_'],
    // `--auto` approves whatever is not denied, `--attach` and `--server` run the turn in a server started with someone
    // else's config, `--dir` moves it out of the workspace, `--share` publishes it, and `--file` hands the model a file.
    forbidden: [/^--auto$/i, /^--attach/i, /^--server/i, /^--dir/i, /^--share$/i, /^--file/i, /^--(agent|format|model)=/i],
    note:
      'a per-run permission ruleset opening on denying everything, which OpenCode applies after the user’s own rules, ' +
      'so the model is offered no tool that was not named — built-in, custom, or another MCP server’s; ' +
      'on 1.x external plugins and project config stay off, but MCP servers the user gave OpenCode itself still start, with their tools hidden; ' +
      'on 2.x a policy keeps the user’s plugins and other MCP servers from loading, though one in their global or managed config outranks it',
    run: [
      {
        // Plugins run inside OpenCode and can add tools or answer its permission prompts.
        required: ['--pure'],
        pairs: [
          ['--agent', OPENCODE_AGENT],
          ['--format', 'json'],
        ],
        env: OPENCODE_SEALED,
        envContains: { OPENCODE_CONFIG_CONTENT: OPENCODE_CONFIG },
        files: ['instructions.md'],
      },
      openCode2Rules('run'),
    ],
    task: [
      {
        required: ['--pure'],
        pairs: [
          ['--agent', OPENCODE_AGENT],
          ['--format', 'json'],
        ],
        env: OPENCODE_SEALED,
        // An empty map adds no server of ours, so a one-shot has no way to the browser.
        envContains: { OPENCODE_CONFIG_CONTENT: [...OPENCODE_CONFIG, '"mcp":{}'] },
        files: [],
      },
      openCode2Rules('task'),
    ],
    conversation: openCode2Rules('conversation'),
  },

  deepseek: {
    localTools: 'allowlist',
    // A run signs in with the user's dsh sign-in, through the patch; DEEPSEEK_API_KEY is the other route dsh reads.
    keepsEnv: ['DEEPSEEK_'],
    // Its own launcher flags would load another profile or patch, or rewrite a profile, beside the vetted one.
    forbidden: [/^--profile=/i, /^--patch=/i, /^--from-default-profile/i, /^--dump/i],
    note:
      'a per-run patch over its plugin tree that switches off every row giving the model a tool of its own — shell, files, ' +
      'skills, sub-agents, workflows — so the model is offered the browser alone; runs keep a dsh home of Browsentic’s, ' +
      'so the user’s own patches, AGENTS.md and skills never compose in, and borrow only the sign-in',
    run: deepseekRules('run'),
    task: deepseekRules('task'),
    conversation: deepseekRules('conversation'),
  },
};

/**
 * Everything wrong with a plan, as sentences. Empty means it may spawn.
 *
 * Pure, so the harness can assert every runner's real plan without spawning anything.
 */
export function vetPlan(kind: AgentKind, mode: SpawnMode, plan: SpawnPlan, home: string): string[] {
  const rules = CONTAINMENT[kind][mode];
  const label = `${AGENTS[kind].label} (${mode})`;
  if (!rules) return [`${label} has no containment written for it.`];
  // A plan meets one way of being contained in full, or is held to the way it came closest to.
  const shortfalls = alternativesOf(rules).map((alternative) => unmet(alternative, plan, label));
  const problems = [...(shortfalls.find((shortfall) => shortfall.length === 0) ?? shortfalls.reduce((a, b) => (b.length < a.length ? b : a)))];

  const banned = [...FORBIDDEN, ...(CONTAINMENT[kind].forbidden ?? [])];
  for (const arg of plan.args) {
    if (banned.some((pattern) => pattern.test(arg))) {
      problems.push(`${label} is spawned with ${arg}, which disables its own containment.`);
    }
  }

  for (const model of [...everyValueOf(plan.args, '--model'), ...everyValueOf(plan.args, '-m')]) {
    if (!isModelId(model)) problems.push(`${label} is spawned with the model ${JSON.stringify(model)}, which it could read as a flag.`);
  }

  if (!within(plan.cwd, home)) problems.push(`${label} would run in ${plan.cwd}, which is outside ${home}.`);

  return problems;
}

const alternativesOf = (rules: Rules): readonly Requirements[] => ('required' in rules ? [rules] : rules);

/** What a plan lacks of one way of being contained. */
function unmet(rules: Requirements, plan: SpawnPlan, label: string): string[] {
  const problems: string[] = [];

  for (const arg of rules.required) {
    if (!plan.args.includes(arg)) problems.push(`${label} is spawned without ${arg}.`);
  }

  // A CLI takes the last of a repeated flag, so every occurrence has to say the same thing.
  for (const [flag, value] of rules.pairs) {
    const given = everyValueOf(plan.args, flag);
    if (!given.length || given.some((other) => other !== value)) problems.push(`${label} is spawned without ${flag} ${value}.`);
  }

  if (rules.denies) {
    const named = [...variadic(plan.args, rules.denies.flag), ...everyValueOf(plan.args, rules.denies.flag)];
    const missing = rules.denies.tools.filter((tool) => !named.includes(tool));
    if (missing.length) problems.push(`${label} does not deny ${missing.join(', ')} via ${rules.denies.flag}.`);
  }

  if (rules.allows) {
    const { flag, only } = rules.allows;
    const named = everyValueOf(plan.args, flag).flatMap((value) => value.split(',').map((tool) => tool.trim()));
    const extra = named.filter((tool) => tool && !only.includes(tool));
    if (!named.length || named.includes('')) problems.push(`${label} is spawned without a ${flag} list, which leaves every tool on.`);
    if (extra.length) problems.push(`${label} switches on ${extra.join(', ')} via ${flag}.`);
  }

  for (const [name, value] of Object.entries(rules.env ?? {})) {
    if (plan.env?.[name] !== value) problems.push(`${label} is spawned without ${name}=${value}.`);
  }

  for (const name of rules.envIsCwd ?? []) {
    if (plan.env?.[name] !== plan.cwd) problems.push(`${label} is spawned with a ${name} other than the folder it runs in.`);
  }

  for (const [name, needles] of Object.entries(rules.envContains ?? {})) {
    const missing = needles.filter((needle) => !plan.env?.[name]?.includes(needle));
    if (missing.length) problems.push(`${label} is spawned with a ${name} missing ${missing.join(', ')}.`);
  }

  for (const path of rules.files) {
    if (!plan.files?.some((file) => file.path === path)) {
      problems.push(`${label} is spawned without ${path} in its workspace.`);
    }
  }

  for (const [path, needles] of Object.entries(rules.fileContains ?? {})) {
    const content = plan.files?.find((file) => file.path === path)?.content;
    if (content === undefined) continue;
    const missing = needles.filter((needle) => !content.includes(needle));
    if (missing.length) problems.push(`${label} writes a ${path} missing ${missing.join(', ')}.`);
  }

  for (const command of plan.prepare ?? []) {
    const allowed = (rules.prepare ?? []).some(
      (expected) => expected.length === command.length && expected.every((arg, i) => arg === command[i]),
    );
    if (!allowed) problems.push(`${label} would run "${command.join(' ')}" before its turn, which is not a set-up step it is allowed.`);
  }

  for (const clause of rules.inspect?.(plan) ?? []) problems.push(`${label} ${clause}.`);

  return problems;
}

/** One line for the daemon log, so a weakly contained runner says so out loud. */
export function describeContainment(kind: AgentKind): string {
  return `${AGENTS[kind].label} containment: ${CONTAINMENT[kind].localTools} — ${CONTAINMENT[kind].note}`;
}

/**
 * Names that read as a credential wherever they come from. Matched on word boundaries
 * so `SESSION_TOKEN` goes and `SESSIONS_DIR` stays.
 */
const SECRET_WORD =
  /(?:^|_)(?:KEY|KEYS|TOKEN|TOKENS|SECRET|SECRETS|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|AUTH|SESSION|COOKIE|PRIVATE|SIGNATURE)(?:$|_)/i;

/** Vendors whose whole namespace is credentials or account state. */
const SECRET_PREFIX: readonly string[] = [
  'AWS_', 'AZURE_', 'GCP_', 'GOOGLE_', 'GH_', 'GITHUB_', 'GITLAB_', 'BITBUCKET_',
  'NPM_', 'YARN_', 'PYPI_', 'CARGO_', 'DOCKER_', 'KUBE_', 'HELM_',
  'STRIPE_', 'SLACK_', 'TWILIO_', 'SENDGRID_', 'SENTRY_', 'DATADOG_', 'PAGERDUTY_',
  'DATABASE_', 'POSTGRES_', 'PGPASS', 'MYSQL_', 'REDIS_', 'MONGO_', 'SUPABASE_',
  'OPENAI_', 'ANTHROPIC_', 'GEMINI_', 'CLAUDE_', 'CODEX_', 'ANTIGRAVITY_', 'MISTRAL_', 'XAI_', 'GROK_', 'CURSOR_', 'HF_', 'HUGGINGFACE_',
  'QWEN_', 'DASHSCOPE_', 'BAILIAN_', 'OPENCODE_', 'DEEPSEEK_', 'DSH_',
  'VERCEL_', 'NETLIFY_', 'CLOUDFLARE_', 'FLY_', 'HEROKU_', 'RAILWAY_',
];

/**
 * The environment a run may see: the parent's, minus anything credential-shaped that
 * does not belong to the agent being spawned.
 *
 * Deny by shape rather than allow by name on purpose — an allowlist that misses `PATH`
 * or some CLI's config variable breaks the run, and the failure looks like a bug in the
 * agent rather than a policy decision. This direction fails toward working, and the
 * harness pins the cases that matter.
 *
 * The agent's own vendor prefix is kept because that is how these CLIs authenticate. A
 * Codex run keeps `OPENAI_*` and loses `ANTHROPIC_*`, `AWS_*` and the rest.
 */
export function sealEnv(kind: AgentKind, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const keeps = keepsFor(CONTAINMENT[kind], env);
  const sealed: NodeJS.ProcessEnv = {};

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (keeps.some((prefix) => name.startsWith(prefix))) {
      sealed[name] = value;
      continue;
    }
    if (SECRET_WORD.test(name)) continue;
    if (SECRET_PREFIX.some((prefix) => name.startsWith(prefix))) continue;
    sealed[name] = value;
  }

  return sealed;
}

/** An agent's own prefixes, widened by whichever federated backend it is pointed at. */
function keepsFor(rules: Containment, env: NodeJS.ProcessEnv): readonly string[] {
  const keeps = [...rules.keepsEnv];
  for (const [flag, prefixes] of Object.entries(rules.federated ?? {})) {
    if (enabled(env[flag])) keeps.push(...prefixes);
  }
  return keeps;
}

function enabled(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

/** Names dropped from `env` by `sealEnv`, for the daemon log. */
export function sealedAway(kind: AgentKind, env: NodeJS.ProcessEnv): string[] {
  const sealed = sealEnv(kind, env);
  return Object.keys(env).filter((name) => !(name in sealed));
}

/** The value after each occurrence of a flag that is repeated rather than variadic. */
function everyValueOf(args: readonly string[], flag: string): string[] {
  return args.flatMap((arg, at) => (arg === flag && at + 1 < args.length ? [args[at + 1]] : []));
}

/** Values following a flag, up to the next flag. */
function variadic(args: readonly string[], flag: string): string[] {
  const at = args.indexOf(flag);
  if (at === -1) return [];
  const values: string[] = [];
  for (let i = at + 1; i < args.length && !args[i].startsWith('--'); i++) values.push(args[i]);
  return values;
}

/**
 * Whether `child` is `parent` or lies under it, by the platform's own path rules: Windows spells a
 * path with backslashes and compares it case-blind, and a `..` climbs out whatever the prefix says.
 */
export function within(child: string, parent: string, path: typeof posix = process.platform === 'win32' ? win32 : posix): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
