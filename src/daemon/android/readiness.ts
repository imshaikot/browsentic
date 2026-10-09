import { PLATFORM_TOOLS_URL } from '@/lib/phone/copy';
import type { AndroidDevice, AndroidProblem, AndroidState } from '@/lib/phone/types';
import type { AdbFound } from './adb';
import type { TrackedDevice } from './devices';
import type { PhoneFacts } from './phone-facts';

const INSTALL_ADB: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'brew install --cask android-platform-tools',
  win32: 'winget install Google.PlatformTools',
  linux: 'sudo apt install adb',
};

export interface Observed {
  enabled: boolean;
  platform: NodeJS.Platform;
  adb?: AdbFound | null;
  /** Why the list of phones could not be read from adb's server. */
  serverError?: string;
  /** `facts` is null for a phone that is not ready, or that did not answer. */
  devices: { device: TrackedDevice; facts: PhoneFacts | null }[];
  session?: AndroidState['session'];
}

/** `message` says what is wrong and what to do; `fix`, when there is one, is only ever something to copy: a command or a line of config. */
export const PROBLEMS = {
  off: (): AndroidProblem => ({
    code: 'ANDROID_OFF',
    message: 'Android is switched off in ~/.browsentic/config.json.',
    fix: '"android": { "enabled": true }',
  }),
  adbMissing: (platform: NodeJS.Platform): AndroidProblem => ({
    code: 'ADB_MISSING',
    message: `Browsentic reaches your phone through adb, from Android's platform-tools, and it is not installed. Install it with the command below or download it from ${PLATFORM_TOOLS_URL}.`,
    fix: INSTALL_ADB[platform] ?? PLATFORM_TOOLS_URL,
  }),
  adbBroken: (path: string, why: string): AndroidProblem => ({
    code: 'ADB_BROKEN',
    message: `adb at ${path} does not run: ${why}. Reinstall platform-tools, or name a working adb in ~/.browsentic/config.json.`,
    fix: '"android": { "adb": "/path/to/adb" }',
  }),
  noDevice: (platform: NodeJS.Platform): AndroidProblem => ({
    code: 'NO_DEVICE',
    message:
      platform === 'win32'
        ? 'No Android phone is connected. Turn on USB debugging on the phone and connect it with a USB cable. On Windows the phone also needs its USB driver, from its maker or Google, before adb can see it.'
        : 'No Android phone is connected. Turn on USB debugging on the phone and connect it with a USB cable.',
  }),
  unauthorized: (): AndroidProblem => ({
    code: 'DEVICE_UNAUTHORIZED',
    message: 'The phone has not allowed this computer yet. Unlock it and tap Allow on the USB debugging prompt. If no prompt shows, unplug it and plug it in again.',
  }),
  offline: (device: TrackedDevice): AndroidProblem =>
    device.transport === 'wifi'
      ? { code: 'DEVICE_OFFLINE', message: 'The phone is connected over Wi-Fi but not answering adb. Connect to it again.', fix: `adb connect ${device.serial}` }
      : { code: 'DEVICE_OFFLINE', message: 'The phone is connected but not answering adb. Unplug it and plug it in again.' },
  otherMode: (device: TrackedDevice): AndroidProblem => ({
    code: 'DEVICE_OFFLINE',
    message: `The phone is in ${device.adbState} mode. Restart it normally.`,
  }),
  silent: (): AndroidProblem => ({
    code: 'DEVICE_OFFLINE',
    message: 'The phone stopped answering adb. Unlock it, or unplug it and plug it in again.',
  }),
  noPermissions: (): AndroidProblem => ({
    code: 'NO_PERMISSIONS',
    message: "This computer is not allowed to open the phone's USB connection. Add udev rules for Android phones, then plug the phone in again.",
    fix: 'sudo apt install android-sdk-platform-tools-common',
  }),
  booting: (): AndroidProblem => ({
    code: 'DEVICE_BOOTING',
    message: 'The phone is still starting up.',
  }),
  chromeMissing: (): AndroidProblem => ({
    code: 'CHROME_MISSING',
    message: 'Chrome is not installed on the phone. Install Google Chrome from the Play Store.',
    action: 'installChrome',
  }),
  chromeClosed: (): AndroidProblem => ({
    code: 'CHROME_NOT_RUNNING',
    message: 'Chrome is not open on the phone.',
    action: 'launchChrome',
  }),
  screenOff: (): AndroidProblem => ({
    code: 'SCREEN_OFF',
    message: "The phone's screen is off, so Chrome is not drawing the page. Unlock the phone.",
  }),
} as const;

export function judge(observed: Observed): AndroidState {
  const { enabled, platform, adb, serverError, session } = observed;
  const base = { enabled, adb: { found: !!adb, path: adb?.path, version: adb?.version }, session };
  const stopped = (problem: AndroidProblem, onAdb = false): AndroidState => ({
    ...base,
    ready: false,
    adb: onAdb ? { ...base.adb, problem } : base.adb,
    devices: [],
    problem,
  });

  if (!enabled) return stopped(PROBLEMS.off());
  if (!adb) return stopped(PROBLEMS.adbMissing(platform), true);
  if (adb.broken) return stopped(PROBLEMS.adbBroken(adb.path, adb.broken), true);
  if (serverError) return stopped(PROBLEMS.adbBroken(adb.path, serverError), true);

  const devices = observed.devices.map(({ device, facts }) => describe(device, facts));
  const ready = devices.find(isDrivable);
  return {
    ...base,
    ready: !!ready,
    devices,
    problem: ready ? ready.problem : (devices.find((device) => device.problem)?.problem ?? PROBLEMS.noDevice(platform)),
  };
}

export const isDrivable = (device: AndroidDevice): boolean =>
  device.state === 'ready' && device.chrome.debuggable && (!device.problem || device.problem.code === 'SCREEN_OFF');

function describe(device: TrackedDevice, facts: PhoneFacts | null): AndroidDevice {
  const known: AndroidDevice = {
    serial: device.serial,
    transport: device.transport,
    state: device.state,
    model: facts?.model ?? device.model,
    manufacturer: facts?.manufacturer,
    android: facts?.android,
    sdk: facts?.sdk,
    screen: facts?.screen,
    chrome: facts?.chrome ?? { installed: false, running: false, debuggable: false },
  };
  return { ...known, problem: problemOf(device, facts) };
}

function problemOf(device: TrackedDevice, facts: PhoneFacts | null): AndroidProblem | undefined {
  if (device.state === 'unauthorized') return PROBLEMS.unauthorized();
  if (device.state === 'offline') return PROBLEMS.offline(device);
  if (device.state === 'no-permissions') return PROBLEMS.noPermissions();
  if (device.state === 'other') return PROBLEMS.otherMode(device);
  if (!facts) return PROBLEMS.silent();
  if (!facts.booted) return PROBLEMS.booting();
  if (!facts.chrome.installed) return PROBLEMS.chromeMissing();
  if (!facts.chrome.debuggable) return PROBLEMS.chromeClosed();
  if (facts.screen && !facts.screen.awake) return PROBLEMS.screenOff();
  return undefined;
}
