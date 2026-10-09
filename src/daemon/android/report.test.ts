import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { AndroidState } from '@/lib/phone/types';
import { parseDeviceList } from './devices';
import { parseFacts, type PhoneFacts } from './phone-facts';
import { judge, type Observed } from './readiness';
import { androidArgs, androidJson, androidLines, androidStatus } from './report';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const ADB = { path: '/Users/me/Library/Android/sdk/platform-tools/adb', version: '37.0.0-14910828' };
const [emulator] = parseDeviceList(fixture('devices-emulator.txt'));
const open = parseFacts(fixture('facts-chrome-open.txt'));
const SESSION = { serial: 'emulator-5554', since: '2026-10-09T19:10:01.839Z' };

const seen = (devices: Observed['devices'], more: Partial<Observed> = {}): AndroidState =>
  judge({ enabled: true, platform: 'darwin', adb: ADB, devices, ...more });
const phone = (facts: PhoneFacts | null = open, device = emulator) => ({ device, facts });
const chrome = (change: Partial<PhoneFacts['chrome']>): PhoneFacts => ({ ...open, chrome: { ...open.chrome, ...change } });

const STATES = {
  ready: seen([phone()]),
  adbMissing: seen([], { adb: null }),
  noDevice: seen([]),
  unauthorized: seen([phone(null, { ...emulator, serial: 'R5CT1234567', state: 'unauthorized', adbState: 'unauthorized', model: undefined })]),
};

const text = (state: AndroidState) => androidLines(state).join('\n');

describe('browsentic android', () => {
  test('ready: every check passes, and the side panel is next', () => {
    expect(text(STATES.ready)).toBe(
      [
        '✓ adb                /Users/me/Library/Android/sdk/platform-tools/adb (37.0.0-14910828)',
        '✓ Phone              sdk_gphone16k_arm64, Android 17, USB (emulator-5554)',
        '✓ USB debugging      allowed',
        '✓ Chrome             150.0.7871.186',
        '✓ Chrome open        its DevTools socket is open',
        '✓ Screen             awake',
        '',
        'Ready. Switch on Android in the Browsentic side panel to drive it.',
      ].join('\n'),
    );
  });

  test('in use: says which phone a browser is driving', () => {
    expect(androidLines({ ...STATES.ready, session: SESSION }).at(-1)).toBe('Android is on in a browser, driving emulator-5554.');
  });

  test('no adb: the adb row fails with the install command, then the setup steps', () => {
    const lines = androidLines(STATES.adbMissing);
    expect(lines.slice(0, 2)).toEqual([
      expect.stringMatching(/^✗ adb {16}Browsentic reaches your phone through adb/),
      '                     brew install --cask android-platform-tools',
    ]);
    expect(lines).toContain('To connect a phone:');
    expect(lines.filter((line) => /^ {2}\d\. /.test(line))).toHaveLength(6);
  });

  test('no phone: the phone row fails, then the setup steps, with the Wi-Fi one marked for Android 11', () => {
    const lines = androidLines(STATES.noDevice);
    expect(lines[1]).toBe('✗ Phone              No Android phone is connected.');
    expect(lines.find((line) => line.startsWith('  4. '))).toMatch(/^ {2}4\. Or connect over Wi-Fi \(Android 11 or later\): /);
  });

  test('waiting for Allow: the USB debugging row fails with what to tap', () => {
    expect(androidLines(STATES.unauthorized).slice(1, 4)).toEqual([
      '✓ Phone              Android phone, USB (R5CT1234567)',
      '✗ USB debugging      The phone has not allowed this computer yet.',
      '                     Unlock your phone and tap Allow on the USB debugging prompt. If no prompt shows, unplug the phone and plug it in again.',
    ]);
  });

  const failingRows: [string, AndroidState, string][] = [
    ['offline', seen([phone(null, { ...emulator, state: 'offline', adbState: 'offline' })]), '✗ Phone              sdk gphone16k arm64, USB (emulator-5554): The phone is connected but not answering adb.'],
    ['silent', seen([phone(null)]), '✗ Phone              sdk gphone16k arm64, USB (emulator-5554): The phone stopped answering adb.'],
    ['booting', seen([phone({ ...open, booted: false })]), '✗ Phone              sdk_gphone16k_arm64, Android 17, USB (emulator-5554): The phone is still starting up.'],
    ['no udev rules', seen([phone(null, { ...emulator, state: 'no-permissions', adbState: 'no permissions' })], { platform: 'linux' }), "✗ Phone              sdk gphone16k arm64, USB (emulator-5554): This computer is not allowed to open the phone's USB connection."],
    ['no Chrome', seen([phone(chrome({ installed: false, version: undefined, running: false, debuggable: false }))]), '✗ Chrome             Chrome is not installed on the phone.'],
    ['Chrome closed', seen([phone(chrome({ running: false, debuggable: false }))]), '✗ Chrome open        Chrome is not open on the phone.'],
    ['adb broken', seen([], { adb: { path: ADB.path, broken: 'Bad CPU type in executable' } }), `✗ adb                adb at ${ADB.path} does not run: Bad CPU type in executable`],
  ];

  test.each(failingRows)('%s: one failing row, and nothing past it', (_name, state, failing) => {
    const lines = androidLines(state);
    const at = lines.indexOf(failing);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines.slice(0, at).every((line) => line.startsWith('✓ '))).toBe(true);
    expect(lines.slice(at + 1).some((line) => /^[✓✗·] /.test(line))).toBe(false);
  });

  test('only a phone not yet connected or allowed gets the setup steps', () => {
    const guided = (state: AndroidState) => androidLines(state).includes('To connect a phone:');
    expect([STATES.adbMissing, STATES.noDevice, STATES.unauthorized].map(guided)).toEqual([true, true, true]);
    expect(failingRows.map(([, state]) => guided(state))).toEqual(failingRows.map(() => false));
  });

  test('Chrome closed also names the command that opens it', () => {
    const lines = androidLines(failingRows[5][1]);
    const at = lines.indexOf('✗ Chrome open        Chrome is not open on the phone.');
    expect(lines.slice(at, at + 3)).toEqual([
      '✗ Chrome open        Chrome is not open on the phone.',
      '                     Open Chrome on the phone.',
      '                     or run "browsentic android open"',
    ]);
  });

  test('the screen off is advice under a ready phone', () => {
    const lines = androidLines(seen([phone({ ...open, screen: { ...open.screen!, awake: false } })]));
    expect(lines).toContain("· Screen             The phone's screen is off, so Chrome is not drawing the page.");
    expect(lines.at(-1)).toMatch(/^Ready\./);
  });

  test('switched off is one line', () => {
    expect(androidLines(judge({ enabled: false, platform: 'darwin', devices: [] }))).toEqual([
      '· Android            Android is switched off for this computer.',
      '                     Set "android": { "enabled": true } in ~/.browsentic/config.json',
    ]);
  });

  test('two phones get a block each, headed by its serial', () => {
    const lines = androidLines(seen([phone(), phone(null, { ...emulator, serial: 'R5CT1234567', state: 'unauthorized', adbState: 'unauthorized' })]));
    expect(lines.filter((line) => line === 'emulator-5554' || line === 'R5CT1234567')).toEqual(['emulator-5554', 'R5CT1234567']);
    expect(lines.indexOf('R5CT1234567')).toBe(lines.indexOf('emulator-5554') + 7);
  });
});

