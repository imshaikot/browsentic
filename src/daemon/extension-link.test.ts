import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ActionResult, ExtensionRequest, SocketFrame } from '@/lib/actions/protocol';
import { typingDurationMs } from '@/lib/actions/page/type-text';
import { ExtensionLink } from './extension-link';

/** Just enough of a ws socket: it records what the daemon sends and lets a test play the extension. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: SocketFrame[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data) as SocketFrame);
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  reply(frame: SocketFrame) {
    this.emit('message', Buffer.from(JSON.stringify(frame)));
  }
}

const hello = { extensionVersion: '0.6.2', manifestHash: 'abc', origin: 'chrome-extension://abcdefghijklmnop' };

let socket: FakeSocket;
let closed: ExtensionLink[];
let requests: ExtensionRequest[];
let link: ExtensionLink;

beforeEach(() => {
  vi.useFakeTimers();
  socket = new FakeSocket();
  closed = [];
  requests = [];
  link = new ExtensionLink(socket as unknown as WebSocket, hello, (gone) => closed.push(gone), (request) => requests.push(request));
});

afterEach(() => {
  link.close('test over');
  vi.useRealTimers();
});

const lastInvoke = () => socket.sent.filter((frame) => frame.t === 'invoke').at(-1) as Extract<SocketFrame, { t: 'invoke' }>;

/** How long the daemon waits for the extension before it gives up on this call. */
async function patience(action: string, input: unknown = {}): Promise<number> {
  const started = Date.now();
  let result: ActionResult | undefined;
  void link.invoke(action, input).then((settled) => (result = settled));
  while (!result) await vi.advanceTimersToNextTimerAsync();
  expect(result).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } });
  return Date.now() - started;
}

describe('a call to the extension', () => {
  test('goes out as an invoke frame, and resolves with the result that answers it', async () => {
    const pending = link.invoke('page.clickElement', { target: { text: 'Buy' } }, { tabId: 7, runId: 'run-1' });
    const frame = lastInvoke();
    socket.reply({ t: 'result', id: frame.id, result: { ok: true, data: { clicked: true } } });
    expect([frame, await pending]).toEqual([
      { t: 'invoke', id: expect.any(String), action: 'page.clickElement', input: { target: { text: 'Buy' } }, tabId: 7, runId: 'run-1' },
      { ok: true, data: { clicked: true } },
    ]);
  });

  test('a result for a call nobody is waiting on is ignored', async () => {
    const pending = link.invoke('page.getPageInfo');
    socket.reply({ t: 'result', id: 'someone-else', result: { ok: true, data: 'wrong' } });
    socket.reply({ t: 'result', id: lastInvoke().id, result: { ok: true, data: 'right' } });
    expect(await pending).toEqual({ ok: true, data: 'right' });
  });

  test('asking for the manifest resolves with the tools the extension describes', async () => {
    const pending = link.describe();
    const frame = socket.sent.at(-1) as Extract<SocketFrame, { t: 'describe' }>;
    socket.reply({ t: 'manifest', id: frame.id, tools: [{ name: 'page.getPageInfo', description: 'Read the page', inputSchema: {} }] });
    expect(await pending).toEqual([{ name: 'page.getPageInfo', description: 'Read the page', inputSchema: {} }]);
  });

  test('a manifest that never comes is no manifest, after ten seconds', async () => {
    const pending = link.describe();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBeNull();
  });
});

