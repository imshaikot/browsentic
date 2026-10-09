import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import type { AndroidState } from '@/lib/phone/types';
import { androidSettings, readAgentConfig, type AndroidSettings } from '../agent/config';
import { log } from '../log';
import { locateAdb, startServer, type AdbFound } from './adb';
import { AdbServerError, adbServer, type AdbServer } from './adb-server';
import { parseDeviceList, type TrackedDevice } from './devices';
import { launchChrome, openChromeListing } from './launch';
import { FACTS_COMMAND, parseFacts, type PhoneFacts } from './phone-facts';
import { judge } from './readiness';

export interface Android {
  state(): Promise<AndroidState>;
  /**
   * A watcher hears the state as soon as it is known, then every change. The Bridge looks for phones
   * only while someone holds a watch, and the returned function lets go of it.
   */
  watch(listener: (state: AndroidState) => void): () => void;
  launch(serial: string, url?: string): Promise<ActionResult<AndroidState>>;
  stop(): Promise<void>;
}

export interface AndroidDeps {
  settings(): AndroidSettings;
  locate(configured?: string): Promise<AdbFound | null>;
  startServer(path: string): Promise<boolean>;
  server: AdbServer;
  platform: NodeJS.Platform;
}

const REFRESH_MS = 5_000;
const FACTS_TIMEOUT_MS = 5_000;
const BROKEN_RECHECK_MS = 60_000;
const RETRACK_MS = 2_000;

export const ANDROID_OFF_STATE: AndroidState = judge({ enabled: false, platform: process.platform, devices: [] });

export function androidOff(): Android {
  return {
    state: async () => ANDROID_OFF_STATE,
    watch: (listener) => {
      queueMicrotask(() => listener(ANDROID_OFF_STATE));
      return () => {};
    },
    launch: async () => failure('ANDROID_OFF', ANDROID_OFF_STATE.problem?.message ?? 'Android is switched off.'),
    stop: async () => {},
  };
}

export function liveAndroidDeps(): AndroidDeps {
  return {
    settings: () => androidSettings(readAgentConfig()),
    locate: (configured) => locateAdb({ configured }),
    startServer,
    server: adbServer(),
    platform: process.platform,
  };
}

interface Tracker {
  devices: TrackedDevice[] | null;
  stop(): void;
}

