import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { AndroidProblemCode } from '@/lib/phone/types';
import { parseDeviceList, type TrackedDevice } from './devices';
import { parseFacts, type PhoneFacts } from './phone-facts';
import { judge, type Observed } from './readiness';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const ADB = { path: '/sdk/platform-tools/adb', version: '37.0.0-14910828' };
const [emulator] = parseDeviceList(fixture('devices-emulator.txt'));
const open = parseFacts(fixture('facts-chrome-open.txt'));

const observed = (devices: Observed['devices'], more: Partial<Observed> = {}): Observed => ({
  enabled: true,
  platform: 'darwin',
  adb: ADB,
  devices,
  ...more,
});

const phone = (device: Partial<TrackedDevice>, facts: PhoneFacts | null = null) => ({ device: { ...emulator, ...device }, facts });
const withChrome = (chrome: Partial<PhoneFacts['chrome']>): PhoneFacts => ({ ...open, chrome: { ...open.chrome, ...chrome } });

describe('readiness', () => {
  test('a phone with Chrome open for debugging is ready, with no problem', () => {
    const state = judge(observed([phone({}, open)]));
    expect(state).toMatchObject({ enabled: true, ready: true, adb: { found: true, ...ADB }, problem: undefined });
    expect(state.devices).toEqual([
      {
        serial: 'emulator-5554',
        transport: 'usb',
        state: 'ready',
        model: 'sdk_gphone16k_arm64',
        manufacturer: 'Google',
        android: '17',
        sdk: 37,
        screen: { width: 1080, height: 2092, density: 420, awake: true },
        chrome: { installed: true, version: '150.0.7871.186', running: true, debuggable: true },
        problem: undefined,
      },
    ]);
  });

  const rows: [string, Observed, AndroidProblemCode, Partial<{ ready: boolean; says: RegExp; fix: string; action: string }>?][] = [
    ['switched off in config.json', observed([], { enabled: false, adb: undefined }), 'ANDROID_OFF', { says: /config\.json/, fix: '"android": { "enabled": true }' }],
    ['no adb on macOS', observed([], { adb: null }), 'ADB_MISSING', { fix: 'brew install --cask android-platform-tools' }],
    ['no adb on Windows', observed([], { adb: null, platform: 'win32' }), 'ADB_MISSING', { fix: 'winget install Google.PlatformTools' }],
    ['no adb on Linux', observed([], { adb: null, platform: 'linux' }), 'ADB_MISSING', { fix: 'sudo apt install adb' }],
    ['an adb that does not run', observed([], { adb: { path: ADB.path, broken: 'Bad CPU type in executable' } }), 'ADB_BROKEN', { says: /Bad CPU type in executable\. Reinstall/ }],
    ['adb\'s server that will not start', observed([], { serverError: 'start-server did not start adb\'s server' }), 'ADB_BROKEN'],
    ['adb with no phone', observed([]), 'NO_DEVICE', { says: /USB debugging/ }],
    ['a phone waiting for Allow', observed([phone({ state: 'unauthorized', adbState: 'unauthorized' })]), 'DEVICE_UNAUTHORIZED', { says: /tap Allow/ }],
    ['a phone offline on USB', observed([phone({ state: 'offline', adbState: 'offline' })]), 'DEVICE_OFFLINE', { says: /plug it in again/ }],
    [
      'a phone offline over Wi-Fi',
      observed([phone({ serial: '192.168.1.20:5555', transport: 'wifi', state: 'offline', adbState: 'offline' })]),
      'DEVICE_OFFLINE',
      { fix: 'adb connect 192.168.1.20:5555' },
    ],
    ['a phone in recovery', observed([phone({ state: 'other', adbState: 'recovery' })]), 'DEVICE_OFFLINE', { says: /recovery mode\. Restart it normally/ }],
    ['a phone that stopped answering', observed([phone({}, null)]), 'DEVICE_OFFLINE'],
    ['Linux without udev rules', observed([phone({ state: 'no-permissions', adbState: 'no permissions' })], { platform: 'linux' }), 'NO_PERMISSIONS', { says: /udev/, fix: 'sudo apt install android-sdk-platform-tools-common' }],
    ['a phone still booting', observed([phone({}, { ...open, booted: false })]), 'DEVICE_BOOTING'],
    ['no Chrome on the phone', observed([phone({}, withChrome({ installed: false, version: undefined, running: false, debuggable: false }))]), 'CHROME_MISSING', { action: 'installChrome' }],
    ['Chrome closed', observed([phone({}, withChrome({ running: false, debuggable: false }))]), 'CHROME_NOT_RUNNING', { action: 'launchChrome' }],
    ['Chrome pre-started by Android but never opened', observed([phone({}, withChrome({ running: true, debuggable: false }))]), 'CHROME_NOT_RUNNING'],
    [
      'the screen off, which is only advice',
      observed([phone({}, { ...open, screen: { ...open.screen!, awake: false } })]),
      'SCREEN_OFF',
      { ready: true },
    ],
  ];

  test.each(rows)('%s', (_name, seen, code, expected = {}) => {
    const state = judge(seen);
    expect(state.problem?.code).toBe(code);
    expect(state.ready).toBe(expected.ready ?? false);
    if (expected.says) expect(state.problem?.message).toMatch(expected.says);
    expect(state.problem?.fix).toBe(expected.fix ?? (code === 'ADB_BROKEN' ? '"android": { "adb": "/path/to/adb" }' : undefined));
    if (expected.action) expect(state.problem?.action).toBe(expected.action);
    expect(state.problem?.message).not.toMatch(/\u2014/);
  });

  test('adb problems sit on adb as well as at the top', () => {
    expect(judge(observed([], { adb: null })).adb).toMatchObject({ found: false, problem: { code: 'ADB_MISSING' } });
    expect(judge(observed([], { adb: { path: ADB.path, broken: 'boom' } })).adb).toMatchObject({ found: true, path: ADB.path, problem: { code: 'ADB_BROKEN', message: expect.stringContaining('boom') } });
  });

  test('Windows mentions the USB driver when it sees no phone', () => {
    expect(judge(observed([], { platform: 'win32' })).problem?.message).toMatch(/USB driver/);
    expect(judge(observed([])).problem?.message).not.toMatch(/driver/);
  });

  test('a ready phone beside an unready one makes the whole ready', () => {
    const state = judge(observed([phone({ serial: 'R5CT1234567', state: 'unauthorized', adbState: 'unauthorized' }), phone({}, open)]));
    expect(state.ready).toBe(true);
    expect(state.problem).toBeUndefined();
    expect(state.devices.map((device) => device.problem?.code)).toEqual(['DEVICE_UNAUTHORIZED', undefined]);
  });

  test('the session rides along', () => {
    const session = { serial: 'emulator-5554', since: '2026-10-09T20:00:00.000Z' };
    expect(judge(observed([phone({}, open)], { session })).session).toEqual(session);
  });
});
