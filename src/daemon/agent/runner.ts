import { join } from 'node:path';
import type { RunEvent } from '@/lib/actions/protocol';
import type { AgentConfig } from './config';
import { runJson, runStream } from './runners/drive';
import { mcpServerFor, runnerFor } from './runners';
import { RunError, type RunOutcome } from './runners/types';

export { RunError };
export type { RunOutcome };

export interface RunRequest {
  runId: string;
  instruction: string;
  systemPrompt: string;
  config: AgentConfig;
  research?: boolean;
  /** A session this same agent established earlier in the conversation, or null to start fresh. */
  sessionId: string | null;
  signal: AbortSignal;
  emit: (event: RunEvent) => void;
}

export function runInstruction(request: RunRequest): Promise<RunOutcome> {
  const { runner, settings } = runnerFor(request.config);
  return runStream(
    runner,
    {
      runId: request.runId,
      instruction: request.instruction,
      systemPrompt: request.systemPrompt,
      research: request.research === true,
      settings,
      sessionId: request.sessionId,
      workspace: runner.workspace('run'),
      mcp: mcpServerFor(request.runId),
    },
    request.signal,
    request.emit,
  );
}

/** One-shot, no browser: summarize a file, name a conversation, read back a recording. */
export function runAgentJson(
  prompt: string,
  config: AgentConfig,
  signal: AbortSignal,
  { reads = false, timedOut, empty }: { reads?: boolean; timedOut: string; empty: string },
): Promise<string> {
  const { runner, settings } = runnerFor(config);
  return runJson(
    runner,
    { prompt, settings, reads, workspace: runner.workspace('task') },
    signal,
    { timedOut, empty },
  );
}

/** Where a one-shot's scratch files go — inside the agent's own workspace, so it is allowed to read them. */
export function taskDir(config: AgentConfig): string {
  return join(runnerFor(config).runner.workspace('task'), 'tmp');
}