export function startAndroid(deps: AndroidDeps = liveAndroidDeps()): Android {
  const heard = new Map<(state: AndroidState) => void, string>();
  let latest: AndroidState | null = null;
  let located: { adb: AdbFound | null; configured?: string; at: number } | undefined;
  let tracker: Tracker | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let retrack: ReturnType<typeof setTimeout> | undefined;
  let refreshing: Promise<AndroidState> | null = null;
  let again = false;

  const watched = () => heard.size > 0;

  async function adbFor(settings: AndroidSettings): Promise<AdbFound | null> {
    const recheck =
      !located?.adb || located.configured !== settings.adb || (!!located.adb.broken && Date.now() - located.at > BROKEN_RECHECK_MS);
    if (recheck) {
      const adb = await deps.locate(settings.adb);
      if (adb && adb.path !== located?.adb?.path) log(`android: adb at ${adb.path} (${adb.broken ? `broken: ${adb.broken}` : adb.version})`);
      located = { adb, configured: settings.adb, at: Date.now() };
    }
    return located?.adb ?? null;
  }

  async function withServer<T>(path: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof AdbServerError) || error.code !== 'NO_SERVER') throw error;
      log(`android: no adb server is running; starting one with ${path}`);
      if (!(await deps.startServer(path))) throw new AdbServerError('NO_SERVER', `"${path} start-server" did not start adb's server`);
      return call();
    }
  }

  async function startTracking(path: string): Promise<void> {
    await withServer(path, () => deps.server.version());
    const current: Tracker = { devices: null, stop: () => {} };
    tracker = current;
    current.stop = deps.server.track(
      (list) => {
        current.devices = parseDeviceList(list);
        if (tracker === current) void refresh();
      },
      (error) => {
        if (tracker !== current) return;
        log(`android: lost adb's device list (${error.message}); watching again in ${RETRACK_MS} ms`);
        tracker = null;
        retrack = setTimeout(() => void refresh(), RETRACK_MS);
      },
    );
  }

  function stopTracking(): void {
    clearTimeout(retrack);
    tracker?.stop();
    tracker = null;
  }

  const factsOf = (serial: string): Promise<PhoneFacts | null> =>
    deps.server
      .shell(serial, FACTS_COMMAND, FACTS_TIMEOUT_MS)
      .then(parseFacts)
      .catch(() => null);

  async function observe(): Promise<AndroidState> {
    const settings = deps.settings();
    const seen = { enabled: settings.enabled, platform: deps.platform, devices: [] };
    if (!settings.enabled) {
      stopTracking();
      return judge(seen);
    }
    const adb = await adbFor(settings);
    if (!adb || adb.broken) {
      stopTracking();
      return judge({ ...seen, adb });
    }
    try {
      if (watched() && !tracker) await startTracking(adb.path);
      const listed = tracker?.devices ?? parseDeviceList(await withServer(adb.path, () => deps.server.devices()));
      const devices = await Promise.all(
        listed.map(async (device) => ({ device, facts: device.state === 'ready' ? await factsOf(device.serial) : null })),
      );
      return judge({ ...seen, adb, devices });
    } catch (error) {
      return judge({ ...seen, adb, serverError: error instanceof Error ? error.message : String(error) });
    }
  }

  function refresh(): Promise<AndroidState> {
    if (refreshing) {
      again = true;
      return refreshing;
    }
    const run = async (): Promise<AndroidState> => {
      try {
        let state: AndroidState;
        do {
          again = false;
          state = await observe();
          publish(state);
        } while (again);
        return state;
      } finally {
        refreshing = null;
      }
    };
    return (refreshing = run());
  }

  function publish(state: AndroidState): void {
    if (watched() && headline(state) !== (latest && headline(latest))) log(`android: ${headline(state)}`);
    latest = state;
    for (const listener of heard.keys()) deliver(listener, state);
  }

  function deliver(listener: (state: AndroidState) => void, state: AndroidState): void {
    const json = JSON.stringify(state);
    if (heard.get(listener) === json) return;
    heard.set(listener, json);
    listener(state);
  }

  return {
    state: () => (latest && tracker ? Promise.resolve(latest) : refresh()),

    watch(listener) {
      heard.set(listener, '');
      if (heard.size === 1) {
        ticker = setInterval(() => void refresh(), REFRESH_MS);
        ticker.unref();
      }
      if (latest && tracker) {
        const known = latest;
        queueMicrotask(() => heard.has(listener) && deliver(listener, known));
      } else void refresh();
      return () => {
        if (!heard.delete(listener) || watched()) return;
        clearInterval(ticker);
        stopTracking();
      };
    },

    async launch(serial, url) {
      const before = await refresh();
      const device = before.devices.find((each) => each.serial === serial);
      if (!device) {
        const problem = before.devices.length ? undefined : before.problem;
        return failure(problem?.code ?? 'NO_DEVICE', problem?.message ?? `No phone "${serial}" is connected.`);
      }
      if (device.state !== 'ready') {
        return failure(device.problem?.code ?? 'DEVICE_OFFLINE', device.problem?.message ?? 'The phone is not ready.');
      }
      try {
        if (!device.chrome.installed) await openChromeListing(deps.server, serial);
        else if (!device.chrome.debuggable) await launchChrome(deps.server, serial, url);
      } catch (error) {
        return failure('DEVICE_OFFLINE', `The phone did not open Chrome: ${error instanceof Error ? error.message : String(error)}`);
      }
      return success(await refresh());
    },

    async stop() {
      heard.clear();
      clearInterval(ticker);
      stopTracking();
    },
  };
}

function headline(state: AndroidState): string {
  const ready = state.devices.find((device) => device.state === 'ready' && device.chrome.debuggable);
  return state.ready ? `ready (${ready?.serial})${state.problem ? `, ${state.problem.code}` : ''}` : (state.problem?.code ?? 'not ready');
}
