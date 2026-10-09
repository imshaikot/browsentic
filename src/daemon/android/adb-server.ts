import { connect, type Socket } from 'node:net';

/**
 * adb's own server, spoken to over its socket rather than through the adb binary. A client binary
 * whose version differs from the running server's kills that server (and Android Studio's session
 * with it); a socket never does, and it needs no process per call.
 */

export const ADB_SERVER_PORT = Number(process.env.ANDROID_ADB_SERVER_PORT) || 5037;

const CALL_TIMEOUT_MS = 5_000;
const MAX_REPLY_BYTES = 1 << 20;

export type AdbServerErrorCode = 'NO_SERVER' | 'FAIL' | 'TIMEOUT' | 'CLOSED';

export class AdbServerError extends Error {
  constructor(
    readonly code: AdbServerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AdbServer {
  version(): Promise<number>;
  devices(): Promise<string>;
  /** Hears the device list now and on every change, until the returned function is called or the server goes away. */
  track(onList: (list: string) => void, onEnd: (error: AdbServerError) => void): () => void;
  shell(serial: string, command: string, timeoutMs?: number): Promise<string>;
  forward(serial: string, remote: string): Promise<number>;
  removeForward(serial: string, port: number): Promise<void>;
}

export const request = (service: string): Buffer => {
  const payload = Buffer.from(service, 'utf8');
  return Buffer.concat([Buffer.from(payload.length.toString(16).padStart(4, '0'), 'ascii'), payload]);
};

export function adbServer({ port = ADB_SERVER_PORT, host = '127.0.0.1', callTimeoutMs = CALL_TIMEOUT_MS } = {}): AdbServer {
  const once = async <T>(timeoutMs: number, talk: (wire: Wire) => Promise<T>): Promise<T> => {
    const wire = await Wire.open(port, host, timeoutMs);
    try {
      return await talk(wire);
    } finally {
      wire.close();
    }
  };

  return {
    version: () =>
      once(callTimeoutMs, async (wire) => {
        await wire.ask('host:version');
        return Number.parseInt(await wire.prefixed(), 16);
      }),

    devices: () =>
      once(callTimeoutMs, async (wire) => {
        await wire.ask('host:devices-l');
        return wire.prefixed();
      }),

    track(onList, onEnd) {
      let stopped = false;
      let current: Wire | undefined;
      void (async () => {
        try {
          current = await Wire.open(port, host, callTimeoutMs);
          if (stopped) return current.close();
          await current.ask('host:track-devices-l');
          current.unlimited();
          for (;;) onList(await current.prefixed());
        } catch (error) {
          current?.close();
          if (!stopped) onEnd(asServerError(error));
        }
      })();
      return () => {
        stopped = true;
        current?.close();
      };
    },

    shell: (serial, command, timeoutMs = callTimeoutMs) =>
      once(timeoutMs, async (wire) => {
        await wire.ask(`host:transport:${serial}`);
        await wire.ask(`shell:${command}`);
        return wire.rest();
      }),

    forward: (serial, remote) =>
      once(callTimeoutMs, async (wire) => {
        await wire.ask(`host-serial:${serial}:forward:tcp:0;${remote}`);
        await wire.status();
        const port = Number(await wire.prefixed());
        if (!Number.isInteger(port) || port <= 0) throw new AdbServerError('FAIL', `adb forwarded to "${port}", not a port`);
        return port;
      }),

    removeForward: (serial, local) =>
      once(callTimeoutMs, async (wire) => {
        await wire.ask(`host-serial:${serial}:killforward:tcp:${local}`);
        await wire.status();
      }),
  };
}

function asServerError(error: unknown): AdbServerError {
  return error instanceof AdbServerError ? error : new AdbServerError('CLOSED', String(error));
}

/** One conversation with the server: requests out, replies read by exact length or to the end. */
class Wire {
  private buffered = Buffer.alloc(0);
  private ended: AdbServerError | null = null;
  private wake: (() => void) | null = null;
  private deadline: ReturnType<typeof setTimeout> | undefined;

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffered = Buffer.concat([this.buffered, chunk]);
      if (this.buffered.length > MAX_REPLY_BYTES) this.end(new AdbServerError('FAIL', 'adb replied with more than expected'));
      this.notify();
    });
    socket.on('close', () => this.end(new AdbServerError('CLOSED', 'adb closed the connection')));
    socket.on('error', (error: NodeJS.ErrnoException) =>
      this.end(new AdbServerError(error.code === 'ECONNREFUSED' ? 'NO_SERVER' : 'CLOSED', error.message)),
    );
  }

  static open(port: number, host: string, timeoutMs: number): Promise<Wire> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, host);
      const wire = new Wire(socket);
      wire.deadline = setTimeout(() => wire.end(new AdbServerError('TIMEOUT', `adb did not answer within ${timeoutMs} ms`)), timeoutMs);
      socket.once('connect', () => resolve(wire));
      socket.once('close', () => reject(wire.ended));
    });
  }

  unlimited(): void {
    clearTimeout(this.deadline);
  }

  async ask(service: string): Promise<void> {
    this.socket.write(request(service));
    await this.status();
  }

  async status(): Promise<void> {
    const word = (await this.take(4)).toString('ascii');
    if (word === 'OKAY') return;
    if (word === 'FAIL') throw new AdbServerError('FAIL', await this.prefixed());
    throw new AdbServerError('FAIL', `adb answered "${word}"`);
  }

  async prefixed(): Promise<string> {
    const length = Number.parseInt((await this.take(4)).toString('ascii'), 16);
    if (!Number.isInteger(length)) throw new AdbServerError('FAIL', 'adb sent a malformed length');
    return (await this.take(length)).toString('utf8');
  }

  async rest(): Promise<string> {
    while (!this.ended) await this.next();
    if (this.ended.code !== 'CLOSED') throw this.ended;
    return this.buffered.toString('utf8');
  }

  close(): void {
    clearTimeout(this.deadline);
    this.socket.destroy();
  }

  private async take(count: number): Promise<Buffer> {
    while (this.buffered.length < count) {
      if (this.ended) throw this.ended;
      await this.next();
    }
    const taken = this.buffered.subarray(0, count);
    this.buffered = this.buffered.subarray(count);
    return taken;
  }

  private next(): Promise<void> {
    return new Promise((resolve) => (this.wake = resolve));
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private end(error: AdbServerError): void {
    if (this.ended) return;
    this.ended = error;
    clearTimeout(this.deadline);
    this.socket.destroy();
    this.notify();
  }
}
