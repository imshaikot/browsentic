import { browser } from 'wxt/browser';
import { failure, success, type ActionResult } from '@/lib/actions/protocol';
import type { AndroidDevice, PhoneClosedReason, PhoneOpened, PhoneTarget } from '@/lib/phone/types';
import { DAEMON_STATE_KEY, closePhone, launchPhoneChrome, onDaemonClosed, onPhoneClosed, openPhone, type DaemonState } from './socket';

export const PHONE_KEY = 'browsentic/phone';
export const PHONE_PAGE = '/phone.html';
const NOTIFICATION_ID = 'browsentic/phone-chrome';

export type PhoneEndReason = PhoneClosedReason | 'bridge-gone';

/**
 * The one phone session, while it is on. Session storage on purpose: a browser that restarts comes
 * back without a phone session, as it does without hands-free mode.
 */
export interface PhoneSession {
  serial: string;
  model?: string;
  transport?: AndroidDevice['transport'];
  mirrorTabId: number;
  windowId: number;
  openedAt: number;
  targets: PhoneTarget[];
  /** The tab the mirror follows: the one in front on the phone, found once the mirror starts. */
  activeTargetId?: string;
  /** Chrome was not open on the phone; the mirror waits, and the notification offers to open it. */
  waitingForChrome?: boolean;
  /** The session is over but its mirror tab is still open, to say why and offer to reconnect. */
  ended?: { reason: PhoneEndReason; at: number };
}

export const isLive = (session: PhoneSession | null | undefined): boolean => !!session && !session.ended;

let queue: Promise<unknown> = Promise.resolve();

function locked<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

export async function readPhone(): Promise<PhoneSession | null> {
  const stored = await browser.storage.session.get(PHONE_KEY);
  return (stored[PHONE_KEY] as PhoneSession | undefined) ?? null;
}

const writePhone = (session: PhoneSession | null): Promise<void> =>
  session ? browser.storage.session.set({ [PHONE_KEY]: session }) : browser.storage.session.remove(PHONE_KEY);

/** A change to the live session, made in turn with every other; nothing happens when there is none. */
export function updatePhone(change: (session: PhoneSession) => PhoneSession): Promise<PhoneSession | null> {
  return locked(async () => {
    const held = await readPhone();
    if (!held || held.ended) return held;
    const next = change(held);
    await writePhone(next);
    return next;
  });
}

const opening = (opened: ActionResult<PhoneOpened>) =>
  opened.ok
    ? { targets: opened.data.targets, activeTargetId: undefined, waitingForChrome: false }
    : { targets: [], activeTargetId: undefined, waitingForChrome: true };

async function deviceOf(serial: string): Promise<AndroidDevice | undefined> {
  const stored = await browser.storage.session.get(DAEMON_STATE_KEY);
  return (stored[DAEMON_STATE_KEY] as DaemonState | undefined)?.android?.devices.find((device) => device.serial === serial);
}

/**
 * Starts the session and opens its mirror beside the tab the user is on. A second start for the same
 * phone shows the mirror already open; one for another phone moves the session, and its tab, to it.
 */
export function startPhone(serial: string, windowId?: number): Promise<ActionResult<PhoneSession>> {
  return locked(async () => {
    const held = await readPhone();
    if (held && !held.ended && held.serial === serial) {
      await showTab(held.mirrorTabId, held.windowId);
      return success(held);
    }
    if (held && !held.ended) closePhone(held.serial);

    const opened = await openPhone(serial);
    if (!opened.ok && opened.error.code !== 'CHROME_NOT_RUNNING') return opened;

    const reusable = held && (await tabExists(held.mirrorTabId)) ? held : null;
    const mirror = reusable ? await showTab(reusable.mirrorTabId, reusable.windowId) : await openMirror(windowId);
    if (!mirror?.id) {
      if (opened.ok) closePhone(serial);
      return failure('BRIDGE_ERROR', 'The phone tab could not be opened.');
    }
    const session: PhoneSession = {
      serial,
      mirrorTabId: mirror.id,
      windowId: mirror.windowId ?? windowId ?? browser.windows.WINDOW_ID_CURRENT,
      openedAt: Date.now(),
      ...opening(opened),
      ...(await describedPhone(serial, opened)),
    };
    await writePhone(session);
    if (session.waitingForChrome) await askToOpenChrome(session);
    return success(session);
  });
}

