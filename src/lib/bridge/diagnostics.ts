/**
 * The one debugger session that outlives the action which opened it.
 *
 * Everything else on the CDP bridge attaches for a click and detaches in a `finally`.
 * That cannot work here: `Runtime.consoleAPICalled` and `Network.responseReceived` are
 * delivered only while attached, so by the time an agent thinks to ask what errored, the
 * event it wants happened minutes ago. So this holds the session open — and owns every
 * way it has to close again, because a debugger left attached is a bar across the user's
 * browser that nothing else will take away:
 *
 *   page.stopDiagnostics   the agent is done
 *   the timeout alarm      the agent forgot
 *   the run ending         the agent is gone
 *   the tab closing        the page is gone
 *   Chrome's own onDetach  DevTools took the session, or the user pressed Cancel
 *
 * Buffers are bounded rings kept in `storage.session` behind a debounced write, because
 * a chatty SPA produces thousands of entries and the service worker can die between any
 * two of them. What falls out of a ring is counted, and the count is reported with every
 * read — a truncated picture that says so beats a complete-looking one that lies.
 *
 * Nothing here sanitizes: `invokeForHarness` seals every result on its way out, and
 * header values, URLs and bodies are ordinary strings in an ordinary result object by
 * the time it gets there. What this file does own is which of them are ever *returned* —
 * headers only when asked for, bodies only when the policy has let the call through.
 */

import { browser } from 'wxt/browser';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import {
  ATTACH_SETTLE_MS,
  FIREFOX_HINT,
  FLUSH_DEBOUNCE_MS,
  INFOBAR_NOTICE,
  MAX_ARGS,
  MAX_BODIES,
  MAX_BODY_CHARS,
  MAX_CONSOLE_ENTRIES,
  MAX_DONE_KEPT,
  MAX_NETWORK_ENTRIES,
  MAX_SESSIONS,
  MAX_STACK_FRAMES,
  atLeast,
  clip,
  describeSession,
  levelOf,
  timeoutAlarm,
  DIAGNOSTICS_TIMEOUT_PREFIX,
  type Capture,
  type ConsoleEntry,
  type ConsoleLevel,
  type DiagnosticsPhase,
  type DiagnosticsSession,
  type NetworkEntry,
} from '@/lib/diagnostics/events';
import { hostOf } from '@/lib/recordings/events';
import { attachToTab, detachFromTab, onDebuggerEvent, send, serveDetachEvents, settle } from './cdp';
import { watchForLoad } from './tabs';

const DIAGNOSTICS_KEY = 'browsentic/diagnostics';

const MAX_HEADERS = 30;
const MAX_HEADER_CHARS = 400;

type Store = Record<string, DiagnosticsSession>;

interface QueuedEvent {
  tabId: number;
  method: string;
  params: Record<string, unknown>;
}

let cache: Store | null = null;
let pending: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

async function store(): Promise<Store> {
  if (cache) return cache;
  const held = await browser.storage.session.get(DIAGNOSTICS_KEY).catch(() => ({}) as Record<string, unknown>);
  cache = (held[DIAGNOSTICS_KEY] as Store | undefined) ?? {};
  return cache;
}

function flush(): Promise<void> {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  return cache ? browser.storage.session.set({ [DIAGNOSTICS_KEY]: cache }).catch(() => undefined) : Promise.resolve();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => void flush(), FLUSH_DEBOUNCE_MS);
}

const watching = (map: Store): DiagnosticsSession[] =>
  Object.values(map).filter((session) => session.phase === 'watching');

function forTab(map: Store, tabId: number): DiagnosticsSession | undefined {
  return watching(map).find((session) => session.tabId === tabId);
}

