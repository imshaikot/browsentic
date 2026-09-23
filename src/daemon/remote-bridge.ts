import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { awaitMonitor } from '@/lib/actions/page/await-monitor';
import { PICK_DEFAULT_TIMEOUT_MS, pickElement } from '@/lib/actions/page/pick-element';
import { SOLVE_CAPTCHA_TIMEOUT_MS, solveCaptcha } from '@/lib/actions/page/solve-captcha';
import { startMonitor } from '@/lib/actions/page/start-monitor';
import { failure, type ActionResult } from '@/lib/actions/protocol';
import type { AgentKind, AgentState } from '@/lib/agents/catalog';
import { AWAIT_DEFAULT_TIMEOUT_MS } from '@/lib/monitor/events';
import type { Bridge, BridgeStatus, ControlMessage, ControlRequest, Described, SessionSummary } from './control';

const REQUEST_TIMEOUT_MS = 60_000;

export class RemoteBridge implements Bridge {
  private readonly pending = new Map<string, (message: ControlMessage) => void>();
  private readonly manifestListeners = new Set<() => void>();

  private constructor(
    private readonly socket: WebSocket,
    private readonly runId?: string,
  ) {
    socket.on('message', (raw) => this.receive(String(raw)));
  }

  static connect(port: number, token: string, runId?: string): Promise<RemoteBridge> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/control`, {
        headers: { authorization: `Bearer ${token}` },
      });
      socket.once('open', () => resolve(new RemoteBridge(socket, runId)));
      socket.once('error', reject);
    });
  }

  async describe(): Promise<Described> {
    const reply = await this.request({ id: randomUUID(), op: 'describe', runId: this.runId });
    return reply && 'tools' in reply ? { tools: reply.tools, reserved: reply.reserved } : { tools: [] };
  }

  async invoke(action: string, input?: unknown): Promise<ActionResult> {
    const reply = await this.request(
      { id: randomUUID(), op: 'invoke', action, input, runId: this.runId },
      invokeTimeoutFor(action, input),
    );
    if (reply && 'result' in reply) return reply.result;
    return failure('DAEMON_UNREACHABLE', 'The Browsentic daemon did not respond');
  }

  async status(): Promise<BridgeStatus> {
    const reply = await this.request({ id: randomUUID(), op: 'status' });
    if (reply && 'status' in reply) return reply.status;
    throw new Error('The Browsentic daemon did not respond to a status request');
  }

  async pair(): Promise<{ code: string; expiresAt: number }> {
    const reply = await this.request({ id: randomUUID(), op: 'pair' });
    if (reply && 'code' in reply) return reply;
    throw new Error('The Browsentic daemon did not issue a pairing code');
  }

  async sessions(): Promise<SessionSummary[]> {
    const reply = await this.request({ id: randomUUID(), op: 'sessions' });
    return reply && 'sessions' in reply ? reply.sessions : [];
  }

  async agent(change?: { set?: AgentKind; grant?: AgentKind }): Promise<AgentState> {
    const reply = await this.request({ id: randomUUID(), op: 'agent', ...change });
    if (reply && 'state' in reply) return reply.state;
    throw new Error('The Browsentic daemon did not answer about its agent');
  }

  /** A browser is named by its session id; an origin still unpairs every browser presenting it. */
  async revoke(browser?: string): Promise<number> {
    const named = browser?.includes('://') ? { origin: browser } : { session: browser };
    const reply = await this.request({ id: randomUUID(), op: 'revoke', ...named });
    return reply && 'revoked' in reply ? reply.revoked : 0;
  }

  onManifestChanged(listener: () => void): void {
    this.manifestListeners.add(listener);
  }

  async close(): Promise<void> {
    this.socket.close(1000, 'client exiting');
  }

  private request(request: ControlRequest, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ControlMessage | null> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(request.id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.socket.send(JSON.stringify(request));
    });
  }

  private receive(raw: string): void {
    let message: ControlMessage;
    try {
      message = JSON.parse(raw) as ControlMessage;
    } catch {
      return;
    }
    if ('event' in message) {
      if (message.event === 'manifest-changed') for (const listener of this.manifestListeners) listener();
      return;
    }
    const settle = this.pending.get(message.id);
    if (!settle) return;
    this.pending.delete(message.id);
    settle(message);
  }
}

function invokeTimeoutFor(action: string, input?: unknown): number {
  if (action === startMonitor.name) return REQUEST_TIMEOUT_MS;
  const declared = (input as { timeoutMs?: unknown } | undefined)?.timeoutMs;
  if (typeof declared === 'number' && declared > 0) return declared + 10_000;
  if (action === awaitMonitor.name) return AWAIT_DEFAULT_TIMEOUT_MS + 10_000;
  if (action === pickElement.name) return PICK_DEFAULT_TIMEOUT_MS + 10_000;
  if (action === solveCaptcha.name) return SOLVE_CAPTCHA_TIMEOUT_MS + 10_000;
  return REQUEST_TIMEOUT_MS;
}
