import { browser } from 'wxt/browser';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import {
  BUSY_RETRY_MS,
  MAX_TIMER_LOGS,
  MAX_TIMER_SKIPS,
  MAX_TIMERS,
  MAX_TIMERS_KEPT,
  NOTIFICATION_PREFIX,
  STATUS_LOG_TAIL,
  TIMER_ALARM_PREFIX,
  describeSchedule,
  timerAlarm,
  type TimerDelivery,
  type TimerLogEntry,
  type TimerPhase,
  type TimerState,
} from '@/lib/timers/events';

const TIMERS_KEY = 'browsentic/timers';
const DONE_KEY = 'browsentic/timersDone';

interface ScheduledTimer {
  id: string;
  sessionId?: string;
  label?: string;
  prompt: string;
  deliver: TimerDelivery;
  afterMs: number;
  repeat: boolean;
  maxRuns: number;
  runs: number;
  skipped: number;
  createdAt: number;
  nextFireAt: number;
  lastFiredAt?: number;
  logs: TimerLogEntry[];
}

export type TimerHandoff = 'delivered' | 'busy' | 'gone';

type Deliverer = (sessionId: string, prompt: string, label: string) => Promise<TimerHandoff>;

let handOff: Deliverer | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function onTimerFire(deliverer: Deliverer): void {
  handOff = deliverer;
}

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readTimers(): Promise<Record<string, ScheduledTimer>> {
  const stored = await browser.storage.session.get(TIMERS_KEY);
  return (stored[TIMERS_KEY] as Record<string, ScheduledTimer> | undefined) ?? {};
}

function writeTimers(map: Record<string, ScheduledTimer>): Promise<void> {
  return browser.storage.session.set({ [TIMERS_KEY]: map });
}

async function readDone(): Promise<TimerState[]> {
  const stored = await browser.storage.session.get(DONE_KEY);
  const list = stored[DONE_KEY] as TimerState[] | undefined;
  return Array.isArray(list) ? list : [];
}

function writeDone(list: TimerState[]): Promise<void> {
  return browser.storage.session.set({ [DONE_KEY]: list });
}

function stateOf(timer: ScheduledTimer, phase: TimerPhase = 'scheduled', message?: string): TimerState {
  return {
    timerId: timer.id,
    label: timer.label,
    prompt: timer.prompt,
    deliver: timer.deliver,
    sessionId: timer.sessionId,
    afterMs: timer.afterMs,
    repeat: timer.repeat,
    maxRuns: timer.maxRuns,
    runs: timer.runs,
    skipped: timer.skipped,
    createdAt: timer.createdAt,
    nextFireAt: phase === 'scheduled' ? timer.nextFireAt : undefined,
    lastFiredAt: timer.lastFiredAt,
    phase,
    logs: timer.logs,
    message,
  };
}

function trimLogs(state: TimerState): TimerState {
  return { ...state, logs: state.logs.slice(-STATUS_LOG_TAIL) };
}

function appendLog(timer: ScheduledTimer, text: string): void {
  timer.logs.push({ t: Date.now(), text });
  if (timer.logs.length > MAX_TIMER_LOGS) timer.logs.splice(0, timer.logs.length - MAX_TIMER_LOGS);
}

const nameOf = (timer: ScheduledTimer): string => timer.label ?? 'timer';

export async function startJobTimer(
  input: {
    prompt: string;
    afterMs: number;
    repeat: boolean;
    maxRuns: number;
    label?: string;
    deliver: TimerDelivery;
  },
  sessionId?: string,
): Promise<ActionResult> {
  if (input.deliver === 'agent' && !sessionId) {
    return failure(
      'NO_CONVERSATION',
      'Nothing here can be woken with a prompt — a timer only hands work back inside a Browsentic side-panel conversation. Pass deliver: "notify" to remind the user at that time instead, or schedule the job with your own client’s scheduler.',
    );
  }

  const outcome = await locked(async () => {
    const map = await readTimers();
    if (Object.keys(map).length >= MAX_TIMERS) {
      return failure(
        'TIMER_LIMIT',
        `${MAX_TIMERS} timers are already scheduled — cancel one with page.stopTimer first. page.timerStatus lists them.`,
      );
    }
    const now = Date.now();
    const timer: ScheduledTimer = {
      id: crypto.randomUUID(),
      sessionId,
      label: input.label,
      prompt: input.prompt,
      deliver: input.deliver,
      afterMs: input.afterMs,
      repeat: input.repeat,
      maxRuns: input.repeat ? input.maxRuns : 1,
      runs: 0,
      skipped: 0,
      createdAt: now,
      nextFireAt: now + input.afterMs,
      logs: [],
    };
    appendLog(timer, `Scheduled to fire ${describeSchedule(timer)}.`);
    map[timer.id] = timer;
    await writeTimers(map);
    return success(timer);
  });
  if (!outcome.ok) return outcome;

  const timer = outcome.data as ScheduledTimer;
  await arm(timer);
  return success(trimLogs(stateOf(timer)));
}

function arm(timer: ScheduledTimer): Promise<void> {
  return browser.alarms.create(timerAlarm(timer.id), {
    when: timer.nextFireAt,
    ...(timer.repeat ? { periodInMinutes: timer.afterMs / 60_000 } : {}),
  });
}

