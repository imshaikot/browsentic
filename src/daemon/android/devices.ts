import type { AndroidDevice, AndroidDeviceState } from '@/lib/phone/types';

export interface TrackedDevice {
  serial: string;
  state: AndroidDeviceState;
  /** adb's own word, which says more than `other` does: `recovery`, `sideload`, `bootloader`. */
  adbState: string;
  transport: AndroidDevice['transport'];
  model?: string;
  /** A new one for the same serial means the connection was reset and every forward on it is gone. */
  transportId?: string;
}

const STATES: Record<string, AndroidDeviceState> = {
  device: 'ready',
  unauthorized: 'unauthorized',
  offline: 'offline',
  'no permissions': 'no-permissions',
};

const LINE = /^(\S+)\s+(no permissions|\S+)(.*)$/;
const PROPERTY = /\b(model|transport_id):(\S+)/g;
const WIRELESS = /:|_adb-tls-connect/;

export const transportOf = (serial: string): AndroidDevice['transport'] => (WIRELESS.test(serial) ? 'wifi' : 'usb');

/** Reads `adb devices -l`, or one message of `host:track-devices-l`, which is the same list without its heading. */
export function parseDeviceList(text: string): TrackedDevice[] {
  return text
    .split(/\r?\n/)
    .map((line) => LINE.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null && match[1] !== 'List')
    .map(([, serial, adbState, rest]) => {
      const properties = Object.fromEntries([...rest.matchAll(PROPERTY)].map(([, key, value]) => [key, value]));
      return {
        serial,
        state: STATES[adbState] ?? 'other',
        adbState,
        transport: transportOf(serial),
        model: properties.model?.replaceAll('_', ' '),
        transportId: properties.transport_id,
      };
    });
}