export async function startTabDiagnostics(
  input: { capture: Capture[]; reload: boolean; tabId?: number; timeoutMs: number },
  frameTabId?: number,
  owner?: string,
): Promise<ActionResult> {
  if (import.meta.env.FIREFOX) return failure('UNSUPPORTED', FIREFOX_HINT);

  const explicit = input.tabId ?? frameTabId;
  const tab =
    explicit != null
      ? await browser.tabs.get(explicit).catch(() => undefined)
      : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.id == null || !tab.url) {
    return explicit != null
      ? failure('TARGET_NOT_FOUND', `No tab with id ${explicit} — it has probably been closed.`)
      : failure('NO_ACTIVE_TAB', 'No active tab to record.');
  }
  if (!/^https?:/i.test(tab.url)) {
    return failure('UNSUPPORTED', 'Only http(s) pages report a console and network activity — browser pages do not.');
  }
  if (!input.capture.length) {
    return failure('INVALID_INPUT', 'Give "capture" at least one of "console" or "network" — there is nothing to record otherwise.');
  }

  const map = await store();
  await expireStale(map);

  const already = forTab(map, tab.id);
  if (already) {
    return failure(
      'DIAGNOSTICS_IN_PROGRESS',
      `This tab is already being recorded by ${already.diagnosticsId} — read it with page.readConsole, or stop it first.`,
    );
  }
  if (watching(map).length >= MAX_SESSIONS) {
    return failure(
      'DIAGNOSTICS_LIMIT',
      `${MAX_SESSIONS} tabs are already being recorded — stop one with page.stopDiagnostics first.`,
    );
  }

  const attached = await attachToTab(tab.id);
  if (!attached.ok) return failure('DEBUGGER_UNAVAILABLE', attached.message);

  const enabled = await enableDomains(tab.id, input.capture);
  if (enabled) {
    await detachFromTab(tab.id);
    return failure('DEBUGGER_UNAVAILABLE', enabled);
  }

  const now = Date.now();
  const session: DiagnosticsSession = {
    diagnosticsId: crypto.randomUUID(),
    tabId: tab.id,
    url: tab.url,
    host: hostOf(tab.url),
    owner,
    capture: input.capture,
    phase: 'watching',
    startedAt: now,
    expiresAt: now + input.timeoutMs,
    console: [],
    network: [],
    droppedConsole: 0,
    droppedNetwork: 0,
  };
  map[session.diagnosticsId] = session;
  await flush();
  await browser.alarms.create(timeoutAlarm(session.diagnosticsId), { when: session.expiresAt });
  await settle(ATTACH_SETTLE_MS);

  const reloaded = input.reload ? await reloadTab(tab.id) : undefined;
  return success({ ...describeSession(session), reloaded, notice: INFOBAR_NOTICE });
}

async function reloadTab(tabId: number): Promise<boolean> {
  const loaded = watchForLoad(tabId);
  try {
    await browser.tabs.reload(tabId);
  } catch {
    loaded.cancel();
    return false;
  }
  return loaded.settled;
}