// docs/internals/request-path.md: "the extension link allows 120 s for a screenshot, the computed typing
// duration plus 30 s for page.typeText, any declared timeoutMs plus 5 s, and 30 s otherwise."
describe('how long the daemon waits', () => {
  test('30 seconds for an ordinary action', async () => {
    expect(await patience('page.clickElement')).toBe(30_000);
  });

  test('two minutes for a screenshot', async () => {
    expect(await patience('page.screenshot')).toBe(120_000);
  });

  test('the time the typing itself takes, plus 30 seconds, for typed text', async () => {
    const input = { target: { selector: '#q' }, text: 'a fairly long search query, typed like a person would' };
    expect(await patience('page.typeText', input)).toBe(typingDurationMs(input) + 30_000);
  });

  test('a declared timeout plus five seconds', async () => {
    expect(await patience('page.waitForElement', { selector: '#done', timeoutMs: 45_000 })).toBe(50_000);
  });

  test('starting a monitor waits 30 seconds whatever it declares, because the timeout is for the watch', async () => {
    expect(await patience('page.startMonitor', { timeoutMs: 600_000 })).toBe(30_000);
  });

  test('awaiting a monitor waits its declared timeout plus five seconds, or two minutes and five by default', async () => {
    expect([await patience('page.awaitMonitor', { timeoutMs: 20_000 }), await patience('page.awaitMonitor', {})]).toEqual([25_000, 125_000]);
  });

  test('a pick waits for the user as long as it declares plus five seconds, or a minute and five by default', async () => {
    expect([await patience('page.pickElement', { timeoutMs: 15_000 }), await patience('page.pickElement', {})]).toEqual([20_000, 65_000]);
  });

  test('a timeout that is not a positive number is not a declared one', async () => {
    expect([await patience('page.waitForElement', { timeoutMs: -1 }), await patience('page.waitForElement', { timeoutMs: '9000' })]).toEqual([30_000, 30_000]);
  });

  test('giving up says how long it waited', async () => {
    const pending = link.invoke('page.clickElement');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toEqual({ ok: false, error: { code: 'TIMEOUT', message: 'The extension did not respond within 30000ms' } });
  });
});

describe('when the extension goes away', () => {
  test('every call still waiting is answered at once, and no timer is left behind', async () => {
    const calls = [link.invoke('page.screenshot'), link.invoke('page.clickElement')];
    socket.close();
    expect([await Promise.all(calls), vi.getTimerCount(), closed]).toEqual([
      [
        { ok: false, error: { code: 'EXTENSION_OFFLINE', message: 'Connection lost: socket closed' } },
        { ok: false, error: { code: 'EXTENSION_OFFLINE', message: 'Connection lost: socket closed' } },
      ],
      0,
      [link],
    ]);
  });

  test('a call made afterwards fails at once without being sent', async () => {
    socket.close();
    const sent = socket.sent.length;
    expect([await link.invoke('page.getPageInfo'), socket.sent.length, link.isOpen]).toEqual([
      { ok: false, error: { code: 'EXTENSION_OFFLINE', message: 'The Browsentic extension is not connected' } },
      sent,
      false,
    ]);
  });

  test('a socket error ends the link the same way', async () => {
    const pending = link.invoke('page.getPageInfo');
    socket.emit('error', new Error('ECONNRESET'));
    expect([await pending, closed]).toEqual([{ ok: false, error: { code: 'EXTENSION_OFFLINE', message: 'Connection lost: socket error' } }, [link]]);
  });

  test('closing the link from the daemon side tells the owner once, however it ends', () => {
    link.close('replaced by a newer connection');
    socket.close();
    expect(closed).toEqual([link]);
  });
});

describe('the rest of the conversation', () => {
  test('the daemon pings every twenty seconds', async () => {
    await vi.advanceTimersByTimeAsync(40_000);
    expect(socket.sent.filter((frame) => frame.t === 'ping')).toHaveLength(2);
  });

  test("the extension's ping is answered with a pong of the same id", () => {
    socket.reply({ t: 'ping', id: 'p-1' });
    expect(socket.sent).toEqual([{ t: 'pong', id: 'p-1' }]);
  });

  test('a request from the extension is handed to the daemon with the link it came on', () => {
    socket.reply({ t: 'cancel', id: 'c-1' });
    expect(requests).toEqual([{ t: 'cancel', id: 'c-1' }]);
  });

  test('a frame that is not JSON, a pong, or a frame nobody asked for, is dropped', () => {
    socket.emit('message', Buffer.from('not json'));
    socket.reply({ t: 'pong', id: 'p-2' });
    socket.reply({ t: 'hello', protocolVersion: 1 } as SocketFrame);
    expect([socket.sent, requests]).toEqual([[], []]);
  });

  test('a send that throws is logged, not thrown at the caller', () => {
    socket.send = () => {
      throw new Error('socket is closing');
    };
    expect(() => link.send({ t: 'ping', id: 'p-3' })).not.toThrow();
  });
});
