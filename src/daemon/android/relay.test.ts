import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SocketFrame } from '@/lib/actions/protocol';
import type { AndroidState } from '@/lib/phone/types';
import { logPath } from '../lockfile';
import { startRelay, type PhoneOwner, type Relay } from './relay';

const SERIAL = 'emulator-5554';
const PAGE = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';

/** Chrome on the phone, as far as the relay sees it through the forwarded port. */
class FakeChrome {
  readonly paths: string[] = [];
  readonly origins: (string | undefined)[] = [];
  readonly commands: { method: string; params?: Record<string, unknown>; sessionId?: string }[] = [];
  readonly sockets: WebSocket[] = [];
  private http!: Server;

  async listen(): Promise<number> {
    const wss = new WebSocketServer({ noServer: true });
    this.http = createServer((req, res) => {
      this.paths.push(req.url ?? '');
      if (req.url !== '/json/version') return res.writeHead(404).end();
      const { port } = this.http.address() as { port: number };
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ Browser: 'Chrome/150.0.7871.186', 'Android-Package': 'com.android.chrome', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser` }),
      );
    });
    this.http.on('upgrade', (req: IncomingMessage, socket, head) => {
      this.origins.push(req.headers.origin);
      wss.handleUpgrade(req, socket, head, (ws) => this.serve(ws));
    });
    await new Promise<void>((resolve) => this.http.listen(0, '127.0.0.1', resolve));
    return (this.http.address() as { port: number }).port;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    await new Promise((resolve) => this.http.close(resolve));
  }

  emit(method: string, params: Record<string, unknown>, sessionId?: string): void {
    for (const socket of this.sockets) socket.send(JSON.stringify({ method, params, sessionId }));
  }

  hangUp(): void {
    for (const socket of this.sockets) socket.terminate();
  }

  private serve(ws: WebSocket): void {
    this.sockets.push(ws);
    ws.on('message', (raw) => {
      const { id, method, params, sessionId } = JSON.parse(String(raw));
      this.commands.push({ method, params, sessionId });
      const reply = (body: object) => ws.send(JSON.stringify({ id, ...body }));
      if (method === 'Target.setDiscoverTargets') reply({ result: {} });
      else if (method === 'Target.getTargets') {
        reply({
          result: {
            targetInfos: [
              { targetId: PAGE, type: 'page', url: 'https://example.com/', title: 'Example' },
              { targetId: '1', type: 'page', url: 'https://example.com/', title: 'Example' },
              { targetId: 'B'.repeat(32), type: 'service_worker', url: 'https://example.com/sw.js', title: '' },
            ],
          },
        });
      } else if (method === 'Runtime.evaluate') reply({ result: { result: { type: 'string', value: 'Example' } } });
      else if (method === 'Hang.forever') return;
      else if (method !== 'Page.screencastFrameAck') reply({ error: { code: -32601, message: `'${method}' wasn't found` } });
    });
  }
}

class Owner implements PhoneOwner {
  readonly sent: SocketFrame[] = [];
  isOpen = true;
  bufferedAmount = 0;
  constructor(readonly id: string) {}
  send(frame: SocketFrame): void {
    this.sent.push(frame);
  }
  events(): string[] {
    return this.sent.flatMap((frame) => (frame.t === 'cdpEvent' ? [frame.method] : []));
  }
}

const READY: AndroidState = {
  enabled: true,
  ready: true,
  adb: { found: true },
  devices: [{ serial: SERIAL, transport: 'usb', state: 'ready', chrome: { installed: true, running: true, debuggable: true } }],
};

let chrome: FakeChrome;
let port: number;
let state: AndroidState;
let forwards: { made: string[]; removed: number[] };
let sessions: AndroidState['session'][];
let relay: Relay;

beforeEach(async () => {
  chrome = new FakeChrome();
  port = await chrome.listen();
  state = READY;
  forwards = { made: [], removed: [] };
  sessions = [];
  relay = startRelay({
    server: {
      forward: async (serial, remote) => {
        forwards.made.push(`${serial} ${remote}`);
        return port;
      },
      removeForward: async (_serial, local) => {
        forwards.removed.push(local);
      },
    },
    state: async () => state,
    onSession: (session) => sessions.push(session),
    timeouts: { connect: 1_000, command: 100, slow: 200 },
  });
});

afterEach(async () => {
  await relay.stop();
  await chrome.close();
});