async function fireTimer(timerId: string): Promise<void> {
  const due = (await readTimers())[timerId];
  if (!due) {
    await browser.alarms.clear(timerAlarm(timerId));
    return;
  }

  const outcome = await deliverOnce(due);
  if (outcome === 'gone') {
    await finishTimer(timerId, 'orphaned', 'The conversation this timer belonged to is gone.');
    return;
  }

  const advanced = await locked(async () => {
    const map = await readTimers();
    const timer = map[timerId];
    if (!timer) return null;
    const now = Date.now();
    if (outcome === 'busy') {
      timer.skipped += 1;
      appendLog(timer, 'Skipped — the conversation was still working on the previous turn.');
    } else {
      timer.runs += 1;
      timer.lastFiredAt = now;
      appendLog(timer, `Fired — run ${timer.runs}${timer.repeat ? ` of ${timer.maxRuns}` : ''}.`);
    }
    timer.nextFireAt = now + (timer.repeat || outcome === 'delivered' ? timer.afterMs : BUSY_RETRY_MS);
    await writeTimers(map);
    return { ...timer };
  });
  if (!advanced) return;

  if (advanced.skipped >= MAX_TIMER_SKIPS) {
    await finishTimer(
      timerId,
      'finished',
      `Gave up after ${advanced.skipped} fires found the conversation still busy — the job takes longer than the interval it was given.`,
    );
    return;
  }

  if (!advanced.repeat) {
    if (outcome === 'delivered') await finishTimer(timerId, 'finished');
    else await arm(advanced);
    return;
  }
  if (advanced.runs >= advanced.maxRuns) {
    await finishTimer(timerId, 'finished', `Fired ${advanced.runs} times, which is the limit that was set.`);
  }
}

async function deliverOnce(timer: ScheduledTimer): Promise<TimerHandoff> {
  if (timer.deliver === 'notify') {
    await notify(timer.id, timer.label ?? 'Browsentic timer', timer.prompt);
    return 'delivered';
  }
  if (!timer.sessionId || !handOff) return 'gone';
  return handOff(timer.sessionId, timer.prompt, nameOf(timer));
}

export async function finishTimer(
  timerId: string,
  phase: Exclude<TimerPhase, 'scheduled'>,
  message?: string,
): Promise<TimerState | null> {
  const closed = await locked(async () => {
    const map = await readTimers();
    const timer = map[timerId];
    if (!timer) return null;
    delete map[timerId];
    await writeTimers(map);
    appendLog(timer, message ?? closingLine(phase));
    const state = stateOf(timer, phase, message);
    await writeDone([...(await readDone()), state].slice(-MAX_TIMERS_KEPT));
    return state;
  });
  if (!closed) return null;

  await browser.alarms.clear(timerAlarm(timerId));
  if (phase === 'orphaned') {
    await notify(
      timerId,
      `Timer ended: ${closed.label ?? 'scheduled job'}`,
      'The conversation it was set in has closed, so it was cancelled.',
    );
  }
  return closed;
}

function closingLine(phase: Exclude<TimerPhase, 'scheduled'>): string {
  const lines: Record<Exclude<TimerPhase, 'scheduled'>, string> = {
    finished: 'The schedule ran out.',
    stopped: 'Cancelled.',
    orphaned: 'The conversation this timer belonged to is gone.',
  };
  return lines[phase];
}

export async function stopJobTimer(timerId?: string): Promise<ActionResult> {
  const scheduled = Object.values(await readTimers());

  if (timerId != null) {
    const state = await finishTimer(timerId, 'stopped');
    if (state) return success(trimLogs(state));
    const done = (await readDone()).find((finished) => finished.timerId === timerId);
    return done
      ? failure('TIMER_NOT_FOUND', `Timer ${timerId} already ended (${done.phase}) — there is nothing to cancel.`)
      : failure('TIMER_NOT_FOUND', `No timer with id “${timerId}”. page.timerStatus lists what is scheduled.`);
  }

  if (scheduled.length === 0) return failure('TIMER_NOT_FOUND', 'No timer is scheduled.');
  if (scheduled.length > 1) {
    const lines = scheduled.map((timer) => `${timer.id} · ${nameOf(timer)} (${describeSchedule(timer)})`).join('; ');
    return failure(
      'INVALID_TARGET',
      `${scheduled.length} timers are scheduled, so nothing was cancelled — cancel one by id: ${lines}`,
    );
  }
  const state = await finishTimer(scheduled[0].id, 'stopped');
  return state ? success(trimLogs(state)) : failure('TIMER_NOT_FOUND', 'That timer just ended on its own.');
}

export async function timerStatusFor(timerId?: string): Promise<ActionResult> {
  const map = await readTimers();
  const done = await readDone();

  if (timerId != null) {
    const scheduled = map[timerId];
    if (scheduled) return success(trimLogs(stateOf(scheduled)));
    const finished = done.find((state) => state.timerId === timerId);
    return finished
      ? success(trimLogs(finished))
      : failure('TIMER_NOT_FOUND', `No timer with id “${timerId}” is scheduled or recently finished.`);
  }

  return success({
    timers: [...Object.values(map).map((timer) => trimLogs(stateOf(timer))), ...done.map(trimLogs)],
  });
}

export async function dropTimersForSession(sessionId: string): Promise<void> {
  for (const timer of Object.values(await readTimers())) {
    if (timer.sessionId === sessionId) await finishTimer(timer.id, 'orphaned', 'The conversation was ended.');
  }
}

export function serveTimers(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(TIMER_ALARM_PREFIX)) return;
    void fireTimer(alarm.name.slice(TIMER_ALARM_PREFIX.length));
  });

  browser.notifications?.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    void browser.notifications.clear(notificationId).catch(() => undefined);
  });
}

async function notify(timerId: string, title: string, message: string): Promise<void> {
  await browser.notifications
    ?.create(`${NOTIFICATION_PREFIX}${timerId}`, {
      type: 'basic',
      iconUrl: largestIcon(),
      title,
      message,
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
