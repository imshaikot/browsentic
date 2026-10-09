import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AndroidState } from '@/lib/phone/types';
import type { AdbFound } from './adb';
import { AdbServerError, type AdbServer } from './adb-server';
import { INSTALL_CHROME_COMMAND, launchChromeCommand } from './launch';
import { FACTS_COMMAND } from './phone-facts';
import { startAndroid, type Android, type AndroidDeps } from './service';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ADB: AdbFound = { path: '/sdk/platform-tools/adb', version: '37.0.0-14910828' };
const SOCKET_LINE = '0000000000000000: 00000002 00000000 00010000 0001 01 50526 @chrome_devtools_remote\n';

/** adb's server held in memory: a phone whose state the test sets, and a record of everything asked of it. */
class MemoryAdb implements AdbServer {
  running = true;
  list = fixture('devices-emulator.txt');
  facts = fixture('facts-chrome-open.txt');
  readonly shells: string[] = [];
  trackers = 0;
  private onList?: (list: string) => void;
  private onEnd?: (error: AdbServerError) => void;

  private serving<T>(value: T): Promise<T> {
    return this.running ? Promise.resolve(value) : Promise.reject(new AdbServerError('NO_SERVER', 'connect ECONNREFUSED'));
  }

  version = () => this.serving(41);
  devices = () => this.serving(this.list);

  track(onList: (list: string) => void, onEnd: (error: AdbServerError) => void): () => void {
    this.trackers++;
    this.onList = onList;
    this.onEnd = onEnd;
    queueMicrotask(() => onList(this.list));
    return () => {
      this.trackers--;
      this.onList = this.onEnd = undefined;
    };
  }

  async shell(_serial: string, command: string): Promise<string> {
    this.shells.push(command);
    if (command === FACTS_COMMAND) return this.facts;
    if (command.startsWith('am start -n') || command.includes('-n com.android.chrome/')) this.facts = fixture('facts-chrome-open.txt');
    if (command.startsWith('grep')) return this.facts.includes('@chrome_devtools_remote') ? SOCKET_LINE : '';
    return '';
  }

  forward = () => Promise.resolve(50_000);
  removeForward = () => Promise.resolve();

  plug(list: string): void {
    this.list = list;
    this.onList?.(list);
  }

  die(): void {
    this.running = false;
    this.onEnd?.(new AdbServerError('CLOSED', 'adb closed the connection'));
  }
}

let adb: MemoryAdb;
let android: Android;
let deps: AndroidDeps & { locate: ReturnType<typeof vi.fn>; startServer: ReturnType<typeof vi.fn> };

function start(overrides: Partial<AndroidDeps> = {}): Android {
  adb = new MemoryAdb();
  deps = {
    settings: () => ({ enabled: true }),
    locate: vi.fn(async () => ADB),
    startServer: vi.fn(async () => {
      adb.running = true;
      return true;
    }),
    server: adb,
    platform: 'darwin',
    ...overrides,
  } as typeof deps;
  android = startAndroid(deps);
  return android;
}

afterEach(async () => {
  await android?.stop();
  vi.useRealTimers();
});

const heard = () => {
  const states: AndroidState[] = [];
  return { states, listener: (state: AndroidState) => states.push(state) };
};

