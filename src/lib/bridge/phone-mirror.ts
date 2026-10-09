import { browser, type Browser } from 'wxt/browser';
import { PHONE_PORT, keyEvents, type MirrorCommand, type MirrorMessage, type PageState } from '@/lib/phone/mirror';
import type { PhoneTarget } from '@/lib/phone/types';
import { numbered, onPhoneReset, readPhone, updatePhone, type PhoneSession } from './phone';
import { refusalFor } from './site-guard';
import { onCdpEvent, onDaemonClosed, onPhoneClosed, sendCdp, type CdpEvent } from './socket';
import { hostOf, patchSession, sessionForTab } from './tab-sessions';

type Port = Browser.runtime.Port;
type InputCommand = Extract<MirrorCommand, { op: 'touch' | 'wheel' | 'text' | 'key' }>;

/** Discovery also reports a phantom `"1"` beside a restored tab, and every command sent to it hangs (spike Q3). */
const REAL_TARGET = /^[0-9A-F]{32}$/i;
const CLOSED_TAB_SETTLE_MS = 300;
const ACTIVATE_TRIES = 4;
const ACTIVATE_SETTLE_MS = 250;

interface Followed {
  serial: string;
  targetId: string;
  sessionId: string;
}

const ports = new Set<Port>();
const watchers = new Set<Port>();
let followed: Followed | null = null;
let streaming = false;
let page: PageState | null = null;
let finding: Promise<void> | null = null;
const inputs: InputCommand[] = [];
let pumping = false;
const attachments = new Map<string, Promise<string | null>>();

const broadcast = (message: MirrorMessage) => {
  for (const port of ports) port.postMessage(message);
};

const tellError = (message: string) => broadcast({ kind: 'error', message });

interface TargetInfo {
  targetId?: string;
  type?: string;
  url?: string;
  title?: string;
}

const isPageTarget = (info: TargetInfo): info is TargetInfo & { targetId: string } => info.type === 'page' && REAL_TARGET.test(info.targetId ?? '');

async function liveSession(): Promise<PhoneSession | null> {
  const session = await readPhone();
  return session && !session.ended && !session.waitingForChrome ? session : null;
}

function call(method: string, params?: Record<string, unknown>) {
  const held = followed;
  return held ? sendCdp(held.serial, method, params, held.sessionId) : Promise.resolve(null);
}

/** One DevTools session per phone tab, shared by the mirror and the tools, made on first use. */
export function attachedSession(serial: string, targetId: string): Promise<string | null> {
  const held = attachments.get(targetId);
  if (held) return held;
  const attaching = sendCdp(serial, 'Target.attachToTarget', { targetId, flatten: true }).then(async (attached) => {
    if (!attached.ok) {
      attachments.delete(targetId);
      return null;
    }
    const sessionId = String(attached.data.sessionId);
    await sendCdp(serial, 'Page.enable', {}, sessionId);
    return sessionId;
  });
  attachments.set(targetId, attaching);
  return attaching;
}

/** Moves the mirror, and with it the conversation's idea of the current phone tab, to this one. */
export async function followTarget(targetId: string): Promise<void> {
  const session = await liveSession();
  if (session) await follow(session, targetId);
}

async function reflect(url: string, title: string): Promise<void> {
  const phone = await readPhone();
  const conversation = phone && (await sessionForTab(phone.mirrorTabId));
  if (!conversation?.phone || (conversation.url === url && conversation.title === title)) return;
  await patchSession(conversation.sessionId, { url, host: hostOf(url), title: title || conversation.title });
}

async function follow(session: PhoneSession, targetId: string): Promise<void> {
  if (followed?.serial === session.serial && followed.targetId === targetId) return;
  await stopStream();
  followed = null;
  const sessionId = await attachedSession(session.serial, targetId);
  if (!sessionId) return tellError('The phone did not let Browsentic attach to that tab.');
  followed = { serial: session.serial, targetId, sessionId };
  await updatePhone((held) => ({ ...held, activeTargetId: targetId }));
  await publishPage();
  if (watchers.size) await startStream();
}

async function ensureFollowed(): Promise<void> {
  const session = await liveSession();
  if (!session) return;
  if (followed && followed.serial !== session.serial) followed = null;
  if (followed) return;
  const known = session.targets.find((target) => target.targetId === session.activeTargetId);
  if (known) return follow(session, known.targetId);
  await findFront();
  if (!followed && session.targets[0]) await follow(session, session.targets[0].targetId);
}

