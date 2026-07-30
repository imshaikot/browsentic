export const START_RECORDING_ACTION = 'voicelink.startRecording';
export const STOP_RECORDING_ACTION = 'voicelink.stopRecording';

export const MAX_EVENTS = 2000;
export const MAX_RECORDING_MS = 15 * 60_000;
export const WARN_AT_MS = 13 * 60_000;

export const MAX_VALUE_CHARS = 120;
export const MAX_TEXT_CHARS = 80;
export const MAX_SELECTOR_CHARS = 200;

export const FLUSH_INTERVAL_MS = 1_000;
export const FLUSH_AT_EVENTS = 20;
export const SCROLL_INTERVAL_MS = 1_000;
export const SCROLL_BEFORE_CLICK_MS = 1_200;
export const CLICK_DEDUP_MS = 250;

export interface RecordedTarget {
  selector: string;
  text?: string;
  role?: string;
}

export type RecordedEvent =
  | { t: number; kind: 'click'; target: RecordedTarget; url: string }
  | {
      t: number;
      kind: 'fill';
      target: RecordedTarget;
      field: string;
      inputKind: string;
      value: string;
      url: string;
    }
  | { t: number; kind: 'select'; target: RecordedTarget; value: string; label?: string; url: string }
  | { t: number; kind: 'key'; key: string; modifiers: string[]; target?: RecordedTarget; url: string }
  | { t: number; kind: 'submit'; target: RecordedTarget; url: string }
  | { t: number; kind: 'scroll'; y: number; url: string }
  | { t: number; kind: 'copy'; target: RecordedTarget; length: number; url: string }
  | { t: number; kind: 'navigate'; url: string };

export interface RecordingState {
  id: string;
  startedAt: number;
  elapsedMs: number;
  events: number;
  captureValues: boolean;
  host: string;
  warning?: string;
}

const SENSITIVE_NAME = /pass|ssn|card|cvv|cvc|otp|secret|token|pin\b/i;
const SENSITIVE_AUTOCOMPLETE = /cc-|new-password|current-password|one-time-code/i;

export function isSensitiveField(field: {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  value?: string;
}): boolean {
  const type = (field.type ?? '').toLowerCase();
  if (type === 'password' || type === 'hidden') return true;
  if (SENSITIVE_AUTOCOMPLETE.test(field.autocomplete ?? '')) return true;
  if (SENSITIVE_NAME.test(field.name ?? '') || SENSITIVE_NAME.test(field.id ?? '')) return true;
  return looksLikeCardNumber(field.value ?? '');
}

export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function variableSlug(field: string, taken: ReadonlySet<string>): string {
  const base =
    field
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'value';
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_x`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
