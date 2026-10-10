import type { AndroidDevice, AndroidFixAction, AndroidProblem, AndroidProblemCode, AndroidState } from './types';

export type CheckMark = 'passed' | 'failed' | 'advisory';

export interface PhoneCheck {
  label: string;
  mark: CheckMark;
  value: string;
  fix?: string;
  action?: AndroidFixAction;
  code?: AndroidProblemCode;
}

export interface PhoneSection {
  /** Set when more than one phone is connected, to head that phone's checks. */
  serial?: string;
  checks: PhoneCheck[];
}

/** The checklist every surface shows, in one order and one wording: the CLI prints it, the apps draw it. */
export interface PhoneReport {
  sections: PhoneSection[];
  ready: boolean;
  /** The setup steps answer what is wrong: the phone is not connected or not allowed yet. */
  guided: boolean;
  /** A closing line once a phone is ready. */
  summary?: string;
}

const PHONE_ROW_PROBLEMS: ReadonlySet<AndroidProblemCode> = new Set(['DEVICE_OFFLINE', 'NO_PERMISSIONS', 'DEVICE_BOOTING']);
const GUIDED: ReadonlySet<AndroidProblemCode> = new Set(['ADB_MISSING', 'NO_DEVICE', 'DEVICE_UNAUTHORIZED']);

const passed = (label: string, value: string): PhoneCheck => ({ label, mark: 'passed', value });

const failed = (label: string, problem: AndroidProblem, mark: CheckMark = 'failed', value = problem.message): PhoneCheck => ({
  label,
  mark,
  value,
  fix: problem.fix,
  action: problem.action,
  code: problem.code,
});

export function phoneReport(state: AndroidState): PhoneReport {
  const guided = !state.ready && !!state.problem && GUIDED.has(state.problem.code);
  if (!state.enabled) return { sections: state.problem ? [{ checks: [failed('Android', state.problem, 'advisory')] }] : [], ready: false, guided: false };

  const adb = state.adb.problem
    ? failed('adb', state.adb.problem)
    : passed('adb', `${state.adb.path}${state.adb.version ? ` (${state.adb.version})` : ''}`);
  if (state.adb.problem) return { sections: [{ checks: [adb] }], ready: false, guided };

  const several = state.devices.length > 1;
  const phones: PhoneSection[] = state.devices.length
    ? state.devices.map((device) => ({ ...(several ? { serial: device.serial } : {}), checks: deviceChecks(device, several) }))
    : [{ checks: state.problem ? [failed('Phone', state.problem)] : [] }];
  return {
    sections: [{ checks: [adb] }, ...phones],
    ready: state.ready,
    guided,
    summary: state.ready
      ? state.session
        ? `Android is on in a browser, driving ${state.session.serial}.`
        : 'Ready. Switch on Android in the Browsentic side panel to drive it.'
      : undefined,
  };
}

function deviceChecks(device: AndroidDevice, several: boolean): PhoneCheck[] {
  const problem = device.problem;
  const code = problem?.code;
  const phone = [
    device.model ?? 'Android phone',
    ...(device.android ? [`Android ${device.android}`] : []),
    device.transport === 'wifi' ? 'Wi-Fi' : 'USB',
  ].join(', ');
  const named = `${phone}${several ? '' : ` (${device.serial})`}`;

  if (problem && code && PHONE_ROW_PROBLEMS.has(code)) return [failed('Phone', problem, 'failed', `${named}: ${problem.message}`)];
  const checks = [passed('Phone', named)];
  if (problem && code === 'DEVICE_UNAUTHORIZED') return [...checks, failed('USB debugging', problem)];
  checks.push(passed('USB debugging', 'allowed'));
  if (problem && code === 'CHROME_MISSING') return [...checks, failed('Chrome', problem)];
  checks.push(passed('Chrome', device.chrome.version ?? 'installed'));
  if (problem && code === 'CHROME_NOT_RUNNING') return [...checks, failed('Chrome open', problem)];
  checks.push(passed('Chrome open', 'its DevTools socket is open'));
  if (problem && code === 'SCREEN_OFF') return [...checks, failed('Screen', problem, 'advisory')];
  return [...checks, passed('Screen', 'awake')];
}
