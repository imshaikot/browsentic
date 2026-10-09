import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseDeviceList, transportOf } from './devices';
import { FACTS_COMMAND, isDebuggable, parseFacts } from './phone-facts';
import { versionOf } from './adb';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** A captured answer with one probe's section replaced, for the states the emulator cannot be put in. */
const answering = (text: string, probe: string, lines: string[]) =>
  text.replace(new RegExp(`(@@browsentic:${probe}\\n)(?:(?!@@browsentic:)[^\\n]*\\n?)*`), `$1${lines.map((line) => `${line}\n`).join('')}`);

describe('the device list', () => {
  test('an emulator that is ready, with its model and transport id', () => {
    expect(parseDeviceList(fixture('devices-emulator.txt'))).toEqual([
      { serial: 'emulator-5554', state: 'ready', adbState: 'device', transport: 'usb', model: 'sdk gphone16k arm64', transportId: '21' },
    ]);
  });

  test('none attached is an empty list, heading or not', () => {
    expect(parseDeviceList(fixture('devices-none.txt'))).toEqual([]);
    expect(parseDeviceList('')).toEqual([]);
  });

  test('offline and unauthorized keep their meaning', () => {
    expect(parseDeviceList(fixture('devices-offline.txt'))).toMatchObject([{ serial: 'emulator-5554', state: 'offline', transportId: '18' }]);
    expect(parseDeviceList(fixture('devices-unauthorized.handwritten.txt'))).toMatchObject([
      { serial: 'R5CT1234567', state: 'unauthorized', transport: 'usb', transportId: '4' },
    ]);
  });

  test('"no permissions" is one state although it is two words, and its link is not read as a property', () => {
    expect(parseDeviceList(fixture('devices-no-permissions.handwritten.txt'))).toEqual([
      { serial: '0123456789ABCDEF', state: 'no-permissions', adbState: 'no permissions', transport: 'usb', model: undefined, transportId: '3' },
    ]);
  });

  test('wireless serials, from mDNS pairing and from adb connect, are wifi', () => {
    expect(parseDeviceList(fixture('devices-wireless.handwritten.txt'))).toMatchObject([
      { serial: 'adb-R5CT1234567-AbCdEf._adb-tls-connect._tcp', state: 'ready', transport: 'wifi', model: 'SM S918B' },
      { serial: '192.168.1.20:5555', state: 'offline', transport: 'wifi' },
    ]);
    expect(transportOf('emulator-5554')).toBe('usb');
  });

  test('every other adb state is other, and adb\'s word for it is kept', () => {
    const list = ['A1 recovery transport_id:1', 'A2 sideload', 'A3 bootloader', 'A4 authorizing transport_id:9'].join('\n');
    expect(parseDeviceList(list).map(({ state, adbState }) => [state, adbState])).toEqual([
      ['other', 'recovery'],
      ['other', 'sideload'],
      ['other', 'bootloader'],
      ['other', 'authorizing'],
    ]);
  });

  test('a track-devices message with Windows line ends reads the same', () => {
    expect(parseDeviceList(fixture('devices-emulator.txt').replaceAll('\n', '\r\n'))).toHaveLength(1);
  });
});

describe('the phone facts', () => {
  test('one shell call asks every probe, each under its own marker', () => {
    expect(FACTS_COMMAND.match(/echo @@browsentic:\w+/g)).toHaveLength(12);
    expect(FACTS_COMMAND).not.toMatch(/"/);
  });

  test('Chrome open on an awake phone', () => {
    expect(parseFacts(fixture('facts-chrome-open.txt'))).toEqual({
      booted: true,
      model: 'sdk_gphone16k_arm64',
      manufacturer: 'Google',
      android: '17',
      sdk: 37,
      screen: { width: 1080, height: 2092, density: 420, awake: true },
      chrome: { installed: true, version: '150.0.7871.186', running: true, debuggable: true },
    });
  });

  test('the running Chrome is the update, not the copy the system image shipped', () => {
    expect(parseFacts(fixture('facts-chrome-open.txt')).chrome.version).toBe('150.0.7871.186');
  });

  test('Chrome closed: installed, no process and no socket', () => {
    expect(parseFacts(fixture('facts-chrome-closed.txt')).chrome).toEqual({
      installed: true,
      version: '150.0.7871.186',
      running: false,
      debuggable: false,
    });
  });

  test('a process Android started at boot is running but not debuggable', () => {
    expect(parseFacts(answering(fixture('facts-chrome-closed.txt'), 'pid', ['7953'])).chrome).toMatchObject({ running: true, debuggable: false });
  });

  test('the screen off', () => {
    expect(parseFacts(fixture('facts-screen-off.txt')).screen?.awake).toBe(false);
  });

  test('an override is what the phone renders at', () => {
    expect(parseFacts(fixture('facts-overridden.txt')).screen).toEqual({ width: 1000, height: 1900, density: 400, awake: true });
  });

  test('Chrome missing: pm path prints nothing', () => {
    const missing = ['chrome', 'version', 'pid', 'socket'].reduce((text, probe) => answering(text, probe, []), fixture('facts-chrome-open.txt'));
    expect(parseFacts(missing).chrome).toEqual({ installed: false, version: undefined, running: false, debuggable: false });
  });

  test('still booting', () => {
    expect(parseFacts(answering(fixture('facts-chrome-open.txt'), 'booted', [])).booted).toBe(false);
  });

  test('another app\'s DevTools socket is not Chrome\'s', () => {
    const others = [
      '0000000000000000: 00000002 00000000 00010000 0001 01 16893 @stetho_com.google.android.apps.messaging_devtools_remote',
      '0000000000000000: 00000002 00000000 00010000 0001 01 16894 @chrome_devtools_remote_1234',
    ].join('\n');
    expect(isDebuggable(others)).toBe(false);
    expect(isDebuggable(`${others}\n0000000000000000: 00000002 00000000 00010000 0001 01 50526 @chrome_devtools_remote`)).toBe(true);
  });

  test('an empty or garbled answer knows nothing, and claims nothing', () => {
    expect(parseFacts('')).toEqual({
      booted: false,
      model: undefined,
      manufacturer: undefined,
      android: undefined,
      sdk: undefined,
      screen: undefined,
      chrome: { installed: false, version: undefined, running: false, debuggable: false },
    });
  });
});

describe('the adb version', () => {
  test('the platform-tools release when adb prints one, the protocol version otherwise', () => {
    expect(versionOf(fixture('adb-version.txt'))).toBe('37.0.0-14910828');
    expect(versionOf('Android Debug Bridge version 1.0.39\n')).toBe('1.0.39');
    expect(versionOf('something else')).toBeUndefined();
  });
});
