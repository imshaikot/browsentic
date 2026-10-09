import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { WebSocketServer, type WebSocket } from 'ws';
import { newNonce, serverProof, type Transcript } from '@/lib/actions/handshake';
import { ANDROID_PROTOCOL, parseFrame, type SocketFrame } from '@/lib/actions/protocol';
import type { DaemonState } from './socket';

const ports = vi.hoisted(() => [] as number[]);
vi.mock('@/lib/actions/protocol', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DAEMON_PORTS: ports,
}));

const SESSION_KEY = 'session-key-of-a-paired-browser';
const RELEASED_BRIDGE = { daemonVersion: '0.8.1', protocolVersion: 22 };
/** A fresh import of the worker is slow once the whole suite shares the machine, as in socket.test.ts. */
const TEST_TIMEOUT_MS = 20_000;

let bridge: WebSocketServer;
const heard: SocketFrame[] = [];

/** Browsentic Bridge 0.8.1 as far as the handshake goes: it speaks 22 and proves it holds the session key. */
function released(ws: WebSocket): void {
  let transcript: Transcript | undefined;
  const send = (frame: SocketFrame) => ws.send(JSON.stringify(frame));
  ws.on('message', async (raw) => {
    const frame = parseFrame(String(raw));
    if (frame) heard.push(frame);
    if (frame?.t === 'hello') {
      transcript = {
        protocolVersion: frame.protocolVersion,
        extensionVersion: frame.extensionVersion,
        manifestHash: frame.manifestHash,
        clientNonce: frame.nonce,
        serverNonce: newNonce(),
      };
      send({ t: 'challenge', nonce: transcript.serverNonce });
    }
    if (frame?.t === 'prove' && transcript) {
      const welcome = { daemonVersion: RELEASED_BRIDGE.daemonVersion, manifestHash: transcript.manifestHash, manifestInSync: true };
      const proof = await serverProof(SESSION_KEY, transcript, welcome);
      send({ t: 'welcome', ...welcome, protocolVersion: RELEASED_BRIDGE.protocolVersion, proof });
    }
  });
}

beforeAll(async () => {
  bridge = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  bridge.on('connection', released);
  await new Promise((resolve) => bridge.once('listening', resolve));
  const address = bridge.address();
  if (typeof address === 'object' && address) ports.push(address.port);
});

afterAll(() => new Promise((resolve) => bridge.close(resolve)));

beforeEach(() => {
  fakeBrowser.reset();
  vi.resetModules();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ version: '0.0.0-test' } as never);
});

let worker: typeof import('./socket') | undefined;
afterEach(() => worker?.disconnectDaemon());

async function daemonState(): Promise<DaemonState | undefined> {
  return (await fakeBrowser.storage.session.get('browsentic/daemon'))['browsentic/daemon'] as DaemonState | undefined;
}

describe('an extension against a Bridge from before Android', () => {
  test('connects, and knows the Bridge does not speak Android', async () => {
    await fakeBrowser.storage.local.set({ 'browsentic/sessionKey': SESSION_KEY });
    worker = await import('./socket');
    await worker.connectDaemon();
    for (let tries = 0; !(await daemonState())?.connected; tries++) {
      if (tries > 150) throw new Error('the link never came online');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await daemonState()).toMatchObject({ connected: true, ...RELEASED_BRIDGE });
    expect(worker.daemonSpeaks(RELEASED_BRIDGE.protocolVersion)).toBe(true);
    expect(worker.daemonSpeaks(ANDROID_PROTOCOL)).toBe(false);
    expect(heard.find((frame) => frame.t === 'hello')).toMatchObject({ protocolVersion: ANDROID_PROTOCOL });
  }, TEST_TIMEOUT_MS);
});
