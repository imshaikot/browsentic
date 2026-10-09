import type { AndroidDevice } from '@/lib/phone/types';

export const CHROME_PACKAGE = 'com.android.chrome';
export const DEVTOOLS_SOCKET = '@chrome_devtools_remote';

const PROBES = {
  booted: 'getprop sys.boot_completed',
  model: 'getprop ro.product.model',
  manufacturer: 'getprop ro.product.manufacturer',
  release: 'getprop ro.build.version.release',
  sdk: 'getprop ro.build.version.sdk',
  size: 'wm size',
  density: 'wm density',
  power: 'dumpsys power | grep mWakefulness=',
  chrome: `pm path ${CHROME_PACKAGE}`,
  version: `dumpsys package ${CHROME_PACKAGE} | grep versionName=`,
  pid: `pidof ${CHROME_PACKAGE}`,
  socket: `grep ${DEVTOOLS_SOCKET} /proc/net/unix`,
} as const;

type Probe = keyof typeof PROBES;

const MARK = '@@browsentic:';

/** Every probe in one `adb shell`, each answer under its own marker, so one that fails or prints nothing cannot shift the others. */
export const FACTS_COMMAND = Object.entries(PROBES)
  .map(([probe, command]) => `echo ${MARK}${probe}; ${command}`)
  .join('; ');

export interface PhoneFacts {
  booted: boolean;
  model?: string;
  manufacturer?: string;
  android?: string;
  sdk?: number;
  screen?: NonNullable<AndroidDevice['screen']>;
  chrome: AndroidDevice['chrome'];
}

export function parseFacts(output: string): PhoneFacts {
  const answers = sections(output);
  const line = (probe: Probe) => answers[probe]?.[0];
  const size = dimension(answers.size, /size: (\d+)x(\d+)/);
  const density = dimension(answers.density, /density: (\d+)/);
  const sdk = Number(line('sdk'));
  return {
    booted: line('booted') === '1',
    model: line('model'),
    manufacturer: line('manufacturer'),
    android: line('release'),
    sdk: Number.isInteger(sdk) && sdk > 0 ? sdk : undefined,
    screen:
      size && density
        ? { width: size[0], height: size[1], density: density[0], awake: /mWakefulness=Awake\b/.test(answers.power?.join('\n') ?? '') }
        : undefined,
    chrome: {
      installed: (answers.chrome ?? []).some((entry) => entry.startsWith('package:')),
      version: answers.version?.map((entry) => /versionName=(\S+)/.exec(entry)?.[1]).find(Boolean),
      running: (answers.pid ?? []).some((entry) => /^\d+(\s+\d+)*$/.test(entry)),
      debuggable: isDebuggable(answers.socket?.join('\n') ?? ''),
    },
  };
}

/** The socket's name ends its line; a bare `devtools_remote` would also match other apps', such as `@stetho_…_devtools_remote`. */
export const isDebuggable = (unixSockets: string): boolean =>
  unixSockets.split(/\r?\n/).some((entry) => entry.trim().endsWith(` ${DEVTOOLS_SOCKET}`));

function sections(output: string): Partial<Record<Probe, string[]>> {
  const found: Partial<Record<string, string[]>> = {};
  let current: string[] | undefined;
  for (const raw of output.split(/\r?\n/)) {
    const entry = raw.trim();
    if (entry.startsWith(MARK)) found[entry.slice(MARK.length)] = current = [];
    else if (entry) current?.push(entry);
  }
  return found;
}

/** `wm` prints the physical value, then an override when one is set; the override is what the phone renders at. */
function dimension(entries: string[] | undefined, pattern: RegExp): number[] | undefined {
  const values = (entries ?? []).map((entry) => pattern.exec(entry)?.slice(1).map(Number)).filter((value) => value !== undefined);
  return values.at(-1);
}