async function startStream(): Promise<void> {
  if (!followed) return;
  const wifi = (await readPhone())?.transport === 'wifi';
  streaming = true;
  const started = await call('Page.startScreencast', { format: 'jpeg', quality: wifi ? 40 : 60, maxWidth: wifi ? 540 : 720, maxHeight: 1600, everyNthFrame: 1 });
  if (started && !started.ok) {
    streaming = false;
    tellError(started.error.message);
  }
}

async function stopStream(): Promise<void> {
  if (!followed || !streaming) return;
  streaming = false;
  await call('Page.stopScreencast');
}

async function publishPage(): Promise<void> {
  const held = followed;
  if (!held) return;
  const history = await call('Page.getNavigationHistory');
  if (!history?.ok || followed !== held) return;
  const entries = (history.data.entries as { id: number; url: string; title: string }[] | undefined) ?? [];
  const current = Number(history.data.currentIndex ?? entries.length - 1);
  const entry = entries[current];
  page = {
    targetId: held.targetId,
    url: entry?.url ?? '',
    title: entry?.title ?? '',
    canGoBack: current > 0,
    canGoForward: current < entries.length - 1,
  };
  broadcast({ kind: 'page', ...page });
  await reflect(page.url, page.title);
}

/** A tab switch made on the phone fires no Target event; the tab whose document is visible is the one in front. */
function findFront(): Promise<void> {
  finding ??= (async () => {
    const session = await liveSession();
    if (!session) return;
    for (const target of session.targets) {
      const visible = await isVisible(session.serial, target.targetId);
      if (visible) return follow(session, target.targetId);
    }
  })().finally(() => (finding = null));
  return finding;
}

async function isVisible(serial: string, targetId: string): Promise<boolean> {
  const sessionId = await attachedSession(serial, targetId);
  if (!sessionId) return false;
  const state = await sendCdp(serial, 'Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, sessionId);
  return state.ok && (state.data.result as { value?: unknown } | undefined)?.value === 'visible';
}

async function trackTargets(event: CdpEvent): Promise<void> {
  const info = (event.params.targetInfo ?? {}) as TargetInfo;
  if (event.method === 'Target.detachedFromTarget') {
    for (const [targetId, attaching] of attachments) {
      if ((await attaching) === event.params.sessionId) attachments.delete(targetId);
    }
    if (event.params.sessionId !== followed?.sessionId) return;
    followed = null;
    streaming = false;
    if (watchers.size) void ensureFollowed();
    return;
  }
  if (event.method === 'Target.targetDestroyed') {
    const targetId = String(event.params.targetId);
    attachments.delete(targetId);
    await updatePhone((held) => ({ ...held, targets: held.targets.filter((target) => target.targetId !== targetId) }));
    if (followed?.targetId === targetId) {
      followed = null;
      streaming = false;
      setTimeout(() => void findFront(), CLOSED_TAB_SETTLE_MS);
    }
    return;
  }
  if ((event.method !== 'Target.targetCreated' && event.method !== 'Target.targetInfoChanged') || !isPageTarget(info)) return;
  const target: PhoneTarget = { targetId: info.targetId, url: info.url ?? '', title: info.title ?? '' };
  await updatePhone((held) =>
    numbered(
      held,
      held.targets.some((each) => each.targetId === target.targetId)
        ? held.targets.map((each) => (each.targetId === target.targetId ? target : each))
        : [...held.targets, target],
    ),
  );
  if (page && followed?.targetId === target.targetId) {
    page = { ...page, url: target.url, title: target.title };
    broadcast({ kind: 'page', ...page });
    await reflect(target.url, target.title);
  }
}

function onEvent(event: CdpEvent): void {
  if (event.method.startsWith('Target.') && !event.sessionId) return void trackTargets(event);
  if (!followed || event.sessionId !== followed.sessionId) return;
  if (event.method === 'Page.screencastFrame') {
    const frame = Number(event.params.sessionId);
    if (!watchers.size) return void call('Page.screencastFrameAck', { sessionId: frame });
    broadcast({ kind: 'frame', data: String(event.params.data), metadata: event.params.metadata as never, frame });
    return;
  }
  if (event.method === 'Page.screencastVisibilityChanged' && event.params.visible === false) return void findFront();
  if (event.method === 'Page.frameNavigated' && !(event.params.frame as { parentId?: string } | undefined)?.parentId) return void publishPage();
  if (event.method === 'Page.navigatedWithinDocument') void publishPage();
}

function queueInput(command: InputCommand): void {
  const last = inputs.at(-1);
  if (last?.op === 'touch' && command.op === 'touch' && last.type === 'touchMove' && command.type === 'touchMove') inputs[inputs.length - 1] = command;
  else if (last?.op === 'wheel' && command.op === 'wheel') {
    inputs[inputs.length - 1] = { ...command, deltaX: last.deltaX + command.deltaX, deltaY: last.deltaY + command.deltaY };
  } else inputs.push(command);
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (let next = inputs.shift(); next; next = inputs.shift()) await dispatchInput(next);
  } finally {
    pumping = false;
  }
}