describe('the command line', () => {
  test.each<[string[], ReturnType<typeof androidArgs>]>([
    [[], { sub: undefined, url: undefined, serial: undefined }],
    [['--json'], { sub: undefined, url: undefined, serial: undefined }],
    [['open'], { sub: 'open', url: undefined, serial: undefined }],
    [['open', 'https://example.com/'], { sub: 'open', url: 'https://example.com/', serial: undefined }],
    [['open', '--serial', 'R5CT1234567', 'https://example.com/'], { sub: 'open', url: 'https://example.com/', serial: 'R5CT1234567' }],
    [['--serial', 'R5CT1234567', 'open'], { sub: 'open', url: undefined, serial: 'R5CT1234567' }],
  ])('%j', (args, parsed) => {
    expect(androidArgs(args)).toEqual(parsed);
  });
});

describe('the status line', () => {
  test.each<[string, AndroidState | null, string]>([
    ['not watched', null, 'not checked (no browser is watching for phones)'],
    ['ready', STATES.ready, 'ready (sdk_gphone16k_arm64, Chrome 150)'],
    ['ready and in use', { ...STATES.ready, session: SESSION }, 'ready (sdk_gphone16k_arm64, Chrome 150), in use'],
    ['screen off', seen([phone({ ...open, screen: { ...open.screen!, awake: false } })]), 'ready (sdk_gphone16k_arm64, Chrome 150), screen off'],
    ['Chrome closed', seen([phone(chrome({ debuggable: false }))]), 'phone connected, Chrome closed'],
    ['no phone', STATES.noDevice, 'no phone'],
    ['no adb', STATES.adbMissing, 'adb not found'],
    ['waiting for Allow', STATES.unauthorized, 'phone connected, waiting for Allow on the phone'],
    ['off', judge({ enabled: false, platform: 'darwin', devices: [] }), 'off in config.json'],
  ])('%s', (_name, state, line) => {
    expect(androidStatus(state)).toBe(line);
  });
});

describe('--json, as the apps read it', () => {
  test.each(Object.entries(STATES))('%s', async (name, state) => {
    const json = androidJson(state);
    expect(json.guide).toHaveLength(6);
    await expect(`${JSON.stringify(json, null, 2)}\n`).toMatchFileSnapshot(`../../lib/phone/fixtures/android-${name}.json`);
  });
});
