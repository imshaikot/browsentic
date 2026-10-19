import type { TokenUsage } from '@/lib/actions/protocol';
import type { AgentKind, AgentProblem } from '@/lib/agents/catalog';
import type { FileKind } from '@/lib/files/report';
import type { AgentSettings } from '../config';
import type { ToolDelivery } from '../../control';
import type { ToolHost } from '../../tool-host';

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
  /** Written to the CLI's stdin, which is then closed: what is too long, or too page-made, for argv. */
  input?: string;
  /**
   * Commands of the same CLI run in `cwd` once its files are written and before the turn starts,
   * for set-up no flag can say. Each one is vetted like the turn's own argv.
   */
  prepare?: string[][];
}

/** What a CLI does to every tool call, which the daemon has to work inside of. */
export interface CallLimits {
  /** The CLI abandons a call that takes longer than this, whatever it is waiting on. */
  callMs?: number;
  /** The CLI keeps a call's text from the model when it is longer than this many UTF-8 bytes. */
  resultBytes?: number;
}

export interface StreamContext {
  runId: string;
  /** The panel conversation this run belongs to, which every turn of it shares — unlike `runId`. */
  conversation: string | null;
  instruction: string;
  systemPrompt: string;
  research: boolean;
  settings: AgentSettings;
  /** A session this same agent established earlier in the conversation, or null to start fresh. */
  sessionId: string | null;
  workspace: string;
  mcp: McpServer;
  /** Every tool that server will offer, for a CLI that grants MCP tools one name at a time. */
  mcpTools: string[];
  /** The run's browser tools served in this process, for a CLI that takes tools other than over MCP. */
  tools: () => Promise<ToolHost>;
  /** Settles once the run's MCP server has handed its tool list to the CLI, for a CLI that does not wait for it. */
  toolsListed: () => Promise<void>;
  /** The CLI's `--version` line as last probed, for a runner whose CLI changed its flags between releases. */
  version?: string;
}

export interface JsonContext {
  prompt: string;
  settings: AgentSettings;
  version?: string;
  workspace: string;
  /** The prompt names a file in the workspace that the agent has to open. */
  reads: boolean;
  /** That file is this picture, for a CLI that takes an image attached rather than opened. */
  image?: string;
}

export interface StreamSink {
  text(delta: string): void;
  /** A tool the daemon cannot see itself — web search and the like. MCP calls report themselves. */
  tool(toolId: string, name: string): void;
  /** That tool finished. A CLI that never says so leaves the row open until the turn ends. */
  toolResult(toolId: string, ok: boolean): void;
  session(id: string): void;
  /** Token counts this CLI reported, normalized to the shared shape. Optional — not every CLI reports them. */
  usage(usage: TokenUsage): void;
  done(stopReason: string): void;
  fail(code: string, message: string): void;
}

export type StreamReader = (line: string, sink: StreamSink) => void;

export interface ConversationIO {
  write(message: unknown): void;
}

/**
 * A CLI spoken to over stdin for the length of a turn rather than handed it on argv: it is sent
 * `open`'s messages as it starts, and each line it prints may be answered.
 */
export interface Conversation {
  plan: Plan;
  open(io: ConversationIO): void;
  read(line: string, sink: StreamSink, io: ConversationIO): void;
  /** Whether it got as far as holding a session. One that ends before is refused, not failed. */
  readonly holding: boolean;
  /** It was refused — told so, or it ended before holding a session — so later turns need not ask again. */
  declined(reason: string): void;
}

/** A conversation the CLI would not hold; the turn is run through `stream()` instead. */
export const CONVERSATION_REFUSED = 'CONVERSATION_REFUSED';

export interface Listing {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** A subcommand that prints the models the account can use. */
export interface CommandLister {
  args: string[];
  /** Set for the listing alone, over the sealed environment every spawn of the agent gets. */
  env?(cwd: string): Record<string, string>;
  /** What the list depends on besides the CLI itself, such as its sign-ins: a change reads it again. */
  stamp?(): string | undefined;
  parse(listing: Listing): string[] | null;
}

/** A file the CLI keeps its model list in. */
export interface FileLister {
  file(): string;
  parse(content: string): string[] | null;
}

/**
 * Where a CLI lists the models its account can use. `parse` answers null for anything but a clean
 * list — signed out included.
 */
export type ModelLister = CommandLister | FileLister;

export interface Runner {
  kind: AgentKind;
  /** Arguments that make the binary print its version, used to prove it is installed. */
  versionArgs: string[];
  /** Reasoning-effort names this CLI accepts; anything else is dropped. */
  efforts: string[];
  workspace(mode: RunMode): string;
  /** Directories where this CLI keeps the user's own skills, feeding the panel's skill picker. */
  skillDirs?(): string[];
  /** Absent, or none for the version probed: the picker offers the catalog's curated models. */
  models?: ModelLister | ((version?: string) => ModelLister | undefined);
  stream(context: StreamContext): Plan;
  /** A conversation to hold for this turn instead, where the CLI offers one; null to use `stream`. */
  converse?(context: StreamContext): Conversation | null;
  /** Fresh per run — readers carry state across lines. */
  reader(): StreamReader;
  /** This CLI's stream has no closing event, so exiting cleanly is how it says the turn is over. */
  endsOnExit?: boolean;
  /**
   * A resumed session goes on sending the system prompt it began with, whatever a later turn
   * passes, so what changed since has to reach it in the turn's own message.
   */
  keepsFirstPrompt?: boolean;
  /** Limits this CLI puts on a browser tool call; unset where it waits and takes whatever comes. */
  limits?: CallLimits;
  /** How a run's grouped browser tools reach the model with these settings; `listed` when unsaid. */
  delivery?(settings: AgentSettings): ToolDelivery;
  json(context: JsonContext): Plan;
  /** What a one-shot of this CLI is known to open when handed a file. Text alone when unsaid. */
  opens?: readonly FileKind[];
  answer(stdout: string): { text?: string; error?: string };
  /** Turns a stderr tail into something more useful than "exited with code 1". */
  hint?(stderrTail: string): string | null;
  /** Anything beyond "the binary is installed" that has to be true before a run, for the `--version` line just probed. */
  check?(settings: AgentSettings, version?: string): Promise<AgentProblem | null>;
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