const until = async (done: () => boolean) => {
  for (let tries = 0; !done(); tries++) {
    if (tries > 200) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

describe('the Bridge\'s view of the phones', () => {
  test('asked with nobody watching, it lists the phones once and tracks nothing', async () => {
    const state = await start().state();
    expect(state).toMatchObject({ ready: true, adb: { found: true, path: ADB.path } });
    expect([adb.trackers, adb.shells]).toEqual([0, [FACTS_COMMAND]]);
  });

  test('a watcher hears the state, then each change the device list brings, and letting go stops the tracking', async () => {
    start();
    const { states, listener } = heard();
    const release = android.watch(listener);
    await until(() => states.length === 1);
    expect(states[0].ready).toBe(true);
    expect(adb.trackers).toBe(1);

    adb.plug(fixture('devices-offline.txt'));
    await until(() => states.length === 2);
    expect(states[1].problem?.code).toBe('DEVICE_OFFLINE');

    adb.plug(fixture('devices-none.txt'));
    await until(() => states.length === 3);
    expect(states[2].problem?.code).toBe('NO_DEVICE');

    release();
    expect(adb.trackers).toBe(0);
  });

  test('every five seconds the phone is asked again, and an unchanged answer is not sent again', async () => {
    vi.useFakeTimers();
    start();
    const { states, listener } = heard();
    android.watch(listener);
    await vi.advanceTimersByTimeAsync(10);
    const asked = adb.shells.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(adb.shells.length).toBe(asked + 1);
    expect(states).toHaveLength(1);

    adb.facts = fixture('facts-chrome-closed.txt');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(states.map((state) => state.problem?.code)).toEqual([undefined, 'CHROME_NOT_RUNNING']);
  });

  test('a second watcher hears what is known at once, without asking the phone again', async () => {
    start();
    const first = heard();
    android.watch(first.listener);
    await until(() => first.states.length === 1);
    const asked = adb.shells.length;
    const second = heard();
    android.watch(second.listener);
    await until(() => second.states.length === 1);
    expect(second.states[0]).toEqual(first.states[0]);
    expect(adb.shells.length).toBe(asked);
  });

  test('switched off, it never looks for adb', async () => {
    const state = await start({ settings: () => ({ enabled: false }) }).state();
    expect(state).toMatchObject({ enabled: false, problem: { code: 'ANDROID_OFF' } });
    expect(deps.locate).not.toHaveBeenCalled();
    expect(adb.shells).toEqual([]);
  });

  test('with no adb server running, it starts one with the adb it found, once', async () => {
    start();
    adb.running = false;
    expect((await android.state()).ready).toBe(true);
    expect(deps.startServer.mock.calls).toEqual([[ADB.path]]);
  });

  test('a server that will not start is reported against adb', async () => {
    start({ startServer: vi.fn(async () => false) });
    adb.running = false;
    expect(await android.state()).toMatchObject({ ready: false, problem: { code: 'ADB_BROKEN' } });
  });

  test('a missing adb is looked for again each time, and one installed later is used', async () => {
    start();
    deps.locate.mockResolvedValueOnce(null);
    expect((await android.state()).problem?.code).toBe('ADB_MISSING');
    expect((await android.state()).ready).toBe(true);
    expect(deps.locate).toHaveBeenCalledTimes(2);
    await android.state();
    expect(deps.locate).toHaveBeenCalledTimes(2);
  });

  test('when adb\'s server goes away while watched, it watches again', async () => {
    vi.useFakeTimers();
    start();
    const { states, listener } = heard();
    android.watch(listener);
    await vi.advanceTimersByTimeAsync(10);
    adb.die();
    expect(adb.trackers).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(deps.startServer).toHaveBeenCalledTimes(1);
    expect(adb.trackers).toBe(2);
    expect(states.at(-1)?.ready).toBe(true);
  });
});

describe('opening Chrome on the phone', () => {
  test('a closed Chrome is started, and the answer is the state once its socket is open', async () => {
    start();
    adb.facts = fixture('facts-chrome-closed.txt');
    const result = await android.launch('emulator-5554');
    expect(result).toMatchObject({ ok: true, data: { ready: true } });
    expect(adb.shells).toContain(launchChromeCommand());
  });

  test('a URL rides along on a cold start only', async () => {
    start();
    adb.facts = fixture('facts-chrome-closed.txt');
    await android.launch('emulator-5554', 'https://example.com/a');
    expect(adb.shells).toContain(launchChromeCommand('https://example.com/a'));
    expect(launchChromeCommand('https://example.com/a')).toMatch(/-a android\.intent\.action\.VIEW -d 'https:\/\/example\.com\/a' -n /);
    expect(launchChromeCommand("https://example.com/it's")).toContain("'https://example.com/it'\\''s'");
    expect(launchChromeCommand('javascript:alert(1)')).toBe(launchChromeCommand());
  });

  test('an open Chrome is left alone', async () => {
    start();
    await android.launch('emulator-5554', 'https://example.com');
    expect(adb.shells.filter((command) => command.startsWith('am start'))).toEqual([]);
  });

  test('a missing Chrome opens its Play Store page instead', async () => {
    start();
    adb.facts = fixture('facts-chrome-open.txt').replace(/(@@browsentic:chrome\n)(package:[^\n]*\n)+/, '$1');
    await android.launch('emulator-5554');
    expect(adb.shells).toContain(INSTALL_CHROME_COMMAND);
  });

  test('a phone that is not connected, or not ready, is refused with its reason', async () => {
    start();
    expect(await android.launch('R5CT1234567')).toMatchObject({ ok: false, error: { code: 'NO_DEVICE' } });
    adb.list = fixture('devices-unauthorized.handwritten.txt');
    expect(await android.launch('R5CT1234567')).toMatchObject({ ok: false, error: { code: 'DEVICE_UNAUTHORIZED' } });
    adb.list = fixture('devices-none.txt');
    expect(await android.launch('R5CT1234567')).toMatchObject({ ok: false, error: { code: 'NO_DEVICE' } });
  });
});
