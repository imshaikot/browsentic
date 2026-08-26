export const MAX_TIMERS = 5;
export const MIN_TIMER_MS = 30_000;
export const MAX_TIMER_MS = 24 * 60 * 60_000;
export const DEFAULT_MAX_RUNS = 12;
export const MAX_TIMER_RUNS = 500;
export const MAX_PROMPT_CHARS = 2_000;
export const BUSY_RETRY_MS = 60_000;
export const MAX_TIMER_SKIPS = 20;
export const MAX_TIMER_LOGS = 20;
export const MAX_TIMERS_KEPT = 6;
export const STATUS_LOG_TAIL = 5;

export const TIMER_ALARM_PREFIX = 'browsentic/timer:';

export const timerAlarm = (timerId: string): string => `${TIMER_ALARM_PREFIX}${timerId}`;

export const NOTIFICATION_PREFIX = 'browsentic-timer:';

export type TimerDelivery = 'agent' | 'notify';

export type TimerPhase = 'scheduled' | 'finished' | 'stopped' | 'orphaned';

export interface TimerLogEntry {
  t: number;
  text: string;
}

export interface TimerSchedule {
  afterMs: number;
  repeat: boolean;
  maxRuns: number;
}

export interface TimerState extends TimerSchedule {
  timerId: string;
  label?: string;
  prompt: string;
  deliver: TimerDelivery;
  sessionId?: string;
  runs: number;
  skipped: number;
  createdAt: number;
  nextFireAt?: number;
  lastFiredAt?: number;
  phase: TimerPhase;
  logs: TimerLogEntry[];
  message?: string;
}

export function humanMs(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${Number((ms / 3_600_000).toFixed(1))}h`;
}

export function describeSchedule(schedule: TimerSchedule): string {
  return schedule.repeat
    ? `every ${humanMs(schedule.afterMs)}, up to ${schedule.maxRuns} times`
    : `once in ${humanMs(schedule.afterMs)}`;
}
