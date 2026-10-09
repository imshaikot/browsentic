import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AdbServerError, adbServer, request, type AdbServer } from './adb-server';

const prefixed = (text: string) => `${Buffer.byteLength(text).toString(16).padStart(4, '0')}${text}`;

/** adb's server as far as the host protocol goes: each request is answered the way a real one answered it on 9 Oct 2026. */
class FakeAdbServer {
  readonly requests: string[] = [];
  readonly trackers: Socket[] = [];
  readonly forwards = new Set<number>();
  devices = 'emulator-5554          device product:sdk_gphone16k_arm64 model:sdk_gphone16k_arm64 device:emu64a16k transport_id:21\n';
  shellOutput = 'hi\n';
  silent = false;
  private server!: Server;

  async listen(): Promise<number> {
    this.server = createServer((socket) => this.serve(socket));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return (this.server.address() as { port: number }).port;
  }

  async close(): Promise<void> {
    for (const tracker of this.trackers) tracker.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }

  private serve(socket: Socket): void {
    let buffered = '';
    let transport: string | null = null;
    socket.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      for (;;) {
        if (buffered.length < 4) return;
        const length = Number.parseInt(buffered.slice(0, 4), 16);
        if (buffered.length < 4 + length) return;
        const service = buffered.slice(4, 4 + length);
        buffered = buffered.slice(4 + length);
        this.requests.push(service);
        if (this.silent) continue;
        if (service === 'host:version') socket.end(`OKAY${prefixed('0029')}`);
        else if (service === 'host:devices-l') socket.end(`OKAY${prefixed(this.devices)}`);
        else if (service === 'host:track-devices-l') {
          this.trackers.push(socket);
          socket.write(`OKAY${prefixed(this.devices)}`);
        } else if (service.startsWith('host:transport:')) {
          transport = service.slice('host:transport:'.length);
          if (transport === 'emulator-5554') socket.write('OKAY');
          else socket.end(`FAIL${prefixed(`device '${transport}' not found`)}`);
        } else if (service.startsWith('shell:') && transport) socket.end(`OKAY${this.shellOutput}`);
        else if (/^host-serial:[^:]+:forward:tcp:0;/.test(service)) {
          const port = 50_000 + this.forwards.size;
          this.forwards.add(port);
          socket.end(`OKAYOKAY${prefixed(String(port))}`);
        } else if (/^host-serial:[^:]+:killforward:tcp:(\d+)$/.test(service)) {
          const port = Number(/(\d+)$/.exec(service)![1]);
          socket.end(this.forwards.delete(port) ? 'OKAYOKAY' : `FAIL${prefixed(`listener 'tcp:${port}' not found`)}`);
        } else socket.end(`FAIL${prefixed(`unknown host service`)}`);
      }
    });
  }
}

const CALL_TIMEOUT_MS = 100;

let fake: FakeAdbServer;
let port: number;
let adb: AdbServer;

beforeEach(async () => {
  fake = new FakeAdbServer();
  port = await fake.listen();
  adb = adbServer({ port, callTimeoutMs: CALL_TIMEOUT_MS });
});

afterEach(() => fake.close());

const until = async (done: () => boolean) => {
  for (let tries = 0; !done(); tries++) {
    if (tries > 200) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe('adb\'s server over its socket', () => {
  test('a request is its length in four hex digits, then the service', () => {
    expect(request('host:version').toString()).toBe('000chost:version');
  });

  test('the version and the device list', async () => {
    expect(await adb.version()).toBe(41);
    expect(await adb.devices()).toBe(fake.devices);
  });

  test('a shell command goes through the device\'s transport, and its output is everything until adb hangs up', async () => {
    fake.shellOutput = 'one\ntwo\n';
    expect(await adb.shell('emulator-5554', 'echo one; echo two')).toBe('one\ntwo\n');
    expect(fake.requests).toEqual(['host:transport:emulator-5554', 'shell:echo one; echo two']);
  });

  test('a FAIL carries adb\'s own words', async () => {
    await expect(adb.shell('nope', 'true')).rejects.toMatchObject({ code: 'FAIL', message: "device 'nope' not found" });
  });

  test('a forward answers its port, and removing it twice fails the second time', async () => {
    const port = await adb.forward('emulator-5554', 'localabstract:chrome_devtools_remote');
    expect(port).toBe(50_000);
    expect(fake.requests).toEqual(['host-serial:emulator-5554:forward:tcp:0;localabstract:chrome_devtools_remote']);
    await adb.removeForward('emulator-5554', port);
    await expect(adb.removeForward('emulator-5554', port)).rejects.toMatchObject({ code: 'FAIL' });
  });

  test('no server listening is NO_SERVER', async () => {
    const vacant = createServer();
    await new Promise<void>((resolve) => vacant.listen(0, '127.0.0.1', resolve));
    const { port: unused } = vacant.address() as { port: number };
    await new Promise((resolve) => vacant.close(resolve));
    await expect(adbServer({ port: unused }).version()).rejects.toMatchObject({ code: 'NO_SERVER' });
  });

  test('a server that never answers is a TIMEOUT', async () => {
    fake.silent = true;
    await expect(adb.shell('emulator-5554', 'sleep 60')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('tracking the devices', () => {
  test('hears the list at once, then each change, whether it arrives in pieces or two at a time', async () => {
    const lists: string[] = [];
    const stop = adb.track((list) => lists.push(list), () => lists.push('ended'));
    await until(() => lists.length === 1);
    expect(lists).toEqual([fake.devices]);

    const tracker = fake.trackers[0];
    for (const byte of prefixed('A1\tdevice\n')) tracker.write(byte);
    await until(() => lists.length === 2);
    tracker.write(`${prefixed('')}${prefixed('A2\toffline\n')}`);
    await until(() => lists.length === 4);
    expect(lists.slice(1)).toEqual(['A1\tdevice\n', '', 'A2\toffline\n']);
    stop();
  });

  test('says when the server goes away, and says nothing once stopped', async () => {
    const ends: AdbServerError[] = [];
    adb.track(() => {}, (error) => ends.push(error));
    await until(() => fake.trackers.length === 1);
    fake.trackers[0].destroy();
    await until(() => ends.length === 1);
    expect(ends[0]).toBeInstanceOf(AdbServerError);

    const quiet: AdbServerError[] = [];
    const stop = adb.track(() => {}, (error) => quiet.push(error));
    await until(() => fake.trackers.length === 2);
    stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(quiet).toEqual([]);
  });

  test('a tracker is not cut off by the call timeout', async () => {
    const lists: string[] = [];
    const stop = adb.track((list) => lists.push(list), () => lists.push('ended'));
    await new Promise((resolve) => setTimeout(resolve, CALL_TIMEOUT_MS * 3));
    expect(lists).toEqual([fake.devices]);
    stop();
  });
});
