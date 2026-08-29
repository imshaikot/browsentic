/**
 * What a diagnostics session holds, as data.
 *
 * A page's console and network activity only exist while Chrome's debugger is attached,
 * which is why this is a session rather than a read: `withDebugger` attaches for one
 * action and detaches in a `finally`, and by then every interesting event has already
 * been and gone. The caps below are the whole safety story for a session that outlives
 * one call — a chatty SPA fills a ring in seconds, so the rings are bounded, every entry
 * is truncated, and what fell out is counted and reported rather than quietly lost.
 */

export const DIAGNOSTICS_TIMEOUT_PREFIX = 'browsentic/diagnostics-timeout:';

export const timeoutAlarm = (diagnosticsId: string): string => `${DIAGNOSTICS_TIMEOUT_PREFIX}${diagnosticsId}`;

export const MAX_SESSIONS = 2;
export const MAX_DONE_KEPT = 2;

export const MIN_TIMEOUT_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 5 * 60_000;
export const MAX_TIMEOUT_MS = 30 * 60_000;

export const MAX_CONSOLE_ENTRIES = 500;
export const MAX_NETWORK_ENTRIES = 1_000;
export const MAX_ENTRY_CHARS = 2_000;
export const MAX_STACK_FRAMES = 8;
export const MAX_ARGS = 6;

export const MAX_BODIES = 5;
export const MAX_BODY_CHARS = 4_000;

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export const FLUSH_DEBOUNCE_MS = 200;
export const ATTACH_SETTLE_MS = 150;

export const INFOBAR_NOTICE =
  'Chrome is showing “Browsentic is debugging this browser” and will keep showing it until this session is stopped — tell the user that is why the bar appeared, and call page.stopDiagnostics as soon as you have what you need.';

export const FIREFOX_HINT =
  'Reading a page’s console and network activity needs Chrome’s debugger, which Firefox does not expose. There is no Firefox equivalent — read what the page renders with page.extractText instead.';

export type Capture = 'console' | 'network';

export type ConsoleLevel = 'error' | 'warn' | 'info' | 'debug' | 'log';

export type ConsoleKind = 'console' | 'exception' | 'browser';

export interface ConsoleEntry {
  t: number;
  level: ConsoleLevel;
  kind: ConsoleKind;
  text: string;
  url?: string;
  line?: number;
  column?: number;
  stack?: string[];
}

export interface NetworkEntry {
  t: number;
  mono: number;
  requestId: string;
  method: string;
  url: string;
  type?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  fromCache?: boolean;
  durationMs?: number;
  sizeBytes?: number;
  failed?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export type DiagnosticsPhase = 'watching' | 'stopped' | 'timeout' | 'detached' | 'tab-closed';

export interface DiagnosticsSession {
  diagnosticsId: string;
  tabId: number;
  url: string;
  host: string;
  owner?: string;
  capture: Capture[];
  phase: DiagnosticsPhase;
  startedAt: number;
  expiresAt: number;
  message?: string;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  droppedConsole: number;
  droppedNetwork: number;
}

const CONSOLE_LEVELS: Record<string, ConsoleLevel> = {
  error: 'error',
  assert: 'error',
  warning: 'warn',
  warn: 'warn',
  info: 'info',
  debug: 'debug',
  verbose: 'debug',
};

export const levelOf = (type: string | undefined): ConsoleLevel => CONSOLE_LEVELS[type ?? ''] ?? 'log';

const SEVERITY: Record<ConsoleLevel, number> = { debug: 0, log: 1, info: 2, warn: 3, error: 4 };

export const atLeast = (level: ConsoleLevel, floor: ConsoleLevel): boolean => SEVERITY[level] >= SEVERITY[floor];

export const clip = (text: string, max = MAX_ENTRY_CHARS): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

export function describeSession(session: DiagnosticsSession) {
  return {
    diagnosticsId: session.diagnosticsId,
    tabId: session.tabId,
    url: session.url,
    host: session.host,
    capture: session.capture,
    phase: session.phase,
    startedAt: session.startedAt,
    expiresAt: session.phase === 'watching' ? session.expiresAt : undefined,
    consoleBuffered: session.console.length,
    networkBuffered: session.network.length,
    droppedConsole: session.droppedConsole,
    droppedNetwork: session.droppedNetwork,
    message: session.message,
  };
}
