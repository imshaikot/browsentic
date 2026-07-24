import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  failure,
  isExtensionRequest,
  parseFrame,
  type ActionResult,
  type ExtensionRequest,
  type SocketFrame,
} from '@/lib/actions/protocol';
import type { ToolDescriptor } from '@/lib/actions/manifest';
import { log } from './log';

/** Chrome kills an idle MV3 worker after 30s; socket traffic resets that timer. */
const PING_INTERVAL_MS = 20_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DESCRIBE_TIMEOUT_MS = 10_000;

interface Pending {
  resolve: (result: ActionResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** One live connection to the extension's service worker. */
export class ExtensionLink {
  readonly extensionVersion: string;
  readonly manifestHash: string;
  readonly origin: string;
  private readonly pending = new Map<string, Pending>();
  private readonly ping: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(
    private readonly socket: WebSocket,
    hello: { extensionVersion: string; manifestHash: string; origin: string },
    private readonly onClose: (link: ExtensionLink) => void,
    /** Extension-initiated frames — the agent harness. Absent means "ignore them". */
    private readonly onRequest?: (request: ExtensionRequest, link: ExtensionLink) => void,
  ) {
    this.extensionVersion = hello.extensionVersion;
    this.manifestHash = hello.manifestHash;
    this.origin = hello.origin;
    socket.on('message', (raw) => this.receive(String(raw)));
    socket.on('close', () => this.dispose('socket closed'));
    socket.on('error', (error) => {
      log('extension socket error', error);
      this.dispose('socket error');
    });
    this.ping = setInterval(() => this.send({ t: 'ping', id: randomUUID() }), PING_INTERVAL_MS);
  }

  get isOpen(): boolean {
    return !this.closed && this.socket.readyState === this.socket.OPEN;
  }

  invoke(action: string, input?: unknown): Promise<ActionResult> {
    return this.request({ t: 'invoke', id: randomUUID(), action, input }, timeoutFor(action, input));
  }

  async describe(): Promise<ToolDescriptor[] | null> {
    const result = await this.request({ t: 'describe', id: randomUUID() }, DESCRIBE_TIMEOUT_MS);
    return result.ok ? (result.data as ToolDescriptor[]) : null;
  }

  send(frame: SocketFrame): void {
    try {
      this.socket.send(JSON.stringify(frame));
    } catch (error) {
      log('failed to send frame to extension', error);
    }
  }

  close(reason: string): void {
    this.dispose(reason);
    try {
      this.socket.close(1000, reason);
    } catch {
      // Already gone.
    }
  }

  private request(frame: SocketFrame & { id: string }, timeoutMs: number): Promise<ActionResult> {
    if (!this.isOpen) {
      return Promise.resolve(failure('EXTENSION_OFFLINE', 'The VoiceLink extension is not connected'));
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        resolve(failure('TIMEOUT', `The extension did not respond within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(frame.id, { resolve, timer });
      this.send(frame);
    });
  }

  private receive(raw: string): void {
    const frame = parseFrame(raw);
    if (!frame) return log('dropped unparseable frame from extension');
    if (frame.t === 'ping') return this.send({ t: 'pong', id: frame.id });
    if (frame.t === 'pong') return;
    // Requests, not replies: their ids name an agent run, so they must not be matched
    // against `pending`, which only tracks invocations the daemon itself started.
    if (isExtensionRequest(frame)) return this.onRequest?.(frame, this);

    const id = 'id' in frame ? frame.id : undefined;
    const waiting = id ? this.pending.get(id) : undefined;
    if (!waiting || !id) return;
    this.pending.delete(id);
    clearTimeout(waiting.timer);
    if (frame.t === 'result') waiting.resolve(frame.result);
    else if (frame.t === 'manifest') waiting.resolve({ ok: true, data: frame.tools });
  }

  private dispose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ping);
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.resolve(failure('EXTENSION_OFFLINE', `Connection lost: ${reason}`));
    }
    this.pending.clear();
    this.onClose(this);
  }
}

/**
 * `page.screenshot` scrolls and captures the tab tile by tile, so its worst case (bounded by the
 * background's tile cap) far exceeds a single action's budget; give it a generous fixed window.
 * Actions that wait (only `page.waitForElement` today) declare their own `timeoutMs`.
 */
const SCREENSHOT_TIMEOUT_MS = 120_000;

function timeoutFor(action: string, input: unknown): number {
  if (action === 'page.screenshot') return SCREENSHOT_TIMEOUT_MS;
  const declared = (input as { timeoutMs?: unknown } | undefined)?.timeoutMs;
  return typeof declared === 'number' && declared > 0 ? declared + 5_000 : DEFAULT_TIMEOUT_MS;
}