/** Ends the session. Turned off or closed by the user, its mirror goes too; ended by the phone or the Bridge, the mirror stays to say why. */
export function endPhone(reason: PhoneEndReason): Promise<void> {
  return locked(async () => {
    const held = await readPhone();
    if (!held) return;
    if (reason === 'closed') {
      if (!held.ended) closePhone(held.serial);
      await writePhone(null);
      await clearNotification();
      if (await tabExists(held.mirrorTabId)) await browser.tabs.remove(held.mirrorTabId).catch(() => undefined);
      return;
    }
    if (held.ended) return;
    await writePhone({ ...held, ended: { reason, at: Date.now() } });
  });
}

/** Asks Chrome on the phone to open, then tries the session again: what the notification's button and the mirror's button do. */
export function openChromeOnPhone(): Promise<ActionResult<PhoneSession>> {
  return locked(async () => {
    const held = await readPhone();
    if (!held || held.ended) return failure('PHONE_GONE', 'Android is off. Switch it on in the side panel.');
    const launched = await launchPhoneChrome(held.serial);
    if (!launched.ok) return launched;
    const opened = await openPhone(held.serial);
    const session = { ...held, ...opening(opened) };
    await writePhone(session);
    if (!session.waitingForChrome) await clearNotification();
    return success(session);
  });
}

export function servePhone(): void {
  browser.tabs.onRemoved.addListener((tabId) => {
    void readPhone().then((held) => {
      if (held?.mirrorTabId === tabId) void endPhone('closed');
    });
  });
  onPhoneClosed((serial, reason) => {
    void readPhone().then((held) => {
      if (held?.serial === serial) void endPhone(reason);
    });
  });
  onDaemonClosed(() => void endPhone('bridge-gone'));
  browser.notifications?.onClicked.addListener((notificationId) => {
    if (notificationId !== NOTIFICATION_ID) return;
    void readPhone().then((held) => held && showTab(held.mirrorTabId, held.windowId));
  });
  browser.notifications?.onButtonClicked?.addListener((notificationId) => {
    if (notificationId === NOTIFICATION_ID) void openChromeOnPhone();
  });
}

async function describedPhone(serial: string, opened: ActionResult<PhoneOpened>): Promise<Pick<PhoneSession, 'model' | 'transport'>> {
  const device = opened.ok ? opened.data.device : await deviceOf(serial);
  return { model: device?.model, transport: device?.transport };
}

async function openMirror(windowId?: number) {
  const [current] = await browser.tabs.query(windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId });
  return browser.tabs.create({
    url: (browser.runtime.getURL as (path: string) => string)(PHONE_PAGE),
    windowId: current?.windowId ?? windowId,
    index: current ? current.index + 1 : undefined,
    openerTabId: current?.id,
    active: true,
  });
}

async function showTab(tabId: number, windowId: number) {
  const tab = await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
  await browser.windows.update(tab?.windowId ?? windowId, { focused: true }).catch(() => undefined);
  return tab;
}

const tabExists = (tabId: number): Promise<boolean> =>
  browser.tabs.get(tabId).then(
    (tab) => !!tab,
    () => false,
  );

async function askToOpenChrome(session: PhoneSession): Promise<void> {
  await browser.notifications
    ?.create(NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: largestIcon(),
      title: 'Open Chrome on your phone',
      message: `Browsentic needs Chrome running on ${session.model ?? 'your phone'} to show and drive it.`,
      buttons: [{ title: 'Open Chrome' }],
    })
    .catch(() => undefined);
}

const clearNotification = () => browser.notifications?.clear(NOTIFICATION_ID).catch(() => undefined);

function largestIcon(): string {
  const icons = browser.runtime.getManifest().icons ?? {};
  const [largest] = Object.keys(icons)
    .map(Number)
    .sort((a, b) => b - a);
  return icons[largest] ?? '';
}
