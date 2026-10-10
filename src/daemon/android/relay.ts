import WebSocket from 'ws';
import { failure, success, type ActionResult, type SocketFrame } from '@/lib/actions/protocol';
import type { AndroidState, PhoneClosedReason, PhoneOpened, PhoneTarget } from '@/lib/phone/types';
import { log } from '../log';
import type { AdbServer } from './adb-server';

export interface PhoneOwner {
  readonly id: string;
  readonly isOpen: boolean;
  readonly bufferedAmount: number;
  send(frame: SocketFrame): void;
}

export type CdpRequest = Extract<SocketFrame, { t: 'cdp' }>;
type CdpResult = ActionResult<Record<string, unknown>>;

export interface Relay {
  open(owner: PhoneOwner, serial: string): Promise<ActionResult<PhoneOpened>>;
  command(owner: PhoneOwner, request: CdpRequest): Promise<CdpResult>;
  close(owner: PhoneOwner, serial: string): Promise<void>;
  release(owner: PhoneOwner): Promise<void>;
  stop(): Promise<void>;
}

export interface RelayDeps {
  server: Pick<AdbServer, 'forward' | 'removeForward'>;
  state(): Promise<AndroidState>;
  onSession(session: AndroidState['session']): void;
  host?: string;
  timeouts?: { connect: number; command: number; slow: number };
}

const DEVTOOLS_SOCKET = 'localabstract:chrome_devtools_remote';
const TIMEOUTS = { connect: 5_000, command: 15_000, slow: 30_000 };
/** The longest a caller may ask one command to wait: a page-side wait or a long typing run awaited in the page. */
const LONGEST_COMMAND_MS = 180_000;
const SLOW_COMMANDS = new Set(['Page.captureScreenshot', 'Page.navigate']);
const FRAME_BACKLOG_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 256 * 1024 * 1024;
/** Discovery also reports a phantom `"1"` for a restored tab, and every command sent to it hangs. */
const REAL_TARGET = /^[0-9A-F]{32}$/i;

