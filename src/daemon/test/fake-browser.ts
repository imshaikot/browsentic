import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { clientProof, newNonce, openSessionKey, pairingSecret, type Transcript } from '@/lib/actions/handshake';
import { hashManifest, type ToolDescriptor } from '@/lib/actions/manifest';
import {
  SOCKET_PROTOCOL_VERSION,
  parseFrame,
  type ActionResult,
  type ExtensionRequest,
  type SocketFrame,
} from '@/lib/actions/protocol';
import type { TaskList, TaskOrder } from '@/lib/schedules/task';
import { describeActions, type BrowserTarget } from '@/lib/actions/registry';

export interface Profile {
  origin: string;
  installId: string;
  browser?: string;
  /** Which build this browser runs; a Firefox build offers fewer tools. */
  target?: BrowserTarget;
  /** What a drifted build reports instead of the registry's list. */
  tools?: ToolDescriptor[];
}

export type Credential = { kind: 'pair'; code: string } | { kind: 'session'; key: string };

const EXTENSION_VERSION = '0.0.0-test';

/** The extension's half of the socket: it proves itself, then answers every invoke with its own name. */
export class FakeBrowser {
  readonly invoked: string[] = [];
  /** Every scheduled run the daemon handed this browser. */
  readonly orders: TaskOrder[] = [];
  /** What the next `runTask` is answered with. */
  taskReply: ActionResult = { ok: true, data: { sessionId: 'fake-session' } };
  /** The task list the daemon last pushed or answered with. */
  tasks: TaskList | null = null;
  /** While set, every invoke is answered only once it resolves. */
  holdInvokes: Promise<void> | null = null;
  private readonly replies = new Map<string, (frame: SocketFrame) => void>();
  readonly closed: Promise<string>;
  /** Resolves once this browser has answered the daemon's request for its manifest — a drifted build is asked right behind the welcome. */
  readonly described: Promise<void>;
  private tellDescribed!: () => void;
  private readonly pongs = new Map<string, () => void>();

  private constructor(
    private readonly socket: WebSocket,
    readonly profile: Profile,
    readonly sessionKey: string,
    backlog: (SocketFrame | null)[],
  ) {
    this.closed = new Promise((resolve) => socket.once('close', (_code, reason) => resolve(String(reason))));
    this.described = new Promise((resolve) => (this.tellDescribed = resolve));
    socket.on('message', (raw) => this.receive(parseFrame(String(raw))));
    for (const frame of backlog) this.receive(frame);
  }

  static async connect(port: number, profile: Profile, credential: Credential): Promise<FakeBrowser> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/extension`, { headers: { origin: profile.origin } });
    const inbox = frames(socket);
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));

    const hello = { extensionVersion: EXTENSION_VERSION, manifestHash: hashManifest(toolsOf(profile)), nonce: newNonce() };
    send(socket, {
      t: 'hello',
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      auth: { kind: credential.kind },
      installId: profile.installId,
      browser: profile.browser,
      ...hello,
    });

    const challenge = await inbox.next();
    if (challenge?.t !== 'challenge') throw new Error(`expected a challenge, got ${challenge?.t}`);
    const transcript: Transcript = {
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      extensionVersion: hello.extensionVersion,
      manifestHash: hello.manifestHash,
      clientNonce: hello.nonce,
      serverNonce: challenge.nonce,
    };
    const secret = credential.kind === 'pair' ? await pairingSecret(credential.code, transcript) : credential.key;
    send(socket, { t: 'prove', proof: await clientProof(secret, transcript) });

    const verdict = await inbox.next();
    if (verdict?.t === 'unauthorized') throw new Error(verdict.reason);
    if (verdict?.t !== 'welcome') throw new Error(`expected a welcome, got ${verdict?.t}`);
    const minted = verdict.sealedSessionKey ? await openSessionKey(secret, transcript, verdict.sealedSessionKey) : null;
    // The daemon asks a drifted build for its manifest right behind the welcome, so whatever
    // arrived while the key was being opened is handed over rather than dropped.
    return new FakeBrowser(socket, profile, minted ?? secret, inbox.stop());
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  /** Resolves once the daemon has read everything sent before it, focus included. */
  async focus(): Promise<void> {
    send(this.socket, { t: 'focus' });
    const id = randomUUID();
    const answered = new Promise<void>((resolve) => this.pongs.set(id, resolve));
    send(this.socket, { t: 'ping', id });
    await answered;
  }

  close(): void {
    this.socket.close(1000, 'test over');
  }

  /** Sends what the side panel would, and resolves with the daemon's answer to it. */
  ask(request: Extract<ExtensionRequest, { id: string }>): Promise<SocketFrame> {
    const answered = new Promise<SocketFrame>((resolve) => this.replies.set(request.id, resolve));
    send(this.socket, request);
    return answered;
  }

  tell(request: Extract<ExtensionRequest, { id: string }>): void {
    send(this.socket, request);
  }

  private receive(frame: SocketFrame | null): void {
    if (frame?.t === 'taskList' && frame.result.ok) this.tasks = frame.result.data;
    const waiting = frame && 'id' in frame ? this.replies.get(frame.id) : undefined;
    if (waiting && frame && 'id' in frame) {
      this.replies.delete(frame.id);
      return waiting(frame);
    }
    if (frame?.t === 'runTask') {
      this.orders.push(frame.order);
      return send(this.socket, { t: 'result', id: frame.id, result: this.taskReply });
    }
    if (frame?.t === 'pong') {
      this.pongs.get(frame.id)?.();
      this.pongs.delete(frame.id);
    }
    if (frame?.t === 'describe') {
      send(this.socket, { t: 'manifest', id: frame.id, tools: toolsOf(this.profile) });
      return this.tellDescribed();
    }
    if (frame?.t !== 'invoke') return;
    this.invoked.push(frame.action);
    const answer = () =>
      send(this.socket, { t: 'result', id: frame.id, result: { ok: true, data: { answeredBy: this.profile.installId } } });
    if (this.holdInvokes) void this.holdInvokes.then(answer);
    else answer();
  }
}

function toolsOf(profile: Profile): ToolDescriptor[] {
  return profile.tools ?? describeActions(profile.target);
}

function send(socket: WebSocket, frame: SocketFrame): void {
  socket.send(JSON.stringify(frame));
}

/** Frames in arrival order while the handshake runs; `stop` returns whatever was never read. */
function frames(socket: WebSocket): { next(): Promise<SocketFrame | null>; stop(): (SocketFrame | null)[] } {
  const queued: (SocketFrame | null)[] = [];
  const waiting: ((frame: SocketFrame | null) => void)[] = [];
  const deliver = (frame: SocketFrame | null) => (waiting.length ? waiting.shift()!(frame) : void queued.push(frame));
  const onMessage = (raw: WebSocket.RawData) => deliver(parseFrame(String(raw)));
  const onClose = () => deliver(null);
  socket.on('message', onMessage).once('close', onClose);
  return {
    next: () => (queued.length ? Promise.resolve(queued.shift()!) : new Promise((resolve) => waiting.push(resolve))),
    stop: () => {
      socket.off('message', onMessage).off('close', onClose);
      return queued.splice(0);
    },
  };
}
