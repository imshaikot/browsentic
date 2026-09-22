export const AGENT_KINDS = ['claude', 'codex', 'antigravity', 'vibe', 'grok'] as const;

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
  },
  grok: {
    kind: 'grok',
    label: 'Grok Build',
    vendor: 'xAI',
    bin: 'grok',
    install: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    docs: 'https://docs.x.ai/build/overview',
    models: ['grok-4.7'],
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