async function dispatchInput(command: InputCommand): Promise<void> {
  if (command.op === 'touch') {
    const lifted = command.type === 'touchEnd' || command.type === 'touchCancel';
    await call('Input.dispatchTouchEvent', { type: command.type, touchPoints: lifted ? [] : [{ x: command.x, y: command.y }] });
  } else if (command.op === 'wheel') {
    await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: command.x, y: command.y, deltaX: command.deltaX, deltaY: command.deltaY });
  } else if (command.op === 'text') {
    await call('Input.insertText', { text: command.text });
  } else {
    for (const event of keyEvents(command.key)) await call('Input.dispatchKeyEvent', event);
  }
}

/** Chrome on Android can ignore an activation that lands just after a tab opened, so it is asked again until the tab is in front. */
export async function bringToFront(serial: string, targetId: string): Promise<void> {
  for (let attempt = 0; attempt < ACTIVATE_TRIES; attempt++) {
    await sendCdp(serial, 'Target.activateTarget', { targetId });
    await new Promise((resolve) => setTimeout(resolve, ACTIVATE_SETTLE_MS));
    if (await isVisible(serial, targetId)) return;
  }
}

async function goInHistory(step: -1 | 1): Promise<void> {
  const history = await call('Page.getNavigationHistory');
  if (!history?.ok) return;
  const entries = (history.data.entries as { id: number }[] | undefined) ?? [];
  const entry = entries[Number(history.data.currentIndex) + step];
  if (entry) await call('Page.navigateToHistoryEntry', { entryId: entry.id });
}

async function handle(port: Port, command: MirrorCommand): Promise<void> {
  switch (command.op) {
    case 'watch':
      watchers.add(port);
      if (!followed) return ensureFollowed();
      if (!streaming) return startStream();
      if (page) port.postMessage({ kind: 'page', ...page });
      return;
    case 'unwatch':
      watchers.delete(port);
      if (!watchers.size) await stopStream();
      return;
    case 'restart':
      await stopStream();
      if (watchers.size) await startStream();
      return;
    case 'ack':
      await call('Page.screencastFrameAck', { sessionId: command.frame });
      return;
    case 'touch':
    case 'wheel':
    case 'text':
    case 'key':
      return queueInput(command);
    case 'go': {
      const refused = await refusalFor(command.url);
      if (refused) return tellError(refused.ok ? '' : refused.error.message);
      const navigated = await call('Page.navigate', { url: command.url });
      if (navigated && !navigated.ok) tellError(navigated.error.message);
      return;
    }
    case 'back':
      return goInHistory(-1);
    case 'forward':
      return goInHistory(1);
    case 'reload':
      await call('Page.reload');
      return;
    case 'switchTab': {
      const session = await liveSession();
      if (!session) return;
      await bringToFront(session.serial, command.targetId);
      return follow(session, command.targetId);
    }
    case 'newTab': {
      const session = await liveSession();
      if (!session) return;
      const created = await sendCdp(session.serial, 'Target.createTarget', { url: 'about:blank' });
      if (!created.ok) return tellError(created.error.message);
      return follow(session, String(created.data.targetId));
    }
    case 'closeTab': {
      const session = await liveSession();
      if (session) await sendCdp(session.serial, 'Target.closeTarget', { targetId: command.targetId });
      return;
    }
  }
}

function forget(): void {
  followed = null;
  streaming = false;
  page = null;
  inputs.length = 0;
  attachments.clear();
}

export function servePhoneMirror(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PHONE_PORT) return;
    ports.add(port);
    if (page) port.postMessage({ kind: 'page', ...page });
    port.onMessage.addListener((message) => void handle(port, message as MirrorCommand));
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      if (watchers.delete(port) && !watchers.size) void stopStream();
    });
  });
  onCdpEvent(onEvent);
  onPhoneClosed(forget);
  onDaemonClosed(forget);
  onPhoneReset(forget);
}
