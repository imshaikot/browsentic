import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ControlMessage, ControlRequest } from './control';
import { RemoteBridge } from './remote-bridge';

const TOKEN = 'the-token-in-the-lockfile';

/** The daemon's /control endpoint, answering each request however the test says. */
const http = createServer();
const wss = new WebSocketServer({ noServer: true });
const received: ControlRequest[] = [];
let answer: (request: ControlRequest) => ControlMessage | null;
let daemonSide: WebSocket;
let port: number;

http.on('upgrade', (request, socket, head) => {
  if (request.url !== '/control' || request.headers.authorization !== `Bearer ${TOKEN}`) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    daemonSide = ws;
    ws.on('message', (raw) => {
      const parsed = JSON.parse(String(raw)) as ControlRequest;
      received.push(parsed);
      const reply = answer(parsed);
      if (reply) ws.send(JSON.stringify(reply));
    });
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  port = (http.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const client of wss.clients) client.terminate();
  await new Promise((resolve) => http.close(resolve));
});

let bridge: RemoteBridge;

beforeEach(async () => {
  received.length = 0;
  answer = () => null;
  bridge = await RemoteBridge.connect(port, TOKEN, 'run-9');
});

afterEach(async () => {
  vi.useRealTimers();
  await bridge.close();
});

describe('connecting to the daemon', () => {
  test('a client without the lockfile token is turned away', async () => {
    await expect(RemoteBridge.connect(port, 'guessed')).rejects.toThrow('401');
  });
});

describe('asking the daemon', () => {
  test('the tools it describes', async () => {
    const tools = [{ name: 'page.getPageInfo', description: 'Read the page', inputSchema: {} }];
    answer = ({ id }) => ({ id, op: 'describe', tools, reserved: ['browsentic.focusShot'] });
    expect(await bridge.describe()).toEqual({ tools, reserved: ['browsentic.focusShot'] });
  });

  test('an action, stamped with the run it belongs to', async () => {
    answer = ({ id }) => ({ id, op: 'invoke', result: { ok: true, data: { clicked: true } } });
    const result = await bridge.invoke('page.clickElement', { target: { text: 'Buy' } });
    expect([result, received[0]]).toEqual([
      { ok: true, data: { clicked: true } },
      { id: expect.any(String), op: 'invoke', action: 'page.clickElement', input: { target: { text: 'Buy' } }, runId: 'run-9' },
    ]);
  });

  test('its status, a pairing code, the paired browsers, its agent, and a revocation', async () => {
    const status = { connected: true, daemonVersion: '0.6.2', protocolVersion: 9, port, manifestInSync: true, connectedBrowsers: 1, pairedBrowsers: 1, pairingPending: false };
    const agentState = { active: 'claude' as const, runners: [] };
    answer = (request) => {
      const { id } = request;
      if (request.op === 'status') return { id, op: 'status', status };
      if (request.op === 'pair') return { id, op: 'pair', code: 'ABCD2345', expiresAt: 1 };
      if (request.op === 'sessions') return { id, op: 'sessions', sessions: [] };
      if (request.op === 'agent') return { id, op: 'agent', state: agentState };
      if (request.op === 'revoke') return { id, op: 'revoke', revoked: 2 };
      return null;
    };
    expect([await bridge.status(), await bridge.pair(), await bridge.sessions(), await bridge.agent({ set: 'codex' }), await bridge.revoke('chrome-extension://x')]).toEqual([
      status,
      { id: expect.any(String), op: 'pair', code: 'ABCD2345', expiresAt: 1 },
      [],
      agentState,
      2,
    ]);
    expect(received.slice(3).map(({ id: _id, ...request }) => request)).toEqual([
      { op: 'agent', set: 'codex' },
      { op: 'revoke', origin: 'chrome-extension://x' },
    ]);
  });

  test('a reply for a request nobody is waiting on, or one that is not JSON, is ignored', async () => {
    answer = ({ id }) => {
      daemonSide.send('not json');
      daemonSide.send(JSON.stringify({ id: 'someone-else', op: 'revoke', revoked: 99 }));
      return { id, op: 'revoke', revoked: 1 };
    };
    expect(await bridge.revoke()).toBe(1);
  });

  test('a manifest change reaches every listener', async () => {
    const heard = new Promise<string[]>((resolve) => {
      const calls: string[] = [];
      bridge.onManifestChanged(() => calls.push('first'));
      bridge.onManifestChanged(() => resolve([...calls, 'second']));
    });
    daemonSide.send(JSON.stringify({ event: 'manifest-changed' }));
    expect(await heard).toEqual(['first', 'second']);
  });
});

describe('when the daemon does not answer', () => {
  /** How long a call waits for the daemon before it gives up, and what it gives up with. */
  const giveUp = async <T>(call: () => Promise<T>): Promise<[number, T | string]> => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const started = Date.now();
    let outcome: { value: T | string } | undefined;
    call().then(
      (value) => (outcome = { value }),
      (error: Error) => (outcome = { value: error.message }),
    );
    while (!outcome) await vi.advanceTimersToNextTimerAsync();
    return [Date.now() - started, outcome.value];
  };

  test('an action gives up after a minute, as the daemon being unreachable', async () => {
    expect(await giveUp(() => bridge.invoke('page.clickElement'))).toEqual([
      60_000,
      { ok: false, error: { code: 'DAEMON_UNREACHABLE', message: 'The Browsentic daemon did not respond' } },
    ]);
  });

  test('an action that declares a timeout waits that long plus ten seconds', async () => {
    expect((await giveUp(() => bridge.invoke('page.waitForElement', { timeoutMs: 90_000 })))[0]).toBe(100_000);
  });

  test('starting a monitor waits a minute, whatever the watch itself is set to', async () => {
    expect((await giveUp(() => bridge.invoke('page.startMonitor', { timeoutMs: 600_000 })))[0]).toBe(60_000);
  });

  test('awaiting a monitor or a pick waits for their own defaults plus ten seconds', async () => {
    expect([(await giveUp(() => bridge.invoke('page.awaitMonitor')))[0], (await giveUp(() => bridge.invoke('page.pickElement')))[0]]).toEqual([130_000, 70_000]);
  });

  test('status and pairing say so, rather than answering with nothing', async () => {
    expect([await giveUp(() => bridge.status()), await giveUp(() => bridge.pair()), await giveUp(() => bridge.agent())]).toEqual([
      [60_000, 'The Browsentic daemon did not respond to a status request'],
      [60_000, 'The Browsentic daemon did not issue a pairing code'],
      [60_000, 'The Browsentic daemon did not answer about its agent'],
    ]);
  });

  test('lists come back empty and counts as zero', async () => {
    expect([await giveUp(() => bridge.describe()), await giveUp(() => bridge.sessions()), await giveUp(() => bridge.revoke())]).toEqual([
      [60_000, { tools: [] }],
      [60_000, []],
      [60_000, 0],
    ]);
  });

  test('once closed, calls fail at once without being sent', async () => {
    await bridge.close();
    await vi.waitFor(() => expect(daemonSide.readyState).toBe(daemonSide.CLOSED));
    expect([await bridge.invoke('page.getPageInfo'), await bridge.describe(), received]).toEqual([
      { ok: false, error: { code: 'DAEMON_UNREACHABLE', message: 'The Browsentic daemon did not respond' } },
      { tools: [] },
      [],
    ]);
  });
});
