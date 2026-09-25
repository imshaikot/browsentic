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

import { AGENTS, isModelId, type AgentKind } from '@/lib/agents/catalog';

/** `run` drives the browser; `task` is a one-shot that must not reach it at all. */
export type SpawnMode = 'run' | 'task';

/** Structural view of a runner's `Plan`. Kept local so guardrails never import runners. */
export interface SpawnPlan {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly files?: readonly { readonly path: string; readonly content: string }[];
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
}

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
  readonly run: Requirements;
  readonly task: Requirements;
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
    note: 'no per-run tool list; the read-only sandbox is the whole containment, so the agent can still read any file the user can',
    run: {
      // Sub-agents are spawned outside the run's gate and report nothing to the panel.
      required: ['sandbox_mode="read-only"', 'approval_policy="never"', 'features.multi_agent=false'],
      pairs: [],
      files: [],
    },
    task: {
      required: ['sandbox_mode="read-only"', 'approval_policy="never"', 'mcp_servers={}', 'features.multi_agent=false'],
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
      // The deny rules are the containment, so the file has to still carry them at spawn.
      fileContains: {
        '.cursor/cli.json': ['"Shell(*)"', '"Write(**)"', '"Read(**)"', '"Mcp(browsentic:*)"'],
        '.cursor/sandbox.json': ['"workspace_readonly"'],
      },
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
    // `--auto` approves whatever is not denied, `--attach` runs the turn in a server started with someone
    // else's config, `--dir` moves it out of the workspace, and `--share` publishes it.
    forbidden: [/^--auto$/i, /^--attach/i, /^--dir/i, /^--share$/i],
    note:
      'a per-run permission ruleset opening on "*": "deny", which OpenCode applies after the user’s own rules, ' +
      'so the model is offered no tool that was not named — built-in, custom, or another MCP server’s; ' +
      'external plugins and project config stay off, but MCP servers the user gave OpenCode itself still start, with their tools hidden',
    run: {
      // Plugins run inside OpenCode and can add tools or answer its permission prompts.
      required: ['--pure'],
      pairs: [
        ['--agent', 'browsentic-contained'],
        ['--format', 'json'],
      ],
      env: OPENCODE_SEALED,
      envContains: { OPENCODE_CONFIG_CONTENT: OPENCODE_CONFIG },
      files: ['instructions.md'],
    },
    task: {
      required: ['--pure'],
      pairs: [
        ['--agent', 'browsentic-contained'],
        ['--format', 'json'],
      ],
      env: OPENCODE_SEALED,
      // An empty map adds no server of ours, so a one-shot has no way to the browser.
      envContains: { OPENCODE_CONFIG_CONTENT: [...OPENCODE_CONFIG, '"mcp":{}'] },
      files: [],
    },
  },
};

/**
 * Everything wrong with a plan, as sentences. Empty means it may spawn.
 *
 * Pure, so the harness can assert every runner's real plan without spawning anything.
 */
export function vetPlan(kind: AgentKind, mode: SpawnMode, plan: SpawnPlan, home: string): string[] {
  const rules = CONTAINMENT[kind][mode];
  const problems: string[] = [];
  const label = `${AGENTS[kind].label} (${mode})`;

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

  const banned = [...FORBIDDEN, ...(CONTAINMENT[kind].forbidden ?? [])];
  for (const arg of plan.args) {
    if (banned.some((pattern) => pattern.test(arg))) {
      problems.push(`${label} is spawned with ${arg}, which disables its own containment.`);
    }
  }

  for (const model of everyValueOf(plan.args, '--model')) {
    if (!isModelId(model)) problems.push(`${label} is spawned with the model ${JSON.stringify(model)}, which it could read as a flag.`);
  }

  if (!within(plan.cwd, home)) problems.push(`${label} would run in ${plan.cwd}, which is outside ${home}.`);

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
  'QWEN_', 'DASHSCOPE_', 'BAILIAN_', 'OPENCODE_',
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

function within(child: string, parent: string): boolean {
  const base = parent.endsWith('/') ? parent : `${parent}/`;
  return child === parent || child.startsWith(base);
}
