export const AGENT_KINDS = ['claude', 'codex', 'antigravity', 'vibe', 'grok', 'cursor', 'qwen', 'opencode'] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const DEFAULT_AGENT: AgentKind = 'claude';

export interface AgentDescriptor {
  kind: AgentKind;
  label: string;
  vendor: string;
  bin: string;
  install: string;
  docs: string;
  /** Model ids the picker offers, strongest first. Curated, not queried — the CLIs have no list command. */
  models: string[];
  /** Shipped before a whole conversation was run against the real CLI; the picker and the docs say so. */
  beta?: boolean;
}

export const AGENTS: Record<AgentKind, AgentDescriptor> = {
  claude: {
    kind: 'claude',
    label: 'Claude Code',
    vendor: 'Anthropic',
    bin: 'claude',
    install: 'npm i -g @anthropic-ai/claude-code',
    docs: 'https://claude.com/claude-code',
    models: ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  codex: {
    kind: 'codex',
    label: 'Codex',
    vendor: 'OpenAI',
    bin: 'codex',
    install: 'npm i -g @openai/codex',
    docs: 'https://developers.openai.com/codex/cli',
    models: ['gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
  },
  antigravity: {
    kind: 'antigravity',
    label: 'Antigravity',
    vendor: 'Google',
    bin: 'agy',
    install: 'https://antigravity.google/docs/cli/install',
    docs: 'https://antigravity.google/docs/cli',
    models: ['gemini-3-pro', 'gemini-3-flash'],
  },
  vibe: {
    kind: 'vibe',
    label: 'Mistral Vibe',
    vendor: 'Mistral AI',
    bin: 'vibe',
    install: 'uv tool install mistral-vibe',
    docs: 'https://github.com/mistralai/mistral-vibe',
    models: ['mistral-medium-3.5'],
    beta: true,
  },
  grok: {
    kind: 'grok',
    label: 'Grok Build',
    vendor: 'xAI',
    bin: 'grok',
    install: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    docs: 'https://docs.x.ai/build/overview',
    models: ['grok-4.7'],
    beta: true,
  },
  cursor: {
    kind: 'cursor',
    label: 'Cursor CLI',
    vendor: 'Anysphere',
    bin: 'cursor-agent',
    install: 'curl https://cursor.com/install -fsS | bash',
    docs: 'https://cursor.com/docs/cli/overview',
    // `cursor-agent models` lists the account's own set, but it needs a login, so these are curated.
    models: ['composer-2.5', 'claude-opus-4-8', 'gpt-5', 'sonnet-4-thinking'],
    beta: true,
  },
  qwen: {
    kind: 'qwen',
    label: 'Qwen Code',
    vendor: 'Alibaba',
    bin: 'qwen',
    install: 'npm i -g @qwen-code/qwen-code',
    docs: 'https://qwenlm.github.io/qwen-code-docs/en/',
    // Which of these an account can reach depends on the provider it is pointed at, and no
    // subcommand lists them, so these are curated.
    models: ['qwen3-coder-plus', 'qwen3.7-plus', 'qwen3.6-plus', 'qwen3-max-2026-01-23'],
    beta: true,
  },
  opencode: {
    kind: 'opencode',
    label: 'OpenCode',
    vendor: 'Anomaly',
    bin: 'opencode',
    install: 'npm i -g opencode-ai',
    docs: 'https://opencode.ai/docs/cli/',
    // Spelled provider/model, and reachable only through a provider OpenCode is signed in to: Zen's
    // free models refuse a run whose tools are narrowed to the browser.
    models: ['anthropic/claude-opus-5-5', 'anthropic/claude-sonnet-5', 'openai/gpt-5.6', 'google/gemini-3.1-pro-preview'],
    beta: true,
  },
};

export const AGENT_LIST: AgentDescriptor[] = AGENT_KINDS.map((kind) => AGENTS[kind]);

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value);
}

export interface AgentProblem {
  code: 'AGENT_MISSING' | 'AGENT_UNUSABLE' | 'AGENT_NEEDS_PERMISSION';
  message: string;
  /** What the user can do about it — a shell command, a URL, or a line of config. */
  fix?: string;
  /** The daemon can repair this itself if the user asks it to. */
  grantable?: boolean;
}

export interface RunnerStatus {
  kind: AgentKind;
  bin: string;
  ready: boolean;
  version?: string;
  /** The model this runner will be spawned with; unset means the CLI's own default. */
  model?: string;
  problem?: AgentProblem;
}

export interface AgentState {
  active: AgentKind;
  runners: RunnerStatus[];
}

export function activeRunner(state: AgentState | undefined): RunnerStatus | undefined {
  return state?.runners.find((runner) => runner.kind === state.active);
}
