import { PHONE_GUIDE, type GuideStep } from '@/lib/phone/guide';
import type { AndroidDevice, AndroidProblem, AndroidProblemCode, AndroidState } from '@/lib/phone/types';

const LABEL_WIDTH = 19;
const INDENT = ' '.repeat(LABEL_WIDTH + 2);

type Mark = '✓' | '·' | '✗';

const row = (mark: Mark, label: string, value: string): string => `${mark} ${label.padEnd(LABEL_WIDTH)}${value}`;

const failed = (label: string, problem: AndroidProblem, mark: Mark = '✗'): string[] => [
  row(mark, label, problem.message),
  ...(problem.fix ? [`${INDENT}${problem.fix}`] : []),
];

const PHONE_ROW_PROBLEMS: ReadonlySet<AndroidProblemCode> = new Set(['DEVICE_OFFLINE', 'NO_PERMISSIONS', 'DEVICE_BOOTING']);

/** Problems the setup steps answer. Once the phone is connected and allowed, each row's own fix says more than the steps would. */
const GUIDED: ReadonlySet<AndroidProblemCode> = new Set(['ADB_MISSING', 'NO_DEVICE', 'DEVICE_UNAUTHORIZED']);

export interface AndroidJson extends AndroidState {
  guide: readonly GuideStep[];
}

export const androidJson = (state: AndroidState): AndroidJson => ({ ...state, guide: PHONE_GUIDE });

/** What follows `browsentic android`: `open`, a URL, and `--serial <serial>` anywhere among them. */
export function androidArgs(args: readonly string[]): { sub?: string; url?: string; serial?: string } {
  const serialAt = args.indexOf('--serial');
  const serial = serialAt >= 0 ? args[serialAt + 1] : undefined;
  const [sub, url] = args.filter((arg, index) => !arg.startsWith('--') && (serialAt < 0 || index !== serialAt + 1));
  return { sub, url, serial };
}

/** `browsentic android`: one checklist row per check, stopping at the first that fails, then the setup steps while no phone is connected and allowed. */
export function androidLines(state: AndroidState): string[] {
  if (!state.enabled) return state.problem ? failed('Android', state.problem, '·') : [];
  const adb = state.adb.problem ? failed('adb', state.adb.problem) : [row('✓', 'adb', `${state.adb.path}${state.adb.version ? ` (${state.adb.version})` : ''}`)];
  if (state.adb.problem) return [...adb, ...(GUIDED.has(state.adb.problem.code) ? guide() : [])];

  const phones = state.devices.length
    ? state.devices.flatMap((device, index) => [...(index ? [''] : []), ...deviceLines(device, state.devices.length > 1)])
    : state.problem
      ? failed('Phone', state.problem)
      : [];
  const closing = state.ready
    ? ['', state.session ? `Android is on in a browser, driving ${state.session.serial}.` : 'Ready. Switch on Android in the Browsentic side panel to drive it.']
    : state.problem && GUIDED.has(state.problem.code)
      ? guide()
      : [];
  return [...adb, ...phones, ...closing];
}

function deviceLines(device: AndroidDevice, several: boolean): string[] {
  const problem = device.problem;
  const code = problem?.code;
  const phone = [
    device.model ?? 'Android phone',
    ...(device.android ? [`Android ${device.android}`] : []),
    device.transport === 'wifi' ? 'Wi-Fi' : 'USB',
  ].join(', ');
  const heading = several ? [device.serial] : [];
  const phoneRow = `${phone}${several ? '' : ` (${device.serial})`}`;

  if (code && PHONE_ROW_PROBLEMS.has(code)) return [...heading, ...failed('Phone', { ...problem, message: `${phoneRow}: ${problem.message}` })];
  const lines = [...heading, row('✓', 'Phone', phoneRow)];
  if (code === 'DEVICE_UNAUTHORIZED') return [...lines, ...failed('USB debugging', problem!)];
  lines.push(row('✓', 'USB debugging', 'allowed'));
  if (code === 'CHROME_MISSING') return [...lines, ...failed('Chrome', problem!)];
  lines.push(row('✓', 'Chrome', device.chrome.version ?? 'installed'));
  if (code === 'CHROME_NOT_RUNNING') return [...lines, ...failed('Chrome open', problem!), `${INDENT}or run "browsentic android open"`];
  lines.push(row('✓', 'Chrome open', 'its DevTools socket is open'));
  if (code === 'SCREEN_OFF') return [...lines, ...failed('Screen', problem!, '·')];
  return [...lines, row('✓', 'Screen', 'awake')];
}

function guide(): string[] {
  return ['', 'To connect a phone:', ...PHONE_GUIDE.map((step, index) => `  ${index + 1}. ${step.title}${step.platform === 'android11+' ? ' (Android 11 or later)' : ''}: ${step.detail}`)];
}

const SHORT: Record<AndroidProblemCode, string> = {
  ANDROID_OFF: 'off in config.json',
  ADB_MISSING: 'adb not found',
  ADB_BROKEN: 'adb does not run',
  NO_DEVICE: 'no phone',
  DEVICE_UNAUTHORIZED: 'phone connected, waiting for Allow on the phone',
  DEVICE_OFFLINE: 'phone connected, not answering',
  DEVICE_BOOTING: 'phone starting up',
  NO_PERMISSIONS: 'phone connected, no USB permission',
  CHROME_MISSING: 'phone connected, no Chrome',
  CHROME_NOT_RUNNING: 'phone connected, Chrome closed',
  SCREEN_OFF: 'screen off',
};

/** `browsentic status`'s line: what the Bridge already knows, or `not checked` when nobody has asked it to look. */
export function androidStatus(state: AndroidState | null): string {
  if (!state) return 'not checked (no browser is watching for phones)';
  const drivable = state.devices.find((device) => device.state === 'ready' && device.chrome.debuggable);
  if (!state.ready || !drivable) return state.problem ? SHORT[state.problem.code] : 'not ready';
  const chrome = drivable.chrome.version ? `, Chrome ${drivable.chrome.version.split('.')[0]}` : '';
  const extras = [...(drivable.problem ? [SHORT[drivable.problem.code]] : []), ...(state.session ? ['in use'] : [])];
  return `ready (${drivable.model ?? drivable.serial}${chrome})${extras.length ? `, ${extras.join(', ')}` : ''}`;
}
