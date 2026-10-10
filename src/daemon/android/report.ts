import { phoneReport, type CheckMark, type PhoneCheck, type PhoneReport } from '@/lib/phone/checks';
import { PHONE_GUIDE, type GuideStep } from '@/lib/phone/guide';
import type { AndroidFixAction, AndroidProblemCode, AndroidState } from '@/lib/phone/types';

const LABEL_WIDTH = 19;
const INDENT = ' '.repeat(LABEL_WIDTH + 2);
const MARKS: Record<CheckMark, string> = { passed: '✓', failed: '✗', advisory: '·' };
const ACTION_HINTS: Record<AndroidFixAction, string> = {
  launchChrome: 'Open it on the phone, or run "browsentic android open".',
  installChrome: 'Run "browsentic android open" to open its Play Store page on the phone.',
};

export interface AndroidJson extends AndroidState {
  guide: readonly GuideStep[];
  report: PhoneReport;
}

export const androidJson = (state: AndroidState): AndroidJson => ({ ...state, guide: PHONE_GUIDE, report: phoneReport(state) });

/** What follows `browsentic android`: `open`, a URL, and `--serial <serial>` anywhere among them. */
export function androidArgs(args: readonly string[]): { sub?: string; url?: string; serial?: string } {
  const serialAt = args.indexOf('--serial');
  const serial = serialAt >= 0 ? args[serialAt + 1] : undefined;
  const [sub, url] = args.filter((arg, index) => !arg.startsWith('--') && (serialAt < 0 || index !== serialAt + 1));
  return { sub, url, serial };
}

/** `browsentic android`: the shared checklist as text, then the setup steps while no phone is connected and allowed. */
export function androidLines(state: AndroidState): string[] {
  const report = phoneReport(state);
  const sections = report.sections.flatMap((section) => [...(section.serial ? ['', section.serial] : []), ...section.checks.flatMap(checkLines)]);
  const closing = report.summary ? ['', report.summary] : report.guided ? guide() : [];
  return [...sections, ...closing];
}

function checkLines(check: PhoneCheck): string[] {
  return [
    `${MARKS[check.mark]} ${check.label.padEnd(LABEL_WIDTH)}${check.value}`,
    ...(check.fix ? [`${INDENT}${check.fix}`] : []),
    ...(check.action ? [`${INDENT}${ACTION_HINTS[check.action]}`] : []),
  ];
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
