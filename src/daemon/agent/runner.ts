import { join } from 'node:path';
import type { RunEvent } from '@/lib/actions/protocol';
import { fenceTag, policyFrom } from '../guardrails';
import { readLockfile } from '../lockfile';
import { RemoteBridge } from '../remote-bridge';
import { toolHost, type ToolHost } from '../tool-host';
import type { AgentConfig } from './config';
import { runJson, runStream, type JsonOptions } from './runners/drive';
import { mcpServerFor, runnerFor } from './runners';
import { RunError, type RunOutcome } from './runners/types';

export { RunError };
export type { RunOutcome };

export interface RunRequest {
  runId: string;
  /** The conversation the panel is holding, which outlives this one run. */
  conversation: string | null;
  instruction: string;
  systemPrompt: string;
  config: AgentConfig;
  research?: boolean;
  /** A session this same agent established earlier in the conversation, or null to start fresh. */
  sessionId: string | null;
  /** The tools the run's MCP server will offer, by the names it lists them under. */
  mcpTools: string[];
  signal: AbortSignal;
  emit: (event: RunEvent) => void;
}

export async function runInstruction(request: RunRequest): Promise<RunOutcome> {
  const { runner, settings } = runnerFor(request.config);
  const tools = inProcessTools(request.runId, request.config);
  try {
    return await runStream(
      runner,
      {
        runId: request.runId,
        conversation: request.conversation,
        instruction: request.instruction,
        systemPrompt: request.systemPrompt,
        research: request.research === true,
        settings,
        sessionId: request.sessionId,
        workspace: runner.workspace('run'),
        mcp: mcpServerFor(request.runId, runner.limits),
        mcpTools: request.mcpTools,
        tools: tools.open,
      },
      request.signal,
      request.emit,
    );
  } finally {
    tools.close();
  }
}

/**
 * The run's tools served here, for a CLI that takes them other than over MCP. They go through the
 * daemon's own control socket under the run's id — the door its MCP server would use — so a call is
 * gated, shown and answered exactly as one made over MCP. Opened on first use, closed with the run.
 */
function inProcessTools(runId: string, config: AgentConfig): { open: () => Promise<ToolHost>; close: () => void } {
  let bridge: Promise<RemoteBridge> | undefined;
  let host: Promise<ToolHost> | undefined;
  const connect = () => {
    const lock = readLockfile();
    if (!lock) return Promise.reject(new RunError('AGENT_FAILED', 'The daemon has no lockfile to reach its own tools through.'));
    return RemoteBridge.connect(lock.port, lock.token, runId);
  };
  return {
    open: () => (host ??= (bridge = connect()).then((connected) => toolHost(connected, { agentRun: true, policy: policyFrom(config.guardrails), tag: fenceTag() }))),
    close: () => void bridge?.then((connected) => connected.close()).catch(() => {}),
  };
}

/** One-shot, no browser: summarize a file, name a conversation, read back a recording. */
export function runAgentJson(
  prompt: string,
  config: AgentConfig,
  signal: AbortSignal,
  { reads = false, image, ...options }: JsonOptions & { reads?: boolean; image?: string },
): Promise<string> {
  const { runner, settings } = runnerFor(config);
  return runJson(runner, { prompt, settings, reads, image, workspace: runner.workspace('task') }, signal, options);
}

/** Where a one-shot's scratch files go — inside the agent's own workspace, so it is allowed to read them. */
export function taskDir(config: AgentConfig): string {
  return join(runnerFor(config).runner.workspace('task'), 'tmp');
}
