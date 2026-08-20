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
 * failing check. So the plan is vetted here — at `launch()`, the one place all three
 * runners pass through, before `spawn()` — and a plan that has lost its containment
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

import { AGENTS, type AgentKind } from '@/lib/agents/catalog';

/** `run` drives the browser; `task` is a one-shot that must not reach it at all. */
export type SpawnMode = 'run' | 'task';

/** Structural view of a runner's `Plan`. Kept local so guardrails never import runners. */
export interface SpawnPlan {
  readonly args: readonly string[];
  readonly cwd: string;
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

interface Requirements {
  /** Arguments the plan must carry verbatim. */
  readonly required: readonly string[];
  /** `--flag value` pairs the plan must carry. */
  readonly pairs: readonly (readonly [string, string])[];
  /** Tools the plan must name after a deny flag. */
  readonly denies?: ToolDenial;
  /** Workspace files the plan must write before the CLI starts. */
  readonly files: readonly string[];
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
  /** Why this runner is only as contained as it is. Logged once per run. */
  readonly note: string;
  readonly run: Requirements;
  readonly task: Requirements;
}

/**
 * Flags that hand a CLI the machine, in every spelling the three of them use. Checked
 * against every runner rather than only the one that owns each flag: the cost is
 * nothing and it covers the runner nobody has written yet.
 */
const FORBIDDEN: readonly RegExp[] = [
  /^--dangerously/i,
  /^--yolo$/i,
  /^--full-auto$/i,
  /^--no-sandbox$/i,
  /^--allow-all/i,
  /danger-full-access/i,
  /^--sandbox=?(workspace-write|danger-full-access)$/i,
  /^--permission-mode=?(bypassPermissions|acceptEdits)$/i,
];

/** Local tools no run may ever have, whatever else it is allowed. */
const NEVER = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep', 'Task'];

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
      required: [],
      pairs: [
        ['--sandbox', 'read-only'],
        ['--ask-for-approval', 'never'],
      ],
      files: [],
    },
    task: {
      required: ['mcp_servers={}'],
      pairs: [
        ['--sandbox', 'read-only'],
        ['--ask-for-approval', 'never'],
      ],
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

  for (const [flag, value] of rules.pairs) {
    if (valueOf(plan.args, flag) !== value) problems.push(`${label} is spawned without ${flag} ${value}.`);
  }

  if (rules.denies) {
    const named = variadic(plan.args, rules.denies.flag);
    const missing = rules.denies.tools.filter((tool) => !named.includes(tool));
    if (missing.length) problems.push(`${label} does not deny ${missing.join(', ')} via ${rules.denies.flag}.`);
  }

  for (const path of rules.files) {
    if (!plan.files?.some((file) => file.path === path)) {
      problems.push(`${label} is spawned without ${path} in its workspace.`);
    }
  }

  for (const arg of plan.args) {
    if (FORBIDDEN.some((pattern) => pattern.test(arg))) {
      problems.push(`${label} is spawned with ${arg}, which disables its own containment.`);
    }
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
  'OPENAI_', 'ANTHROPIC_', 'GEMINI_', 'CLAUDE_', 'CODEX_', 'ANTIGRAVITY_', 'HF_', 'HUGGINGFACE_',
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

function valueOf(args: readonly string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
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
