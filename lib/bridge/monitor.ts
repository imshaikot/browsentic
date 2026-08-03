import { browser } from 'wxt/browser';
import { injectContentScript } from '@/lib/actions/client';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import {
  AWAIT_MAX_TIMEOUT_MS,
  MAX_DONE_KEPT,
  MAX_MONITORS,
  MAX_SAMPLES,
  MAX_LOGS,
  LOG_MIN_INTERVAL_MS,
  LOG_MIN_PERCENT_STEP,
  MONITOR_CHANNEL,
  NOTIFICATION_PREFIX,
  STALL_WARN_MS,
  STATUS_LOG_TAIL,
  TIMEOUT_ALARM_PREFIX,
  WATCH_ALARM,
  describeUntil,
  estimate,
  formatEta,
  requiredFieldsError,
  timeoutAlarm,
  type MonitorLogEntry,
  type MonitorPhase,
  type MonitorSample,
  type MonitorState,
  type MonitorUntil,
} from '@/lib/monitor/events';
import { hostOf, originOf } from '@/lib/recordings/events';

const MONITORS_KEY = 'browsentic/monitors';
const DONE_KEY = 'browsentic/monitorsDone';

const NO_CONTENT_SCRIPT = 'Receiving end does not exist';

interface ActiveMonitor {
  id: string;
  tabId: number;
  host: string;
  startUrl: string;
  origin: string;
  label?: string;
  until: MonitorUntil;
  startedAt: number;
  timeoutMs: number;
  restorePinned: boolean;
  samples: MonitorSample[];
  logs: MonitorLogEntry[];
  lastProgressAt: number;
  lastLogAt: number;
  lastLogPercent?: number;
  warnedStall: boolean;
}

const listeners = new Set<(state: MonitorState) => void>();
const waiters = new Map<string, Set<(state: MonitorState) => void>>();
let queue: Promise<unknown> = Promise.resolve();

export function onMonitorState(listener: (state: MonitorState) => void): void {
  listeners.add(listener);
}

function fanOut(state: MonitorState): void {
  for (const listener of listeners) listener(state);
}

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readMonitors(): Promise<Record<string, ActiveMonitor>> {
  const stored = await browser.storage.session.get(MONITORS_KEY);
  const map = stored[MONITORS_KEY] as Record<string, ActiveMonitor> | undefined;
  return map ?? {};
}

function writeMonitors(map: Record<string, ActiveMonitor>): Promise<void> {
  return browser.storage.session.set({ [MONITORS_KEY]: map });
}

async function readDone(): Promise<MonitorState[]> {
  const stored = await browser.storage.session.get(DONE_KEY);
  const list = stored[DONE_KEY] as MonitorState[] | undefined;
  return Array.isArray(list) ? list : [];
}

function writeDone(list: MonitorState[]): Promise<void> {
  return browser.storage.session.set({ [DONE_KEY]: list });
}

function stateOf(monitor: ActiveMonitor, phase: MonitorPhase = 'watching', message?: string): MonitorState {
  const now = Date.now();
  const { percent, etaMs } = estimate(monitor.samples, monitor.until.threshold);
  const stalled = now - monitor.lastProgressAt;
  return {
    monitorId: monitor.id,
    tabId: monitor.tabId,
    host: monitor.host,
    label: monitor.label,
    until: monitor.until,
    startedAt: monitor.startedAt,
    elapsedMs: now - monitor.startedAt,
    timeoutMs: monitor.timeoutMs,
    phase,
    percent,
    etaMs: phase === 'watching' ? etaMs : undefined,
    stalledForMs: phase === 'watching' && stalled >= STALL_WARN_MS ? stalled : undefined,
    logs: monitor.logs,
    message,
  };
}

function trimLogs(state: MonitorState): MonitorState {
  return { ...state, logs: state.logs.slice(-STATUS_LOG_TAIL) };
}

function appendLog(monitor: ActiveMonitor, text: string): void {
  monitor.logs.push({ t: Date.now(), text });
  if (monitor.logs.length > MAX_LOGS) monitor.logs.splice(0, monitor.logs.length - MAX_LOGS);
}

