import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { clientProof, newNonce, openSessionKey, pairingSecret, type Transcript } from '@/lib/actions/handshake';
import { hashManifest } from '@/lib/actions/manifest';
import { SOCKET_PROTOCOL_VERSION, parseFrame, type SocketFrame } from '@/lib/actions/protocol';
import { describeActions } from '@/lib/actions/registry';

export interface Profile {
  origin: string;
  installId: string;
  browser?: string;
}

export type Credential = { kind: 'pair'; code: string } | { kind: 'session'; key: string };

const EXTENSION_VERSION = '0.0.0-test';

/** The extension's half of the socket: it proves itself, then answers every invoke with its own name. */
export class FakeBrowser {
  readonly invoked: string[] = [];
  readonly closed: Promise<string>;
  private readonly pongs = new Map<string, () => void>();

  private constructor(
    private readonly socket: WebSocket,
    readonly profile: Profile,
    readonly sessionKey: string,
  ) {
    this.closed = new Promise((resolve) => socket.once('close', (_code, reason) => resolve(String(reason))));
    socket.on('message', (raw) => this.receive(parseFrame(String(raw))));
  }

  static async connect(port: number, profile: Profile, credential: Credential): Promise<FakeBrowser> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/extension`, { headers: { origin: profile.origin } });
    const inbox = frames(socket);
    await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));

    const hello = { extensionVersion: EXTENSION_VERSION, manifestHash: hashManifest(describeActions()), nonce: newNonce() };
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
    inbox.stop();
    const minted = verdict.sealedSessionKey ? await openSessionKey(secret, transcript, verdict.sealedSessionKey) : null;
    return new FakeBrowser(socket, profile, minted ?? secret);
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

  private receive(frame: SocketFrame | null): void {
    if (frame?.t === 'pong') {
      this.pongs.get(frame.id)?.();
      this.pongs.delete(frame.id);
    }
    if (frame?.t !== 'invoke') return;
    this.invoked.push(frame.action);
    send(this.socket, { t: 'result', id: frame.id, result: { ok: true, data: { answeredBy: this.profile.installId } } });
  }
}

function send(socket: WebSocket, frame: SocketFrame): void {
  socket.send(JSON.stringify(frame));
}

function frames(socket: WebSocket): { next(): Promise<SocketFrame | null>; stop(): void } {
  const queued: (SocketFrame | null)[] = [];
  const waiting: ((frame: SocketFrame | null) => void)[] = [];
  const deliver = (frame: SocketFrame | null) => (waiting.length ? waiting.shift()!(frame) : void queued.push(frame));
  const onMessage = (raw: WebSocket.RawData) => deliver(parseFrame(String(raw)));
  const onClose = () => deliver(null);
  socket.on('message', onMessage).once('close', onClose);
  return {
    next: () => (queued.length ? Promise.resolve(queued.shift()!) : new Promise((resolve) => waiting.push(resolve))),
    stop: () => void socket.off('message', onMessage).off('close', onClose),
  };
}
