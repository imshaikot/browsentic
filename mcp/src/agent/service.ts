import { randomUUID } from 'node:crypto';
import { failure, type ActionResult, type ExtensionRequest, type RunEvent } from '@/lib/actions/protocol';
import { log } from '../log';
import { readAgentConfig, type AgentConfig } from './config';
import { RunError, runInstruction } from './runner';
import { loadSkills, routeSkill, skillDirs } from './skills';

export interface AgentSessionDeps {
  /** The daemon's own invoke path, so the agent reaches the browser exactly as MCP clients do. */
  invoke: (action: string, input?: unknown) => Promise<ActionResult>;
  emit: (runId: string, event: RunEvent) => void;
}

interface ActiveRun {
  id: string;
  config: AgentConfig;
  abort: AbortController;
  /** Approvals the run is blocked on, keyed by tool-use id. */
  pending: Map<string, (allow: boolean) => void>;
}

/**
 * One browser's agent state: the Claude Code session its conversation lives in and the run it
 * is in the middle of. Created when an extension connects and dropped when it disconnects, so
 * a reconnecting browser starts clean rather than resuming a conversation about a page that
 * has moved on.
 */
export class AgentSession {
  /** The `claude --resume` id. Null until a run establishes it; null again after `reset`. */
  private claudeSession: string | null = null;
  private active: ActiveRun | null = null;

  constructor(private readonly deps: AgentSessionDeps) {}

  handle(request: ExtensionRequest): void {
    switch (request.t) {
      case 'instruct':
        void this.start(request.id, request.text);
        return;
      case 'cancel':
        this.cancel(request.id);
        return;
      case 'decision':
        this.active?.pending.get(request.toolId)?.(request.allow);
        return;
      case 'reset':
        this.claudeSession = null;
        log('agent conversation reset');
        return;
    }
  }

  /**
   * A browser invocation made on behalf of a run — the spawned Claude Code tags its tool calls
   * with the run id from its environment, and the daemon routes them here. This is where the
   * timeline learns about tool calls, and where gated actions stop until the user decides.
   */
  async invokeForRun(runId: string, action: string, input?: unknown): Promise<ActionResult> {
    const run = this.active;
    if (!run || run.id !== runId) {
      // A cancelled or superseded agent does not get to keep driving the browser.
      return failure('RUN_INACTIVE', 'This agent run is no longer active');
    }
    const emit = (event: RunEvent) => this.deps.emit(runId, event);
    const toolId = randomUUID();
    emit({ kind: 'tool', toolId, action, input });

    if (run.config.requireApproval.includes(action)) {
      emit({ kind: 'approval', toolId, action, input });
      if (!(await this.awaitDecision(run, toolId))) {
        emit({ kind: 'toolResult', toolId, ok: false, summary: 'declined by the user' });
        return failure(
          'DECLINED',
          'The user declined this action. Do not retry it and do not try to achieve the same effect another way. Tell the user it was declined and stop.',
        );
      }
    }

    const result = await this.deps.invoke(action, input);
    log(`agent → ${action} ${result.ok ? 'ok' : result.error.code}`);
    emit({ kind: 'toolResult', toolId, ok: result.ok, summary: summarize(input, result) });
    return result;
  }

  /** Called when the browser goes away mid-run, so nothing is left waiting on a dead socket. */
  dispose(): void {
    if (this.active) this.cancel(this.active.id);
    this.claudeSession = null;
  }

  private async start(runId: string, instruction: string): Promise<void> {
    const emit = (event: RunEvent) => this.deps.emit(runId, event);

    const text = instruction.trim();
    if (!text) return emit({ kind: 'error', code: 'INVALID_INPUT', message: 'Say what you want done.' });
    if (this.active) {
      return emit({
        kind: 'error',
        code: 'RUN_IN_PROGRESS',
        message: 'Another instruction is still running — cancel it first.',
      });
    }

    const routed = routeSkill(loadSkills(), text);
    if (!routed) {
      return emit({
        kind: 'error',
        code: 'NO_SKILL',
        message: `No skills found. Looked in ${skillDirs.join(' and ')} — reinstall the package, or add a skill of your own.`,
      });
    }

    const run: ActiveRun = { id: runId, config: readAgentConfig(), abort: new AbortController(), pending: new Map() };
    this.active = run;
    log(`agent run ${runId} started with skill "${routed.skill.name}"`);
    emit({ kind: 'started', skill: routed.skill.name });

    const resume = this.claudeSession !== null;
    const sessionId = this.claudeSession ?? randomUUID();

    try {
      const outcome = await runInstruction({
        runId,
        instruction: routed.text,
        skill: routed.skill,
        config: run.config,
        sessionId,
        resume,
        signal: run.abort.signal,
        emit,
      });
      // Only a session Claude Code actually created can be resumed by the next instruction.
      if (outcome.established) this.claudeSession = sessionId;
      log(`agent run ${runId} finished (${outcome.stopReason})`);
      emit({ kind: 'done', stopReason: outcome.stopReason });
    } catch (error) {
      const { code, message } = error instanceof RunError ? error : new RunError('AGENT_FAILED', String(error));
      log(`agent run ${runId} failed: ${code}: ${message}`);
      emit({ kind: 'error', code, message });
    } finally {
      // Only clear if this run is still the current one; a cancel may already have moved on.
      if (this.active === run) this.active = null;
    }
  }

  private cancel(runId: string): void {
    if (!this.active || this.active.id !== runId) return;
    // Release anything blocked on approval first — an aborted run would otherwise leave a
    // tool call awaiting a promise that can never settle.
    for (const [, settle] of this.active.pending) settle(false);
    this.active.pending.clear();
    this.active.abort.abort();
    log(`agent run ${runId} cancelled`);
  }

  private awaitDecision(run: ActiveRun, toolId: string): Promise<boolean> {
    if (run.abort.signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const settle = (allow: boolean) => {
        run.pending.delete(toolId);
        resolve(allow);
      };
      run.pending.set(toolId, settle);
      run.abort.signal.addEventListener('abort', () => settle(false), { once: true });
    });
  }
}

const SUMMARY_LIMIT = 80;

/** A one-line "what just happened" for the timeline — the detail, not the action name. */
function summarize(input: unknown, result: ActionResult): string {
  if (!result.ok) return clip(`${result.error.code}: ${result.error.message}`);

  // A screenshot's data is an image; describe it rather than dumping the base64 or the target.
  const shot = result.data as { dataUrl?: unknown; width?: unknown; height?: unknown; savedTo?: unknown } | null;
  if (shot && typeof shot.dataUrl === 'string') {
    const saved = typeof shot.savedTo === 'string' ? ` → ${shot.savedTo.split('/').pop()}` : '';
    return clip(`image ${shot.width ?? '?'}×${shot.height ?? '?'}${saved}`);
  }

  const target = (input as { target?: { text?: string; selector?: string } } | undefined)?.target;
  if (target?.text) return clip(`“${target.text}”`);
  if (target?.selector) return clip(target.selector);

  const data = result.data as Record<string, unknown> | null;
  for (const key of ['navigatedTo', 'navigatingTo', 'url', 'performed', 'value']) {
    const value = data?.[key];
    if (typeof value === 'string' && value) return clip(value);
  }
  return 'done';
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_LIMIT ? `${flat.slice(0, SUMMARY_LIMIT - 1)}…` : flat;
}