export async function startTabMonitor(
  input: { tabId?: number; until: MonitorUntil; label?: string; timeoutMs: number },
  frameTabId?: number,
): Promise<ActionResult> {
  const invalid = requiredFieldsError(input.until);
  if (invalid) return failure('INVALID_INPUT', invalid);

  const explicit = input.tabId ?? frameTabId;
  const tab =
    explicit != null
      ? await browser.tabs.get(explicit).catch(() => undefined)
      : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.id == null || !tab.url) {
    return explicit != null
      ? failure('TARGET_NOT_FOUND', `No tab with id ${explicit} — it has probably been closed.`)
      : failure('NO_ACTIVE_TAB', 'No active tab to watch.');
  }
  if (!/^https?:/i.test(tab.url)) {
    return failure('UNSUPPORTED', 'Only http(s) pages can be watched — browser pages expose nothing to observe.');
  }

  const outcome = await locked(async () => {
    const map = await readMonitors();
    const existing = Object.values(map).find((monitor) => monitor.tabId === tab.id);
    if (existing) {
      return failure(
        'MONITOR_IN_PROGRESS',
        `This tab is already being watched by monitor ${existing.id}${existing.label ? ` (“${existing.label}”)` : ''} — stop it first, or watch a different tab.`,
      );
    }
    if (Object.keys(map).length >= MAX_MONITORS) {
      return failure(
        'MONITOR_LIMIT',
        `${MAX_MONITORS} monitors are already running — stop one with page.stopMonitor first. page.monitorStatus lists them.`,
      );
    }

    const now = Date.now();
    const monitor: ActiveMonitor = {
      id: crypto.randomUUID(),
      tabId: tab.id!,
      host: hostOf(tab.url!),
      startUrl: tab.url!,
      origin: originOf(tab.url!),
      label: input.label,
      until: input.until,
      startedAt: now,
      timeoutMs: input.timeoutMs,
      restorePinned: tab.pinned === true,
      samples: [],
      logs: [],
      lastProgressAt: now,
      lastLogAt: now,
      warnedStall: false,
    };
    appendLog(monitor, `Watching ${monitor.host} ${describeUntil(monitor.until)}.`);
    map[monitor.id] = monitor;
    await writeMonitors(map);
    return success(monitor);
  });
  if (!outcome.ok) return outcome;
  const monitor = outcome.data as ActiveMonitor;

  if (!monitor.restorePinned) await browser.tabs.update(monitor.tabId, { pinned: true }).catch(() => undefined);
  await browser.alarms.create(timeoutAlarm(monitor.id), { when: monitor.startedAt + monitor.timeoutMs });
  await browser.alarms.create(WATCH_ALARM, { periodInMinutes: 1 });
  await sendWatch(monitor);

  const state = stateOf(monitor);
  fanOut(state);
  return success(trimLogs(state));
}

async function sendWatch(monitor: ActiveMonitor): Promise<void> {
  const command = { channel: MONITOR_CHANNEL, op: 'watch', monitorId: monitor.id, until: monitor.until };
  try {
    await browser.tabs.sendMessage(monitor.tabId, command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(NO_CONTENT_SCRIPT)) return;
    if (await injectContentScript(monitor.tabId)) {
      await browser.tabs.sendMessage(monitor.tabId, command).catch(() => undefined);
    }
  }
}

export async function ingestSample(
  tabId: number | undefined,
  monitorId: string,
  sample: MonitorSample,
): Promise<void> {
  const updated = await locked(async () => {
    const map = await readMonitors();
    const monitor = map[monitorId];
    if (!monitor || monitor.tabId !== tabId) return null;

    const previous = monitor.samples.at(-1);
    monitor.samples.push(sample);
    if (monitor.samples.length > MAX_SAMPLES) monitor.samples.splice(0, monitor.samples.length - MAX_SAMPLES);

    const advanced =
      (sample.percent != null && (previous?.percent == null || sample.percent > previous.percent)) ||
      (sample.text !== undefined && sample.text !== previous?.text) ||
      sample.matched !== previous?.matched;
    if (advanced) {
      monitor.lastProgressAt = sample.t;
      monitor.warnedStall = false;
    }

    const { percent, etaMs } = estimate(monitor.samples, monitor.until.threshold);
    if (
      percent != null &&
      (monitor.lastLogPercent == null ||
        percent - monitor.lastLogPercent >= LOG_MIN_PERCENT_STEP ||
        sample.t - monitor.lastLogAt >= LOG_MIN_INTERVAL_MS)
    ) {
      appendLog(monitor, `Progress ${Math.round(percent)}%${etaMs != null ? `, ETA ${formatEta(etaMs)}` : ''}.`);
      monitor.lastLogAt = sample.t;
      monitor.lastLogPercent = percent;
    } else if (percent == null && sample.text && sample.t - monitor.lastLogAt >= LOG_MIN_INTERVAL_MS) {
      appendLog(monitor, `“${sample.text}”`);
      monitor.lastLogAt = sample.t;
    }

    await writeMonitors(map);
    return { monitor: { ...monitor }, complete: sample.matched === true };
  });
  if (!updated) return;
  if (updated.complete) {
    await finishMonitor(monitorId, 'done');
    return;
  }
  fanOut(stateOf(updated.monitor));
}

