import type { Target } from '@/lib/actions/page/dom';

export const MONITOR_CHANNEL = 'browsentic/monitor';

export const MAX_MONITORS = 3;
export const DEFAULT_MONITOR_TIMEOUT_MS = 30 * 60_000;
export const MAX_MONITOR_TIMEOUT_MS = 4 * 60 * 60_000;
export const AWAIT_DEFAULT_TIMEOUT_MS = 2 * 60_000;
export const AWAIT_MAX_TIMEOUT_MS = 10 * 60_000;
export const STALL_WARN_MS = 2 * 60_000;
export const SAMPLE_MIN_INTERVAL_MS = 3_000;
export const EVAL_DEBOUNCE_MS = 500;
export const BACKSTOP_INTERVAL_MS = 5_000;
export const MAX_LOGS = 50;
export const MAX_SAMPLES = 24;
export const MAX_DONE_KEPT = 6;
export const LOG_MIN_PERCENT_STEP = 5;
export const LOG_MIN_INTERVAL_MS = 30_000;
export const MAX_TEXT_SCAN_CHARS = 30_000;
export const STATUS_LOG_TAIL = 5;

export const WATCH_ALARM = 'browsentic/monitor-watch';
export const TIMEOUT_ALARM_PREFIX = 'browsentic/monitor-timeout:';

export const timeoutAlarm = (monitorId: string): string => `${TIMEOUT_ALARM_PREFIX}${monitorId}`;

export const NOTIFICATION_PREFIX = 'browsentic-monitor:';

export type UntilKind =
  | 'element-appears'
  | 'element-vanishes'
  | 'text-matches'
  | 'progress-reaches'
  | 'title-matches';

export interface MonitorUntil {
  kind: UntilKind;
  target?: Target;
  pattern?: string;
  threshold: number;
}

export interface MonitorSample {
  t: number;
  percent?: number;
  matched?: boolean;
  text?: string;
}

export interface MonitorLogEntry {
  t: number;
  text: string;
}

export type MonitorPhase = 'watching' | 'done' | 'timeout' | 'stopped' | 'tab-closed' | 'tab-navigated';

export interface MonitorState {
  monitorId: string;
  tabId: number;
  host: string;
  label?: string;
  until: MonitorUntil;
  startedAt: number;
  elapsedMs: number;
  timeoutMs: number;
  phase: MonitorPhase;
  percent?: number;
  etaMs?: number;
  stalledForMs?: number;
  logs: MonitorLogEntry[];
  message?: string;
}

const NEEDS_TARGET: readonly UntilKind[] = ['element-appears', 'element-vanishes', 'progress-reaches'];
const NEEDS_PATTERN: readonly UntilKind[] = ['text-matches', 'title-matches'];

export function requiredFieldsError(until: MonitorUntil): string | null {
  if (NEEDS_TARGET.includes(until.kind) && !until.target?.selector && !until.target?.text) {
    return `until.kind "${until.kind}" needs a "target" with a selector or text — page.findProgress lists candidates with their selectors`;
  }
  if (NEEDS_PATTERN.includes(until.kind)) {
    if (!until.pattern) {
      return `until.kind "${until.kind}" needs a "pattern" — a regular expression for the text that marks completion, e.g. "upload complete|processing finished"`;
    }
    try {
      new RegExp(until.pattern, 'i');
    } catch (error) {
      return `until.pattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return null;
}

export function describeUntil(until: MonitorUntil): string {
  const targetLabel = until.target?.text ?? until.target?.selector ?? '';
  switch (until.kind) {
    case 'element-appears':
      return `until “${targetLabel}” appears`;
    case 'element-vanishes':
      return `until “${targetLabel}” disappears`;
    case 'text-matches':
      return `until the page ${targetLabel ? `(in “${targetLabel}”) ` : ''}matches /${until.pattern}/`;
    case 'progress-reaches':
      return `until “${targetLabel}” reaches ${until.threshold}%`;
    case 'title-matches':
      return `until the tab title matches /${until.pattern}/`;
  }
}

export function estimate(
  samples: readonly MonitorSample[],
  threshold: number,
): { percent?: number; etaMs?: number } {
  const dated = samples.filter((sample) => typeof sample.percent === 'number');
  const latest = dated.at(-1);
  if (!latest) return {};
  const percent = latest.percent!;
  const oldest = dated[0];
  const spanMs = latest.t - oldest.t;
  const gained = percent - oldest.percent!;
  if (dated.length < 2 || spanMs < 10_000 || gained <= 0) return { percent };
  const etaMs = ((threshold - percent) / gained) * spanMs;
  return { percent, etaMs: Math.max(0, Math.round(etaMs / 10_000) * 10_000) };
}

export function formatEta(etaMs: number): string {
  const minutes = Math.round(etaMs / 60_000);
  if (minutes < 1) return 'under a minute';
  return `~${minutes} min`;
}
