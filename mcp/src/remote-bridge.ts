import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { failure, type ActionResult } from '@/lib/actions/protocol';
import type { ToolDescriptor } from '@/lib/actions/manifest';
import type { Bridge, BridgeStatus, ControlMessage, ControlRequest, SessionSummary } from './control';

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

  async describe(): Promise<ToolDescriptor[]> {
    const reply = await this.request({ id: randomUUID(), op: 'describe' });
    return reply && 'tools' in reply ? reply.tools : [];
  }

  async invoke(action: string, input?: unknown): Promise<ActionResult> {
    const reply = await this.request({ id: randomUUID(), op: 'invoke', action, input, runId: this.runId });
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

  async revoke(origin?: string): Promise<number> {
    const reply = await this.request({ id: randomUUID(), op: 'revoke', origin });
    return reply && 'revoked' in reply ? reply.revoked : 0;
  }

  onManifestChanged(listener: () => void): void {
    this.manifestListeners.add(listener);
  }

  async close(): Promise<void> {
    this.socket.close(1000, 'client exiting');
  }

  private request(request: ControlRequest): Promise<ControlMessage | null> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        resolve(null);
      }, REQUEST_TIMEOUT_MS);
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