interface Call {
  resolve(result: CdpResult): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Session {
  serial: string;
  owner: PhoneOwner;
  port: number;
  socket: WebSocket;
  since: string;
  browserVersion: string;
  calls: Map<number, Call>;
  nextId: number;
}

export function startRelay({ server, state, onSession, host = '127.0.0.1', timeouts = TIMEOUTS }: RelayDeps): Relay {
  const sessions = new Map<string, Session>();
  const opening = new Map<string, Promise<unknown>>();

  const announce = () => {
    const [current] = sessions.values();
    onSession(current && { serial: current.serial, since: current.since });
  };

  function call(session: Session, method: string, params?: Record<string, unknown>, sessionId?: string, asked?: number): Promise<CdpResult> {
    if (sessions.get(session.serial) !== session || session.socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve(failure('PHONE_GONE', 'The phone disconnected.'));
    }
    const id = session.nextId++;
    const timeoutMs = asked ? Math.min(asked, LONGEST_COMMAND_MS) : SLOW_COMMANDS.has(method) ? timeouts.slow : timeouts.command;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        session.calls.delete(id);
        resolve(failure('TIMEOUT', `${method} got no answer from the phone within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      session.calls.set(id, { resolve, timer });
      session.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  function receive(session: Session, raw: WebSocket.RawData): void {
    let message: { id?: number; result?: Record<string, unknown>; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const waiting = session.calls.get(message.id);
      if (!waiting) return;
      session.calls.delete(message.id);
      clearTimeout(waiting.timer);
      return waiting.resolve(message.error ? failure('CDP_ERROR', message.error.message ?? 'Chrome refused the command') : success(message.result ?? {}));
    }
    if (!message.method || !session.owner.isOpen) return;
    if (message.method === 'Page.screencastFrame' && session.owner.bufferedAmount > FRAME_BACKLOG_BYTES) {
      const ack = { id: session.nextId++, method: 'Page.screencastFrameAck', params: { sessionId: message.params?.sessionId }, sessionId: message.sessionId };
      return session.socket.send(JSON.stringify(ack));
    }
    session.owner.send({ t: 'cdpEvent', serial: session.serial, method: message.method, params: message.params ?? {}, sessionId: message.sessionId });
  }

  async function teardown(session: Session, reason: PhoneClosedReason, tellOwner: boolean): Promise<void> {
    if (sessions.get(session.serial) !== session) return;
    sessions.delete(session.serial);
    for (const waiting of session.calls.values()) {
      clearTimeout(waiting.timer);
      waiting.resolve(failure('PHONE_GONE', 'The phone disconnected while this command was on its way.'));
    }
    session.calls.clear();
    session.socket.removeAllListeners();
    session.socket.on('error', () => {});
    session.socket.terminate();
    await server.removeForward(session.serial, session.port).catch(() => {});
    if (tellOwner && session.owner.isOpen) session.owner.send({ t: 'phoneClosed', serial: session.serial, reason });
    log(`phone ${session.serial} session ended: ${reason}`);
    announce();
  }

  async function lost(session: Session): Promise<void> {
    const device = (await state().catch(() => null))?.devices.find((each) => each.serial === session.serial);
    await teardown(session, device?.state === 'ready' ? 'chrome-exited' : 'unplugged', true);
  }

  async function connect(serial: string, port: number): Promise<{ socket: WebSocket; browserVersion: string }> {
    const version = (await (await fetch(`http://${host}:${port}/json/version`, { signal: AbortSignal.timeout(timeouts.connect) })).json()) as {
      Browser?: string;
      webSocketDebuggerUrl?: string;
    };
    const path = version.webSocketDebuggerUrl ? new URL(version.webSocketDebuggerUrl).pathname : '/devtools/browser';
    const socket = new WebSocket(`ws://${host}:${port}${path}`, { perMessageDeflate: false, maxPayload: MAX_MESSAGE_BYTES });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Chrome on ${serial} did not accept the DevTools connection`)), timeouts.connect);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return { socket, browserVersion: version.Browser ?? 'Chrome' };
  }

  async function opened(session: Session): Promise<ActionResult<PhoneOpened>> {
    const listed = await call(session, 'Target.getTargets');
    const infos = (listed.ok ? (listed.data.targetInfos as { targetId: string; type: string; url: string; title: string }[] | undefined) : undefined) ?? [];
    const targets: PhoneTarget[] = infos
      .filter((info) => info.type === 'page' && REAL_TARGET.test(info.targetId))
      .map(({ targetId, url, title }) => ({ targetId, url, title }));
    const device = (await state()).devices.find((each) => each.serial === session.serial);
    if (!device) return failure('PHONE_GONE', 'The phone disconnected while the session was opening.');
    return success({ device, targets, browserVersion: session.browserVersion });
  }

  async function open(owner: PhoneOwner, serial: string): Promise<ActionResult<PhoneOpened>> {
    while (opening.has(serial)) await opening.get(serial);
    const held = sessions.get(serial);
    if (held && held.owner !== owner) return failure('NOT_OWNER', 'Another browser is driving this phone.');
    if (held) return opened(held);
    const attempt = start(owner, serial);
    opening.set(serial, attempt);
    try {
      return await attempt;
    } finally {
      opening.delete(serial);
    }
  }

  async function start(owner: PhoneOwner, serial: string): Promise<ActionResult<PhoneOpened>> {
    const device = (await state()).devices.find((each) => each.serial === serial);
    if (!device) return failure('NO_DEVICE', `No phone "${serial}" is connected.`);
    if (device.state !== 'ready') return failure(device.problem?.code ?? 'DEVICE_OFFLINE', device.problem?.message ?? 'The phone is not ready.');
    if (!device.chrome.debuggable) return failure('CHROME_NOT_RUNNING', 'Chrome is not open on the phone.');

    let port: number | undefined;
    try {
      port = await server.forward(serial, DEVTOOLS_SOCKET);
      const { socket, browserVersion } = await connect(serial, port);
      const session: Session = { serial, owner, port, socket, since: new Date().toISOString(), browserVersion, calls: new Map(), nextId: 1 };
      sessions.set(serial, session);
      socket.on('message', (raw) => receive(session, raw));
      socket.on('close', () => void lost(session));
      socket.on('error', () => socket.terminate());
      await call(session, 'Target.setDiscoverTargets', { discover: true });
      log(`phone ${serial} opened (${browserVersion}, forward tcp:${port})`);
      announce();
      return await opened(session);
    } catch (error) {
      if (port !== undefined && !sessions.has(serial)) await server.removeForward(serial, port).catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      log(`phone ${serial} did not open: ${message}`);
      return failure('PHONE_GONE', `Could not reach Chrome on the phone: ${message}`);
    }
  }

  return {
    open,

    async command(owner, { serial, method, params, sessionId, timeoutMs }) {
      const session = sessions.get(serial);
      if (!session) return failure('PHONE_GONE', 'No phone session is open. Switch Android on again.');
      if (session.owner !== owner) return failure('NOT_OWNER', 'Another browser is driving this phone.');
      const started = Date.now();
      const result = await call(session, method, params, sessionId, timeoutMs);
      if (!isChatter(method, params)) log(`phone ${serial} ${method} ${result.ok ? 'ok' : result.error.code} in ${Date.now() - started} ms`);
      return result;
    },

    async close(owner, serial) {
      const session = sessions.get(serial);
      if (session?.owner === owner) await teardown(session, 'closed', false);
    },

    async release(owner) {
      await Promise.all([...sessions.values()].filter((session) => session.owner === owner).map((session) => teardown(session, 'closed', false)));
    },

    async stop() {
      await Promise.all([...sessions.values()].map((session) => teardown(session, 'bridge-stopping', true)));
    },
  };
}

/** Screencast acks and finger or pointer moves arrive many times a second; one line each would bury everything else in daemon.log. */
function isChatter(method: string, params?: Record<string, unknown>): boolean {
  return method === 'Page.screencastFrameAck' || (method.startsWith('Input.dispatch') && /move/i.test(String(params?.type ?? '')));
}
