export type AndroidProblemCode =
  | 'ANDROID_OFF'
  | 'ADB_MISSING'
  | 'ADB_BROKEN'
  | 'NO_DEVICE'
  | 'DEVICE_UNAUTHORIZED'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_BOOTING'
  | 'NO_PERMISSIONS'
  | 'CHROME_MISSING'
  | 'CHROME_NOT_RUNNING'
  | 'SCREEN_OFF';

export type AndroidFixAction = 'launchChrome' | 'installChrome';

export interface AndroidProblem {
  code: AndroidProblemCode;
  message: string;
  fix?: string;
  action?: AndroidFixAction;
}

export type AndroidDeviceState = 'ready' | 'unauthorized' | 'offline' | 'no-permissions' | 'other';

export interface AndroidDevice {
  serial: string;
  transport: 'usb' | 'wifi';
  state: AndroidDeviceState;
  model?: string;
  manufacturer?: string;
  android?: string;
  sdk?: number;
  /** Physical pixels, after any override the phone renders at. */
  screen?: { width: number; height: number; density: number; awake: boolean };
  chrome: {
    installed: boolean;
    version?: string;
    /** Android starts Chrome's process at boot, so a running Chrome is not yet one that can be driven. */
    running: boolean;
    debuggable: boolean;
  };
  /** An advisory such as `SCREEN_OFF` can sit on a phone that is ready. */
  problem?: AndroidProblem;
}

export interface AndroidState {
  /** Off when config.json says `android.enabled: false`, and then the Bridge runs no adb at all. */
  enabled: boolean;
  ready: boolean;
  adb: { found: boolean; path?: string; version?: string; problem?: AndroidProblem };
  devices: AndroidDevice[];
  /** The first thing between the user and a ready phone, or an advisory once one is ready. */
  problem?: AndroidProblem;
  session?: { serial: string; since: string };
}

export interface PhoneTarget {
  targetId: string;
  url: string;
  title: string;
}

export interface PhoneOpened {
  device: AndroidDevice;
  targets: PhoneTarget[];
  browserVersion: string;
}

export type PhoneClosedReason = 'unplugged' | 'chrome-exited' | 'bridge-stopping' | 'closed';

export interface PhoneContext {
  serial: string;
  model: string;
  android: string;
  chrome: string;
  /** CSS px of the visual viewport. */
  viewport: { width: number; height: number; dpr: number };
}