async function enableDomains(tabId: number, capture: Capture[]): Promise<string | null> {
  const session = { tabId };
  try {
    if (capture.includes('console')) {
      await send(session, 'Runtime.enable');
      await send(session, 'Log.enable');
    }
    if (capture.includes('network')) await send(session, 'Network.enable');
    return null;
  } catch (error) {
    return `Chrome attached but refused to start reporting: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function readConsoleFor(input: {
  contains?: string;
  diagnosticsId?: string;
  drain: boolean;
  level: 'all' | ConsoleLevel;
  limit: number;
}): Promise<ActionResult> {
  const picked = await pick(input.diagnosticsId);
  if (!picked.ok) return picked;
  const session = picked.data as DiagnosticsSession;

  const needle = input.contains?.toLowerCase();
  const matched = session.console.filter(
    (entry) =>
      (input.level === 'all' || atLeast(entry.level, input.level)) &&
      (!needle || entry.text.toLowerCase().includes(needle)),
  );
  const shown = matched.slice(-input.limit);

  const dropped = session.droppedConsole;
  if (input.drain) {
    const returned = new Set(shown);
    session.console = session.console.filter((entry) => !returned.has(entry));
    session.droppedConsole = 0;
    await flush();
  }

  return success({
    ...describeSession(session),
    messages: shown,
    matched: matched.length,
    returned: shown.length,
    droppedConsole: dropped,
    truncated: matched.length > shown.length ? `${matched.length - shown.length} older messages not shown — raise "limit" or narrow with "contains".` : undefined,
  });
}

export async function readNetworkFor(input: {
  diagnosticsId?: string;
  drain: boolean;
  includeBodies: boolean;
  includeHeaders: boolean;
  limit: number;
  method?: string;
  status: 'all' | 'problems' | 'failed' | 'pending';
  urlContains?: string;
}): Promise<ActionResult> {
  const picked = await pick(input.diagnosticsId);
  if (!picked.ok) return picked;
  const session = picked.data as DiagnosticsSession;

  const needle = input.urlContains?.toLowerCase();
  const method = input.method?.toUpperCase();
  const matched = session.network.filter(
    (entry) =>
      matchesStatus(entry, input.status) &&
      (!needle || entry.url.toLowerCase().includes(needle)) &&
      (!method || entry.method === method),
  );
  const shown = matched.slice(-input.limit);

  const bodies = input.includeBodies ? await fetchBodies(session, shown) : undefined;

  const dropped = session.droppedNetwork;
  if (input.drain) {
    const returned = new Set(shown);
    session.network = session.network.filter((entry) => !returned.has(entry));
    session.droppedNetwork = 0;
    await flush();
  }

  return success({
    ...describeSession(session),
    requests: shown.map((entry) => project(entry, input.includeHeaders, bodies)),
    matched: matched.length,
    returned: shown.length,
    droppedNetwork: dropped,
    truncated: matched.length > shown.length ? `${matched.length - shown.length} older requests not shown — raise "limit" or narrow with "urlContains".` : undefined,
  });
}

function matchesStatus(entry: NetworkEntry, status: 'all' | 'problems' | 'failed' | 'pending'): boolean {
  if (status === 'all') return true;
  if (status === 'failed') return entry.failed != null;
  if (status === 'pending') return entry.failed == null && entry.status == null;
  return entry.failed != null || (entry.status != null && entry.status >= 400);
}

function project(entry: NetworkEntry, includeHeaders: boolean, bodies?: Map<string, string>) {
  const { mono, requestHeaders, responseHeaders, ...rest } = entry;
  return {
    ...rest,
    requestHeaders: includeHeaders ? requestHeaders : undefined,
    responseHeaders: includeHeaders ? responseHeaders : undefined,
    body: bodies?.get(entry.requestId),
  };
}

async function fetchBodies(session: DiagnosticsSession, entries: NetworkEntry[]): Promise<Map<string, string>> {
  const bodies = new Map<string, string>();
  if (session.phase !== 'watching') {
    for (const entry of entries.slice(-MAX_BODIES)) {
      bodies.set(entry.requestId, 'Not available — this recording has stopped, and Chrome keeps response bodies only while attached.');
    }
    return bodies;
  }
  for (const entry of entries.slice(-MAX_BODIES)) {
    if (entry.status == null) continue;
    try {
      const held = await send<{ body: string; base64Encoded: boolean }>(
        { tabId: session.tabId },
        'Network.getResponseBody',
        { requestId: entry.requestId },
      );
      bodies.set(entry.requestId, held.base64Encoded ? `[${held.body.length} bytes of binary]` : clip(held.body, MAX_BODY_CHARS));
    } catch {
      bodies.set(entry.requestId, 'Not available — Chrome has already discarded this body.');
    }
  }
  return bodies;
}

export async function stopTabDiagnostics(diagnosticsId?: string): Promise<ActionResult> {
  if (import.meta.env.FIREFOX) return failure('UNSUPPORTED', FIREFOX_HINT);
  const map = await store();
  await expireStale(map);
  const live = watching(map);

  if (diagnosticsId != null) {
    const closed = await finish(diagnosticsId, 'stopped');
    if (closed) return success(describeSession(closed));
    const known = map[diagnosticsId];
    return known
      ? failure('DIAGNOSTICS_NOT_FOUND', `Recording ${diagnosticsId} already ended (${known.phase}) — there is nothing to stop.`)
      : failure('DIAGNOSTICS_NOT_FOUND', `No recording with id “${diagnosticsId}”.`);
  }

  if (!live.length) return failure('DIAGNOSTICS_NOT_FOUND', 'Nothing is being recorded.');
  if (live.length > 1) {
    const lines = live.map((session) => `${session.diagnosticsId} · ${session.host} (tab ${session.tabId})`).join('; ');
    return failure(
      'INVALID_TARGET',
      `${live.length} recordings are running, so nothing was stopped — stop one by id: ${lines}`,
    );
  }
  const closed = await finish(live[0].diagnosticsId, 'stopped');
  return closed ? success(describeSession(closed)) : failure('DIAGNOSTICS_NOT_FOUND', 'That recording just ended on its own.');
}

async function pick(diagnosticsId?: string): Promise<ActionResult> {
  if (import.meta.env.FIREFOX) return failure('UNSUPPORTED', FIREFOX_HINT);
  const map = await store();
  await expireStale(map);

  if (diagnosticsId != null) {
    const held = map[diagnosticsId];
    return held
      ? success(held)
      : failure('DIAGNOSTICS_NOT_FOUND', `No recording with id “${diagnosticsId}”. Start one with page.startDiagnostics.`);
  }

  const all = Object.values(map);
  const live = watching(map);
  const candidates = live.length ? live : all;
  if (!candidates.length) {
    return failure(
      'DIAGNOSTICS_NOT_FOUND',
      'Nothing has been recorded. Call page.startDiagnostics first — a page’s console and network activity only exist while Browsentic is attached to it.',
    );
  }
  if (candidates.length > 1) {
    const lines = candidates.map((session) => `${session.diagnosticsId} · ${session.host} (tab ${session.tabId})`).join('; ');
    return failure('INVALID_TARGET', `${candidates.length} recordings to choose from — name one with "diagnosticsId": ${lines}`);
  }
  return success(candidates[0]);
}

async function finish(
  diagnosticsId: string,
  phase: Exclude<DiagnosticsPhase, 'watching'>,
  message?: string,
): Promise<DiagnosticsSession | null> {
  const map = await store();
  const session = map[diagnosticsId];
  if (!session || session.phase !== 'watching') return null;

  session.phase = phase;
  session.message = message ?? closingLine(phase);
  await browser.alarms.clear(timeoutAlarm(diagnosticsId)).catch(() => undefined);
  if (phase !== 'detached' && phase !== 'tab-closed') await detachFromTab(session.tabId);
  trimDone(map);
  await flush();
  return session;
}

function closingLine(phase: Exclude<DiagnosticsPhase, 'watching'>): string {
  const lines: Record<Exclude<DiagnosticsPhase, 'watching'>, string> = {
    stopped: 'Stopped. What was collected is still readable; response bodies are not.',
    timeout: 'Detached on its own after its timeout, so Chrome’s debugger bar did not stay up. What was collected is still readable.',
    detached: 'Chrome took the debugger away — DevTools was opened on this tab, or the debugging bar was dismissed.',
    'tab-closed': 'The tab was closed.',
  };
  return lines[phase];
}

function trimDone(map: Store): void {
  const done = Object.values(map)
    .filter((session) => session.phase !== 'watching')
    .sort((a, b) => a.startedAt - b.startedAt);
  for (const stale of done.slice(0, Math.max(0, done.length - MAX_DONE_KEPT))) delete map[stale.diagnosticsId];
}

async function expireStale(map: Store): Promise<void> {
  const now = Date.now();
  for (const session of watching(map)) {
    if (session.expiresAt <= now) await finish(session.diagnosticsId, 'timeout');
  }
}

async function drop(sessions: DiagnosticsSession[], phase: Exclude<DiagnosticsPhase, 'watching'>): Promise<void> {
  if (!sessions.length) return;
  const map = await store();
  for (const session of sessions) {
    await finish(session.diagnosticsId, phase);
    delete map[session.diagnosticsId];
  }
  await flush();
}

/** A recording belongs to the conversation that opened it and dies with it. */
export async function dropDiagnosticsForSession(sessionId: string): Promise<void> {
  const map = await store();
  await drop(
    Object.values(map).filter((session) => session.owner === sessionId),
    'stopped',
  );
}

export async function dropDiagnosticsForTab(tabId: number): Promise<void> {
  const map = await store();
  await drop(
    Object.values(map).filter((session) => session.tabId === tabId),
    'tab-closed',
  );
}

export function serveDiagnostics(): void {
  if (import.meta.env.FIREFOX) return;

  onDebuggerEvent((source, method, params) => {
    if (source.sessionId || source.tabId == null) return;
    receive(source.tabId, method, (params ?? {}) as Record<string, unknown>);
  });

  serveDetachEvents((tabId) => {
    void store().then((map) => {
      const session = forTab(map, tabId);
      if (session) void finish(session.diagnosticsId, 'detached');
    });
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(DIAGNOSTICS_TIMEOUT_PREFIX)) return;
    void finish(alarm.name.slice(DIAGNOSTICS_TIMEOUT_PREFIX.length), 'timeout');
  });

  browser.tabs.onRemoved.addListener((tabId) => void dropDiagnosticsForTab(tabId));
}

function receive(tabId: number, method: string, params: Record<string, unknown>): void {
  if (!cache) {
    pending.push({ tabId, method, params });
    void store().then(() => {
      const queued = pending;
      pending = [];
      for (const event of queued) apply(event.tabId, event.method, event.params);
      scheduleFlush();
    });
    return;
  }
  apply(tabId, method, params);
}

function apply(tabId: number, method: string, params: Record<string, unknown>): void {
  const session = cache ? forTab(cache, tabId) : undefined;
  if (!session) return;
  const absorb = CONSOLE_EVENTS[method] ?? NETWORK_EVENTS[method];
  if (!absorb) return;
  absorb(session, params);
  scheduleFlush();
}

type Absorb = (session: DiagnosticsSession, params: Record<string, unknown>) => void;

const CONSOLE_EVENTS: Record<string, Absorb> = {
  'Runtime.consoleAPICalled': (session, params) => {
    const args = (params.args as RemoteObject[] | undefined) ?? [];
    const frames = framesOf(params.stackTrace);
    pushConsole(session, {
      t: Date.now(),
      level: levelOf(params.type as string | undefined),
      kind: 'console',
      text: clip(args.slice(0, MAX_ARGS).map(describeArg).filter(Boolean).join(' ')),
      url: frames[0]?.url,
      line: frames[0]?.line,
      column: frames[0]?.column,
      stack: frames.length > 1 ? frames.map(frameText) : undefined,
    });
  },

  'Runtime.exceptionThrown': (session, params) => {
    const details = (params.exceptionDetails ?? {}) as ExceptionDetails;
    const frames = framesOf(details.stackTrace);
    pushConsole(session, {
      t: Date.now(),
      level: 'error',
      kind: 'exception',
      text: clip(details.exception?.description ?? details.text ?? 'Uncaught exception'),
      url: details.url ?? frames[0]?.url,
      line: details.lineNumber != null ? details.lineNumber + 1 : frames[0]?.line,
      column: details.columnNumber != null ? details.columnNumber + 1 : frames[0]?.column,
      stack: frames.length ? frames.map(frameText) : undefined,
    });
  },

  'Log.entryAdded': (session, params) => {
    const entry = (params.entry ?? {}) as LogEntry;
    pushConsole(session, {
      t: Date.now(),
      level: levelOf(entry.level),
      kind: 'browser',
      text: clip(entry.source ? `[${entry.source}] ${entry.text ?? ''}` : (entry.text ?? '')),
      url: entry.url,
      line: entry.lineNumber != null ? entry.lineNumber + 1 : undefined,
    });
  },
};

const NETWORK_EVENTS: Record<string, Absorb> = {
  'Network.requestWillBeSent': (session, params) => {
    const requestId = params.requestId as string;
    const request = (params.request ?? {}) as CdpRequest;
    const redirect = params.redirectResponse as CdpResponse | undefined;
    if (redirect) {
      const previous = find(session, requestId);
      if (previous) {
        previous.status = redirect.status;
        previous.statusText = redirect.statusText || undefined;
        previous.responseHeaders = headersOf(redirect.headers);
        previous.requestId = `${requestId}:${previous.t}`;
      }
    }
    pushNetwork(session, {
      t: (params.wallTime as number | undefined) ? (params.wallTime as number) * 1_000 : Date.now(),
      mono: (params.timestamp as number | undefined) ?? 0,
      requestId,
      method: (request.method ?? 'GET').toUpperCase(),
      url: clip(request.url ?? ''),
      type: params.type as string | undefined,
      requestHeaders: headersOf(request.headers),
    });
  },

  'Network.responseReceived': (session, params) => {
    const entry = find(session, params.requestId as string);
    if (!entry) return;
    const response = (params.response ?? {}) as CdpResponse;
    entry.status = response.status;
    entry.statusText = response.statusText || undefined;
    entry.mimeType = response.mimeType;
    entry.fromCache = response.fromDiskCache === true || response.fromPrefetchCache === true ? true : undefined;
    entry.responseHeaders = headersOf(response.headers);
    entry.type = (params.type as string | undefined) ?? entry.type;
    entry.durationMs = elapsed(entry, params.timestamp as number | undefined);
  },

  'Network.loadingFinished': (session, params) => {
    const entry = find(session, params.requestId as string);
    if (!entry) return;
    entry.sizeBytes = params.encodedDataLength as number | undefined;
    entry.durationMs = elapsed(entry, params.timestamp as number | undefined) ?? entry.durationMs;
  },

  'Network.loadingFailed': (session, params) => {
    const entry = find(session, params.requestId as string);
    if (!entry) return;
    const blocked = params.blockedReason as string | undefined;
    const errorText = (params.errorText as string | undefined) ?? 'Request failed';
    entry.failed = params.canceled === true && !blocked ? `${errorText} (cancelled)` : blocked ? `${errorText} (blocked: ${blocked})` : errorText;
    entry.durationMs = elapsed(entry, params.timestamp as number | undefined) ?? entry.durationMs;
  },
};

function find(session: DiagnosticsSession, requestId: string): NetworkEntry | undefined {
  for (let at = session.network.length - 1; at >= 0; at -= 1) {
    if (session.network[at].requestId === requestId) return session.network[at];
  }
  return undefined;
}

const elapsed = (entry: NetworkEntry, timestamp?: number): number | undefined =>
  timestamp != null && entry.mono ? Math.max(0, Math.round((timestamp - entry.mono) * 1_000)) : undefined;

function pushConsole(session: DiagnosticsSession, entry: ConsoleEntry): void {
  session.console.push(entry);
  const over = session.console.length - MAX_CONSOLE_ENTRIES;
  if (over > 0) {
    session.droppedConsole += over;
    session.console.splice(0, over);
  }
}

function pushNetwork(session: DiagnosticsSession, entry: NetworkEntry): void {
  session.network.push(entry);
  const over = session.network.length - MAX_NETWORK_ENTRIES;
  if (over > 0) {
    session.droppedNetwork += over;
    session.network.splice(0, over);
  }
}

interface RemoteObject {
  type?: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  preview?: { description?: string; properties?: { name: string; value?: string }[]; overflow?: boolean };
}

interface CallFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface ExceptionDetails {
  text?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  exception?: RemoteObject;
  stackTrace?: { callFrames?: CallFrame[] };
}

interface LogEntry {
  source?: string;
  level?: string;
  text?: string;
  url?: string;
  lineNumber?: number;
}

interface CdpRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}

interface CdpResponse {
  status?: number;
  statusText?: string;
  mimeType?: string;
  headers?: Record<string, string>;
  fromDiskCache?: boolean;
  fromPrefetchCache?: boolean;
}

function describeArg(arg: RemoteObject): string {
  if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  if (arg.preview?.properties?.length) {
    const fields = arg.preview.properties.map((property) => `${property.name}: ${property.value ?? '…'}`).join(', ');
    return `${arg.preview.description ?? arg.type ?? ''} {${fields}${arg.preview.overflow ? ', …' : ''}}`.trim();
  }
  return arg.description ?? arg.type ?? '';
}

function framesOf(stackTrace: unknown): { url?: string; line?: number; column?: number; fn: string }[] {
  const frames = (stackTrace as { callFrames?: CallFrame[] } | undefined)?.callFrames ?? [];
  return frames.slice(0, MAX_STACK_FRAMES).map((frame) => ({
    url: frame.url || undefined,
    line: frame.lineNumber != null ? frame.lineNumber + 1 : undefined,
    column: frame.columnNumber != null ? frame.columnNumber + 1 : undefined,
    fn: frame.functionName || '(anonymous)',
  }));
}

const frameText = (frame: { url?: string; line?: number; column?: number; fn: string }): string =>
  `${frame.fn} (${frame.url ?? '<unknown>'}:${frame.line ?? 0}:${frame.column ?? 0})`;

function headersOf(headers?: Record<string, string>): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers).slice(0, MAX_HEADERS)) {
    out[name.toLowerCase()] = clip(String(value), MAX_HEADER_CHARS);
  }
  return out;
}
