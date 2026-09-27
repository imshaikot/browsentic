import '@/daemon/test/sandbox';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { startDaemon, type Daemon } from '@/daemon/daemon';
import { logPath, readLockfile } from '@/daemon/lockfile';
import { RemoteBridge } from '@/daemon/remote-bridge';
import type { DaemonState } from './socket';

const ports = vi.hoisted(() => [] as number[]);
vi.mock('@/lib/actions/protocol', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DAEMON_PORTS: ports,
}));

type NodeWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;

class ExtensionSocket extends (WebSocket as unknown as NodeWebSocket) {
  constructor(url: string) {
    super(url, { headers: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
  }
}
vi.stubGlobal('WebSocket', ExtensionSocket);

type Socket = typeof import('./socket');

let daemon: Daemon;
let worker: Socket | undefined;

beforeAll(async () => {
  daemon = await startDaemon({ version: '0.0.0-test', idleExit: false });
  ports.push(daemon.port);
});

afterAll(() => daemon?.stop());

beforeEach(() => {
  fakeBrowser.reset();
  vi.resetModules();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ version: '0.0.0-test' } as never);
});

afterEach(() => worker?.disconnectDaemon());

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const connections = () => readFileSync(logPath, 'utf8').match(/connected from/g)?.length ?? 0;
/** Past the first retry the backoff can schedule, which lands within a second. */
const RETRY_WINDOW_MS = 1_200;
/** A fresh import of the worker, up to 3 s for the link and the retry window: past vitest's 5 s once the whole suite shares the machine. */
const TEST_TIMEOUT_MS = 20_000;

async function daemonState(): Promise<DaemonState | undefined> {
  return (await fakeBrowser.storage.session.get('browsentic/daemon'))['browsentic/daemon'] as DaemonState | undefined;
}

async function online(): Promise<void> {
  for (let tries = 0; !(await daemonState())?.connected; tries++) {
    if (tries > 150) throw new Error('the link never came online');
    await wait(20);
  }
}

/** A paired browser whose worker Chrome has just revived: the key survived in storage, the socket died with the old worker. */
async function revivedWorker(): Promise<Socket> {
  const bridge = await RemoteBridge.connect(daemon.port, readLockfile()!.token);
  const { code } = await bridge.pair();
  bridge.close();
  const previous: Socket = await import('./socket');
  expect(await previous.pairDaemon(code)).toEqual({ ok: true });
  const { 'browsentic/sessionKey': key } = await fakeBrowser.storage.local.get('browsentic/sessionKey');
  await previous.disconnectDaemon();
  await fakeBrowser.storage.local.set({ 'browsentic/sessionKey': key });
  await fakeBrowser.storage.session.set({
    'browsentic/daemon': { connected: false, paired: true, lastChangeAt: Date.now() },
  });
  vi.resetModules();
  worker = await import('./socket');
  return worker;
}

describe('keeping one link to the daemon', () => {
  test('a worker revived by the alarm, asked to connect twice at once, opens one socket and stays online', async () => {
    const socket = await revivedWorker();
    const before = connections();
    void socket.connectDaemon();
    void socket.connectDaemon();
    await online();
    await wait(RETRY_WINDOW_MS);
    expect(connections() - before).toBe(1);
    expect((await daemonState())?.connected).toBe(true);
  }, TEST_TIMEOUT_MS);

});