const until = async (done: () => boolean) => {
  for (let tries = 0; !done(); tries++) {
    if (tries > 200) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('opening a phone', () => {
  test('forwards the DevTools socket, connects with no Origin, and lists only real pages', async () => {
    const owner = new Owner('chrome-1');
    expect(await relay.open(owner, SERIAL)).toEqual({
      ok: true,
      data: {
        device: READY.devices[0],
        targets: [{ targetId: PAGE, url: 'https://example.com/', title: 'Example' }],
        browserVersion: 'Chrome/150.0.7871.186',
      },
    });
    expect(forwards.made).toEqual([`${SERIAL} localabstract:chrome_devtools_remote`]);
    expect(chrome.paths).toEqual(['/json/version']);
    expect(chrome.origins).toEqual([undefined]);
    expect(chrome.commands.map(({ method }) => method)).toEqual(['Target.setDiscoverTargets', 'Target.getTargets']);
    expect(sessions).toEqual([{ serial: SERIAL, since: expect.any(String) }]);
  });

  test('a phone that is not there, or whose Chrome is closed, is refused before any forward', async () => {
    const owner = new Owner('chrome-1');
    expect(await relay.open(owner, 'R5CT1234567')).toMatchObject({ ok: false, error: { code: 'NO_DEVICE' } });
    state = { ...READY, devices: [{ ...READY.devices[0], chrome: { installed: true, running: true, debuggable: false } }] };
    expect(await relay.open(owner, SERIAL)).toMatchObject({ ok: false, error: { code: 'CHROME_NOT_RUNNING' } });
    expect(forwards.made).toEqual([]);
  });

  test('two opens at once make one session, and asking again answers from it', async () => {
    const owner = new Owner('chrome-1');
    const [first, second] = await Promise.all([relay.open(owner, SERIAL), relay.open(owner, SERIAL)]);
    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(forwards.made).toHaveLength(1);
    expect(chrome.sockets).toHaveLength(1);
  });

  test('a second browser is told another owns the phone, for opens and for commands', async () => {
    await relay.open(new Owner('chrome-1'), SERIAL);
    const other = new Owner('edge-1');
    expect(await relay.open(other, SERIAL)).toMatchObject({ ok: false, error: { code: 'NOT_OWNER' } });
    expect(await relay.command(other, { t: 'cdp', id: 'x', serial: SERIAL, method: 'Runtime.evaluate' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_OWNER' },
    });
  });

  test('a Chrome that refuses the connection leaves no forward behind', async () => {
    await chrome.close();
    expect(await relay.open(new Owner('chrome-1'), SERIAL)).toMatchObject({ ok: false, error: { code: 'PHONE_GONE' } });
    expect(forwards.removed).toEqual([port]);
    chrome = new FakeChrome();
    await chrome.listen();
  });
});

describe('commands and events', () => {
  let owner: Owner;
  beforeEach(async () => {
    owner = new Owner('chrome-1');
    await relay.open(owner, SERIAL);
  });

  test('a command goes to the phone with its session id, and its answer comes back', async () => {
    const result = await relay.command(owner, { t: 'cdp', id: 'f1', serial: SERIAL, method: 'Runtime.evaluate', params: { expression: 'document.title' }, sessionId: 'S1' });
    expect(result).toEqual({ ok: true, data: { result: { type: 'string', value: 'Example' } } });
    expect(chrome.commands.at(-1)).toEqual({ method: 'Runtime.evaluate', params: { expression: 'document.title' }, sessionId: 'S1' });
  });

  test('a command can ask to wait longer than the default, for a page-side wait', async () => {
    const asked = relay.command(owner, { t: 'cdp', id: 'f7', serial: SERIAL, method: 'Hang.forever', timeoutMs: 400 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await Promise.race([asked, Promise.resolve('still waiting')])).toBe('still waiting');
    expect(await asked).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  });

  test('Chrome\'s refusal is CDP_ERROR in its own words, and silence is TIMEOUT', async () => {
    expect(await relay.command(owner, { t: 'cdp', id: 'f2', serial: SERIAL, method: 'Nope.nope' })).toEqual({
      ok: false,
      error: { code: 'CDP_ERROR', message: "'Nope.nope' wasn't found" },
    });
    expect(await relay.command(owner, { t: 'cdp', id: 'f3', serial: SERIAL, method: 'Hang.forever' })).toMatchObject({
      ok: false,
      error: { code: 'TIMEOUT' },
    });
  });

  test('a command for a phone with no session is PHONE_GONE', async () => {
    expect(await relay.command(owner, { t: 'cdp', id: 'f4', serial: 'R5CT1234567', method: 'Runtime.evaluate' })).toMatchObject({
      ok: false,
      error: { code: 'PHONE_GONE' },
    });
  });

  test('every event reaches the owner, with the session it came from', async () => {
    chrome.emit('Target.targetCreated', { targetInfo: { targetId: PAGE } });
    chrome.emit('Page.screencastFrame', { data: 'jpeg', sessionId: 1, metadata: {} }, 'S1');
    await until(() => owner.events().length === 2);
    expect(owner.sent.at(-1)).toEqual({ t: 'cdpEvent', serial: SERIAL, method: 'Page.screencastFrame', params: { data: 'jpeg', sessionId: 1, metadata: {} }, sessionId: 'S1' });
  });

  test('a backed-up owner misses screencast frames, which the Bridge acks itself, and nothing else', async () => {
    owner.bufferedAmount = 5 * 1024 * 1024;
    chrome.emit('Page.screencastFrame', { data: 'jpeg', sessionId: 7, metadata: {} }, 'S1');
    chrome.emit('Page.frameNavigated', { frame: { id: 'F' } }, 'S1');
    await until(() => owner.events().length === 1);
    expect(owner.events()).toEqual(['Page.frameNavigated']);
    await until(() => chrome.commands.some(({ method }) => method === 'Page.screencastFrameAck'));
    expect(chrome.commands.at(-1)).toEqual({ method: 'Page.screencastFrameAck', params: { sessionId: 7 }, sessionId: 'S1' });
  });

  test('the log names each method and never what it carried', async () => {
    await relay.command(owner, { t: 'cdp', id: 'f5', serial: SERIAL, method: 'Input.insertText', params: { text: 'hunter2-secret' } });
    await relay.command(owner, { t: 'cdp', id: 'f6', serial: SERIAL, method: 'Page.screencastFrameAck', params: { sessionId: 1 } });
    chrome.emit('Page.screencastFrame', { data: 'FRAME-PIXELS', sessionId: 2, metadata: {} });
    await until(() => owner.events().length === 1);
    const logged = readFileSync(logPath, 'utf8');
    expect(logged).toMatch(/phone emulator-5554 Input\.insertText CDP_ERROR in \d+ ms/);
    expect(logged).not.toMatch(/hunter2-secret|FRAME-PIXELS|Page\.screencastFrameAck/);
  });
});

describe('when a session ends', () => {
  let owner: Owner;
  beforeEach(async () => {
    owner = new Owner('chrome-1');
    await relay.open(owner, SERIAL);
  });

  test('Chrome going away fails the command in flight, tells the owner why, and removes the forward', async () => {
    const pending = relay.command(owner, { t: 'cdp', id: 'g1', serial: SERIAL, method: 'Hang.forever' });
    await until(() => chrome.commands.some(({ method }) => method === 'Hang.forever'));
    chrome.hangUp();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'PHONE_GONE' } });
    await until(() => owner.sent.some((frame) => frame.t === 'phoneClosed'));
    expect(owner.sent.filter((frame) => frame.t === 'phoneClosed')).toEqual([{ t: 'phoneClosed', serial: SERIAL, reason: 'chrome-exited' }]);
    expect(forwards.removed).toEqual([port]);
    expect(sessions.at(-1)).toBeUndefined();
  });

  test('a phone that left adb\'s list was unplugged', async () => {
    state = { ...READY, ready: false, devices: [] };
    chrome.hangUp();
    await until(() => owner.sent.some((frame) => frame.t === 'phoneClosed'));
    expect(owner.sent.find((frame) => frame.t === 'phoneClosed')).toMatchObject({ reason: 'unplugged' });
  });

  test('the owner closing it, or going away, ends it quietly and removes the forward', async () => {
    await relay.close(owner, SERIAL);
    expect(forwards.removed).toEqual([port]);
    await relay.open(owner, SERIAL);
    await relay.release(owner);
    expect(forwards.removed).toEqual([port, port]);
    expect(owner.sent.filter((frame) => frame.t === 'phoneClosed')).toEqual([]);
  });

  test('another browser cannot close it', async () => {
    await relay.close(new Owner('edge-1'), SERIAL);
    expect(forwards.removed).toEqual([]);
  });

  test('the Bridge stopping tells the owner and removes the forward', async () => {
    await relay.stop();
    expect(owner.sent.filter((frame) => frame.t === 'phoneClosed')).toEqual([{ t: 'phoneClosed', serial: SERIAL, reason: 'bridge-stopping' }]);
    expect(forwards.removed).toEqual([port]);
  });
});
