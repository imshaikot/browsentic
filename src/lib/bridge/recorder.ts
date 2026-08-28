import { browser } from 'wxt/browser';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import {
  MAX_EVENTS,
  MAX_RECORDING_MS,
  RECORD_CHANNEL,
  WARN_AT_MS,
  hostOf,
  type RecordedEvent,
  type RecordingState,
} from '@/lib/recordings/events';
import {
  analyzeStoredRecording,
  defaultRecordingName,
  putRecording,
  type StoredRecordingMeta,
} from './recording-store';

const ACTIVE_KEY = 'browsentic/recording';
export const WARN_ALARM = 'browsentic/recording-warn';
export const STOP_ALARM = 'browsentic/recording-stop';

export type StopReason = 'user' | 'timeout' | 'tab-closed';

export interface ActiveRecording {
  id: string;
  tabId: number;
  host: string;
  startUrl: string;
  startedAt: number;
  captureValues: boolean;
  events: RecordedEvent[];
  warned: boolean;
}

let listener: ((state: RecordingState | null) => void) | null = null;

export function onRecordingState(fn: (state: RecordingState | null) => void): void {
  listener = fn;
}

async function readActive(): Promise<ActiveRecording | null> {
  const stored = await browser.storage.session.get(ACTIVE_KEY);
  const active = stored[ACTIVE_KEY] as ActiveRecording | undefined;
  return active && Array.isArray(active.events) ? active : null;
}

async function writeActive(active: ActiveRecording | null): Promise<void> {
  if (active) await browser.storage.session.set({ [ACTIVE_KEY]: active });
  else await browser.storage.session.remove(ACTIVE_KEY);
}

export function stateOf(active: ActiveRecording, warning?: string): RecordingState {
  return {
    id: active.id,
    startedAt: active.startedAt,
    elapsedMs: Date.now() - active.startedAt,
    events: active.events.length,
    captureValues: active.captureValues,
    host: active.host,
    warning,
  };
}

export async function currentRecording(): Promise<RecordingState | null> {
  const active = await readActive();
  return active ? stateOf(active) : null;
}

export async function recordingStateFor(
  tabId: number | undefined,
): Promise<{ recording: boolean; captureValues: boolean }> {
  const active = await readActive();
  const match = !!active && active.tabId === tabId;
  return { recording: match, captureValues: match ? active!.captureValues : false };
}

export async function startActiveTabRecording(captureValues: boolean): Promise<ActionResult<RecordingState>> {
  const tab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.id == null || !tab.url) return failure('NO_ACTIVE_TAB', 'No active tab to record.');
  return startRecording({ tabId: tab.id, url: tab.url, captureValues });
}

export async function startRecording(opts: {
  tabId: number;
  url: string;
  captureValues: boolean;
}): Promise<ActionResult<RecordingState>> {
  if (await readActive()) {
    return failure('RECORDING_IN_PROGRESS', 'A recording is already running — stop it before starting another.');
  }
  if (!/^https?:/.test(opts.url)) {
    return failure('UNSUPPORTED', 'Only http(s) pages can be recorded.');
  }

  const active: ActiveRecording = {
    id: crypto.randomUUID(),
    tabId: opts.tabId,
    host: hostOf(opts.url),
    startUrl: opts.url,
    startedAt: Date.now(),
    captureValues: opts.captureValues,
    events: [{ t: Date.now(), kind: 'navigate', url: opts.url }],
    warned: false,
  };
  await writeActive(active);
  await browser.alarms.create(WARN_ALARM, { when: active.startedAt + WARN_AT_MS });
  await browser.alarms.create(STOP_ALARM, { when: active.startedAt + MAX_RECORDING_MS });
  await browser.tabs.sendMessage(opts.tabId, { channel: RECORD_CHANNEL, op: 'begin' }).catch(() => undefined);

  const state = stateOf(active);
  listener?.(state);
  return success(state);
}

export async function appendEvents(tabId: number | undefined, events: RecordedEvent[]): Promise<void> {
  if (!events.length) return;
  const active = await readActive();
  if (!active || active.tabId !== tabId) return;
  if (active.events.length >= MAX_EVENTS) {
    await stopRecording('timeout');
    return;
  }
  active.events.push(...events.slice(0, MAX_EVENTS - active.events.length));
  await writeActive(active);
  listener?.(stateOf(active));
}

export async function stopRecording(reason: StopReason): Promise<ActionResult<{ id: string } | null>> {
  const active = await readActive();
  await browser.alarms.clear(WARN_ALARM);
  await browser.alarms.clear(STOP_ALARM);
  if (!active) {
    listener?.(null);
    return success(null);
  }

  await writeActive(null);
  if (reason !== 'tab-closed') {
    await browser.tabs
      .sendMessage(active.tabId, { channel: RECORD_CHANNEL, op: 'end' })
      .catch(() => undefined);
  }
  listener?.(null);

  const createdAt = active.startedAt;
  const meta: StoredRecordingMeta = {
    id: active.id,
    name: defaultRecordingName(active.host, createdAt),
    host: active.host,
    startUrl: active.startUrl,
    status: 'analyzing',
    capturedValues: active.captureValues,
    events: active.events.length,
    durationMs: Date.now() - active.startedAt,
    createdAt,
    updatedAt: Date.now(),
  };
  await putRecording(meta, { id: active.id, events: active.events });
  void analyzeStoredRecording(active.id);
  return success({ id: active.id });
}

export function serveRecorder(): void {
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    void (async () => {
      const active = await readActive();
      if (!active || active.tabId !== tabId) return;
      const last = active.events[active.events.length - 1];
      if (last?.kind === 'navigate' && last.url === changeInfo.url) return;
      await appendEvents(tabId, [{ t: Date.now(), kind: 'navigate', url: changeInfo.url! }]);
    })();
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const active = await readActive();
      if (active?.tabId === tabId) await stopRecording('tab-closed');
    })();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === STOP_ALARM) {
      void stopRecording('timeout');
      return;
    }
    if (alarm.name !== WARN_ALARM) return;
    void (async () => {
      const active = await readActive();
      if (!active || active.warned) return;
      active.warned = true;
      await writeActive(active);
      const left = Math.max(0, MAX_RECORDING_MS - (Date.now() - active.startedAt));
      listener?.(stateOf(active, `Recording stops automatically in ${formatLeft(left)}.`));
    })();
  });
}

function formatLeft(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