export async function finishMonitor(
  monitorId: string,
  phase: Exclude<MonitorPhase, 'watching'>,
  message?: string,
): Promise<MonitorState | null> {
  const closed = await locked(async () => {
    const map = await readMonitors();
    const monitor = map[monitorId];
    if (!monitor) return null;
    delete map[monitorId];
    await writeMonitors(map);
    appendLog(monitor, message ?? closingLine(phase));
    const state = stateOf(monitor, phase, message);
    const done = await readDone();
    done.push(state);
    await writeDone(done.slice(-MAX_DONE_KEPT));
    return { monitor, state, remaining: Object.keys(map).length };
  });
  if (!closed) return null;
  const { monitor, state, remaining } = closed;

  await browser.alarms.clear(timeoutAlarm(monitorId));
  if (remaining === 0) await browser.alarms.clear(WATCH_ALARM);
  await restoreTabPin(monitor);
  if (phase !== 'tab-closed') {
    await browser.tabs
      .sendMessage(monitor.tabId, { channel: MONITOR_CHANNEL, op: 'unwatch', monitorId })
      .catch(() => undefined);
  }
  for (const settle of waiters.get(monitorId) ?? []) settle(state);
  waiters.delete(monitorId);
  if (phase !== 'stopped') await notify(state);
  fanOut(state);
  return state;
}

function closingLine(phase: Exclude<MonitorPhase, 'watching'>): string {
  const lines: Record<Exclude<MonitorPhase, 'watching'>, string> = {
    done: 'The watched condition completed.',
    timeout: 'Gave up: the time limit passed without completing.',
    stopped: 'Stopped by the user.',
    'tab-closed': 'The tab was closed.',
    'tab-navigated': 'The tab left the watched site.',
  };
  return lines[phase];
}

async function restoreTabPin(monitor: ActiveMonitor): Promise<void> {
  if (monitor.restorePinned) return;
  const tab = await browser.tabs.get(monitor.tabId).catch(() => null);
  if (tab?.pinned) await browser.tabs.update(monitor.tabId, { pinned: false }).catch(() => undefined);
}

export async function stopTabMonitor(monitorId?: string): Promise<ActionResult> {
  const map = await readMonitors();
  const active = Object.values(map);

  if (monitorId != null) {
    if (!map[monitorId]) {
      const done = (await readDone()).find((state) => state.monitorId === monitorId);
      return done
        ? failure('MONITOR_NOT_FOUND', `Monitor ${monitorId} already finished (${done.phase}) — there is nothing to stop.`)
        : failure('MONITOR_NOT_FOUND', `No monitor with id “${monitorId}”. page.monitorStatus lists what is running.`);
    }
    const state = await finishMonitor(monitorId, 'stopped');
    return state ? success(trimLogs(state)) : failure('MONITOR_NOT_FOUND', `Monitor ${monitorId} just finished on its own.`);
  }

  if (active.length === 0) return failure('MONITOR_NOT_FOUND', 'No monitor is running.');
  if (active.length > 1) {
    const lines = active.map((monitor) => `${monitor.id} · ${monitor.label ?? monitor.host}`).join('; ');
    return failure(
      'INVALID_TARGET',
      `${active.length} monitors are running, so nothing was stopped — stop one by id: ${lines}`,
    );
  }
  const state = await finishMonitor(active[0].id, 'stopped');
  return state ? success(trimLogs(state)) : failure('MONITOR_NOT_FOUND', 'That monitor just finished on its own.');
}

export async function monitorStatusFor(monitorId?: string): Promise<ActionResult> {
  const map = await readMonitors();
  const done = await readDone();

  if (monitorId != null) {
    const active = map[monitorId];
    if (active) return success(trimLogs(stateOf(active)));
    const finished = done.find((state) => state.monitorId === monitorId);
    return finished
      ? success(trimLogs(finished))
      : failure('MONITOR_NOT_FOUND', `No monitor with id “${monitorId}” is running or recently finished.`);
  }

  return success({
    monitors: [...Object.values(map).map((monitor) => trimLogs(stateOf(monitor))), ...done.map(trimLogs)],
  });
}

export async function awaitMonitorDone(monitorId: string, timeoutMs: number): Promise<ActionResult> {
  const map = await readMonitors();
  if (!map[monitorId]) {
    const done = (await readDone()).find((state) => state.monitorId === monitorId);
    return done
      ? success({ settled: true, state: done })
      : failure('MONITOR_NOT_FOUND', `No monitor with id “${monitorId}” is running or recently finished.`);
  }

  return new Promise((resolve) => {
    const set = waiters.get(monitorId) ?? new Set();
    const settle = (state: MonitorState) => {
      clearTimeout(timer);
      set.delete(settle);
      resolve(success({ settled: true, state }));
    };
    set.add(settle);
    waiters.set(monitorId, set);
    const timer = setTimeout(() => {
      void (async () => {
        set.delete(settle);
        const current = (await readMonitors())[monitorId];
        if (current) return resolve(success({ settled: false, state: trimLogs(stateOf(current)) }));
        const done = (await readDone()).find((state) => state.monitorId === monitorId);
        resolve(
          done
            ? success({ settled: true, state: done })
            : failure('MONITOR_NOT_FOUND', `Monitor ${monitorId} disappeared while waiting.`),
        );
      })();
    }, Math.min(timeoutMs, AWAIT_MAX_TIMEOUT_MS));
  });
}

