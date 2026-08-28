export const AGENT_KINDS = ['claude', 'codex', 'antigravity'] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export const DEFAULT_AGENT: AgentKind = 'claude';

export interface AgentDescriptor {
  kind: AgentKind;
  label: string;
  vendor: string;
  bin: string;
  install: string;
  docs: string;
}

export const AGENTS: Record<AgentKind, AgentDescriptor> = {
  claude: {
    kind: 'claude',
    label: 'Claude Code',
    vendor: 'Anthropic',
    bin: 'claude',
    install: 'npm i -g @anthropic-ai/claude-code',
    docs: 'https://claude.com/claude-code',
  },
  codex: {
    kind: 'codex',
    label: 'Codex',
    vendor: 'OpenAI',
    bin: 'codex',
    install: 'npm i -g @openai/codex',
    docs: 'https://developers.openai.com/codex/cli',
  },
  antigravity: {
    kind: 'antigravity',
    label: 'Antigravity',
    vendor: 'Google',
    bin: 'agy',
    install: 'https://antigravity.google/docs/cli/install',
    docs: 'https://antigravity.google/docs/cli',
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
  problem?: AgentProblem;
}

export interface AgentState {
  active: AgentKind;
  runners: RunnerStatus[];
}

export function activeRunner(state: AgentState | undefined): RunnerStatus | undefined {
  return state?.runners.find((runner) => runner.kind === state.active);
}
