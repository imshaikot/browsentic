import type { AgentKind, AgentProblem } from '@/lib/agents/catalog';
import type { AgentSettings } from '../config';

/** `run` drives the browser and resumes conversations; `task` is a one-shot with no browser. */
export type RunMode = 'run' | 'task';

export interface McpServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** A file the runner needs sitting in its working directory before the CLI starts. */
export interface WorkspaceFile {
  path: string;
  content: string;
}

export interface Plan {
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  files?: WorkspaceFile[];
}

export interface StreamContext {
  runId: string;
  instruction: string;
  systemPrompt: string;
  research: boolean;
  settings: AgentSettings;
  /** A session this same agent established earlier in the conversation, or null to start fresh. */
  sessionId: string | null;
  workspace: string;
  mcp: McpServer;
}

export interface JsonContext {
  prompt: string;
  settings: AgentSettings;
  workspace: string;
  /** The prompt names a file in the workspace that the agent has to open. */
  reads: boolean;
}

export interface StreamSink {
  text(delta: string): void;
  /** A tool the daemon cannot see itself — web search and the like. MCP calls report themselves. */
  tool(toolId: string, name: string): void;
  session(id: string): void;
  done(stopReason: string): void;
  fail(code: string, message: string): void;
}

export type StreamReader = (line: string, sink: StreamSink) => void;

export interface Runner {
  kind: AgentKind;
  /** Arguments that make the binary print its version, used to prove it is installed. */
  versionArgs: string[];
  /** Reasoning-effort names this CLI accepts; anything else is dropped. */
  efforts: string[];
  workspace(mode: RunMode): string;
  /** Directories where this CLI keeps the user's own skills, feeding the panel's skill picker. */
  skillDirs?(): string[];
  stream(context: StreamContext): Plan;
  /** Fresh per run — readers carry state across lines. */
  reader(): StreamReader;
  json(context: JsonContext): Plan;
  answer(stdout: string): { text?: string; error?: string };
  /** Turns a stderr tail into something more useful than "exited with code 1". */
  hint?(stderrTail: string): string | null;
  /** Anything beyond "the binary is installed" that has to be true before a run. */
  check?(settings: AgentSettings): Promise<AgentProblem | null>;
  /** Repairs what `check` reported, when the user asks for it. */
  grant?(): Promise<AgentProblem | null>;
}

export interface RunOutcome {
  stopReason: string;
  /** The session the agent established, to resume on the next turn. */
  sessionId: string | null;
}

export class RunError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RunError';
  }
}