export async function monitorsForTab(tabId: number | undefined): Promise<ActionResult> {
  if (tabId == null) return success({ monitors: [] });
  const map = await readMonitors();
  const monitors = Object.values(map)
    .filter((monitor) => monitor.tabId === tabId)
    .map((monitor) => ({ monitorId: monitor.id, until: monitor.until }));
  return success({ monitors });
}

export async function activeMonitorStates(): Promise<MonitorState[]> {
  const map = await readMonitors();
  return Object.values(map).map((monitor) => stateOf(monitor));
}

export async function completedMonitorStates(): Promise<MonitorState[]> {
  return readDone();
}

export async function acknowledgeCompleted(monitorId?: string): Promise<void> {
  if (monitorId == null) return writeDone([]);
  const done = await readDone();
  await writeDone(done.filter((state) => state.monitorId !== monitorId));
}

export function serveMonitor(): void {
  browser.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      for (const monitor of Object.values(await readMonitors())) {
        if (monitor.tabId === tabId) await finishMonitor(monitor.id, 'tab-closed', 'The tab was closed.');
      }
    })();
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    void (async () => {
      for (const monitor of Object.values(await readMonitors())) {
        if (monitor.tabId !== tabId) continue;
        if (originOf(changeInfo.url!) === monitor.origin) {
          const noted = await locked(async () => {
            const map = await readMonitors();
            const current = map[monitor.id];
            if (!current) return null;
            appendLog(current, `Navigated to ${pathOf(changeInfo.url!)} — still watching.`);
            await writeMonitors(map);
            return { ...current };
          });
          if (noted) fanOut(stateOf(noted));
        } else {
          await finishMonitor(
            monitor.id,
            'tab-navigated',
            `The tab left ${monitor.host} for ${hostOf(changeInfo.url!) || 'another page'}.`,
          );
        }
      }
    })();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(TIMEOUT_ALARM_PREFIX)) {
      void finishMonitor(alarm.name.slice(TIMEOUT_ALARM_PREFIX.length), 'timeout');
      return;
    }
    if (alarm.name !== WATCH_ALARM) return;
    void (async () => {
      const now = Date.now();
      for (const monitor of Object.values(await readMonitors())) {
        await sendWatch(monitor);
        if (now - monitor.lastProgressAt < STALL_WARN_MS || monitor.warnedStall) continue;
        const warned = await locked(async () => {
          const map = await readMonitors();
          const current = map[monitor.id];
          if (!current || current.warnedStall) return null;
          current.warnedStall = true;
          appendLog(current, `No change for ${Math.round((now - current.lastProgressAt) / 60_000)} minutes.`);
          await writeMonitors(map);
          return { ...current };
        });
        if (warned) fanOut(stateOf(warned));
      }
    })();
  });

  browser.notifications?.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    const monitorId = notificationId.slice(NOTIFICATION_PREFIX.length);
    void (async () => {
      const done = (await readDone()).find((state) => state.monitorId === monitorId);
      const tabId = done?.tabId ?? (await readMonitors())[monitorId]?.tabId;
      if (tabId == null) return;
      const tab = await browser.tabs.update(tabId, { active: true }).catch(() => null);
      if (tab?.windowId != null) await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
      await browser.notifications.clear(notificationId).catch(() => undefined);
    })();
  });
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

async function notify(state: MonitorState): Promise<void> {
  const name = state.label ?? state.host;
  const copy: Partial<Record<MonitorPhase, { title: string; message: string }>> = {
    done: { title: `Done: ${name}`, message: `Finished after ${clock(state.elapsedMs)}.` },
    timeout: { title: `Still going: ${name}`, message: `Watched for ${clock(state.elapsedMs)} without completing.` },
    'tab-closed': { title: 'Monitor ended — tab closed', message: `${name} was closed before finishing.` },
    'tab-navigated': { title: 'Monitor ended — tab moved on', message: state.message ?? `The tab left ${state.host}.` },
  };
  const content = copy[state.phase];
  if (!content) return;
  await browser.notifications
    ?.create(`${NOTIFICATION_PREFIX}${state.monitorId}`, {
      type: 'basic',
      iconUrl: largestIcon(),
      title: content.title,
      message: content.message,
    })
    .catch(() => undefined);
}

function largestIcon(): string {
  const icons = browser.runtime.getManifest().icons ?? {};
  const sizes = Object.keys(icons)
    .map(Number)
    .sort((a, b) => b - a);
  return icons[sizes[0]] ?? '';
}

function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
