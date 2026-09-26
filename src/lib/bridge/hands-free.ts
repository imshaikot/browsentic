import { browser, type Browser } from 'wxt/browser';
import { MAX_STORED_FILE_BYTES } from '@/lib/files/report';
import { replyOf } from '@/lib/handsfree/caption';
import {
  DICTATION_CHANNEL,
  HANDS_FREE_CHANNEL,
  isDictationReport,
  isOrbRequest,
  type DictationCommand,
  type DictationPhase,
  type DictationReport,
  type OrbApproval,
  type OrbCommand,
  type OrbLink,
  type OrbPosition,
  type OrbRequest,
  type OrbView,
} from '@/lib/handsfree/events';
import { pickFocusIn } from './aeye';
import { putBytes } from './file-store';
import { openMicPermissionPage } from './mic-permission';
import { HANDS_FREE_KEY, endHandsFree, readHandsFree, writeHandsFree, type HandsFreeState } from './panel-view';
import { onPanelPresence, onTurnSettled, runCommand } from './run-port';
import { openSidePanel } from './side-panel';
import { TAB_SESSIONS_KEY, readTabSessions, type PendingApproval, type TabAnchor, type TabSession } from './tab-sessions';
import { THEME_KEY, readTheme, type ThemeId } from './theme';
import { SPEECH_SERVICE_KEY, handsFreeSupported, noteSpeechService } from './speech-support';
import { showToast } from './toast';
import type { DaemonState } from './socket';

export const ORB_POSITION_KEY = 'browsentic/orbPosition';
export const PUSH_TO_TALK_KEY = 'browsentic/pushToTalk';
const DICTATION_KEY = 'browsentic/dictation';
const DAEMON_KEY = 'browsentic/daemon';
const DICTATION_PAGE = 'dictation.html';
const HOLD_DICTATION_PAGE = `${DICTATION_PAGE}?hold`;
const NOTIFICATION_PREFIX = 'browsentic-approval:';
const MAX_DETAIL_CHARS = 180;
const MAX_CODE_CHARS = 4_000;

/** What every tab was last told. A cache: a revived worker starts it empty and repaints. */
const sent = new Map<number, string>();
const orbTabs = new Set<number>();
const announced = new Set<string>();
let showing: boolean | null = null;
let listeningTab: number | null = null;
let panelOpen = false;
let serviceAnswered = false;

let inFlight: Promise<void> | null = null;
let restated = false;

export function syncHandsFree(): Promise<void> {
  if (inFlight) {
    restated = true;
    return inFlight;
  }
  inFlight = (async () => {
    do {
      restated = false;
      await paint().catch((error) => console.warn('[browsentic] hands-free paint failed:', error));
    } while (restated);
    inFlight = null;
  })();
  return inFlight;
}

export interface OrbWorld {
  theme: ThemeId;
  position: OrbPosition | null;
  link: OrbLink;
  state: HandsFreeState;
  phase: DictationPhase | null;
  pushToTalk: boolean;
  listeningTab: number | null;
}

export function describeOrb(world: OrbWorld, tabId: number, session: TabSession | null): OrbView {
  const pending = session?.pendingApproval;
  return {
    theme: world.theme,
    since: world.state.since,
    position: world.position,
    link: world.link,
    run: pending ? 'approval' : session?.runId ? 'working' : 'idle',
    voice: world.state.muted ? 'muted' : tabId === world.listeningTab ? (world.phase ?? 'starting') : 'paused',
    pushToTalk: world.pushToTalk,
    ...(pending && { approval: approvalOf(pending) }),
  };
}

export function approvalOf(pending: PendingApproval): OrbApproval {
  const base = { toolId: pending.toolId, action: pending.action.replace(/^page\./, ''), site: pending.site };
  const input = pending.input as Record<string, unknown> | null;
  if (typeof input?.code === 'string' && input.code) {
    return {
      ...base,
      purpose: typeof input.purpose === 'string' ? input.purpose : undefined,
      code: input.code.slice(0, MAX_CODE_CHARS),
    };
  }
  return { ...base, detail: flatten(pending.input) };
}

function flatten(input: unknown): string | undefined {
  if (input == null) return undefined;
  const text =
    typeof input === 'object'
      ? Object.entries(input as Record<string, unknown>)
          .filter(([, value]) => value !== undefined && value !== '')
          .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
          .join(' · ')
      : String(input);
  if (!text) return undefined;
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…` : text;
}

const linkOf = (daemon: DaemonState | null): OrbLink =>
  !daemon?.paired ? 'off' : daemon.connected ? 'live' : 'pending';

const sessionOn = (sessions: Record<string, TabSession>, tabId: number): TabSession | null =>
  Object.values(sessions).find((session) => session.tabIds.includes(tabId)) ?? null;

/**
 * The microphone listens for exactly one tab: the one in front of a focused window, while
 * its conversation is free to take an instruction and no side panel is open to listen
 * instead. Every other tab's orb is painted as paused.
 */
async function paint(): Promise<void> {
  const state = await readHandsFree();
  if (!state) {
    await clearOrbs();
    return;
  }
  /* The panel never offers hands-free where speech cannot work; this catches the rest — a flag
     left from before the service was found missing, or written by anything but the panel. */
  if (!(await handsFreeSupported())) {
    await endHandsFree();
    return;
  }
  showing = true;

  const [daemon, sessions, theme, position, phase, pushToTalk, front, tabs] = await Promise.all([
    readDaemon(),
    readTabSessions(),
    readTheme(),
    readPosition(),
    readPhase(),
    readPushToTalk(),
    frontTab(),
    browser.tabs.query({}),
  ]);
  const link = linkOf(daemon);
  const frontId = front?.id ?? null;
  const frontSession = frontId == null ? null : sessionOn(sessions, frontId);
  const target =
    !state.muted && link === 'live' && !panelOpen && !frontSession?.runId && !frontSession?.pendingApproval
      ? frontId
      : null;

  const world: OrbWorld = { theme, position, link, state, phase, pushToTalk, listeningTab: target };
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null || tab.discarded) return;
      const view = describeOrb(world, tab.id, sessionOn(sessions, tab.id));
      const painted = JSON.stringify(view);
      if (sent.get(tab.id) === painted) return;
      sent.set(tab.id, painted);
      if (await post(tab.id, { channel: HANDS_FREE_CHANNEL, op: 'show', view })) orbTabs.add(tab.id);
      else orbTabs.delete(tab.id);
    }),
  );

  await aimMic(target != null && orbTabs.has(target) ? target : null, pushToTalk);
  for (const session of Object.values(sessions)) {
    const pending = session.pendingApproval;
    if (!pending || announced.has(pending.toolId)) continue;
    announced.add(pending.toolId);
    if (session.currentTabId !== frontId) void askElsewhere(session, pending, frontId != null);
  }
}

async function clearOrbs(): Promise<void> {
  await aimMic(null, false);
  announced.clear();
  if (showing === false) return;
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((tab) => tab.id != null && !tab.discarded && post(tab.id, { channel: HANDS_FREE_CHANNEL, op: 'hide' })));
  sent.clear();
  orbTabs.clear();
  showing = false;
}

async function aimMic(tabId: number | null, hold: boolean): Promise<void> {
  listeningTab = tabId;
  if (tabId == null) await closeDictation();
  else await openDictation(hold);
}

async function dictationUrl(): Promise<URL | null> {
  if (import.meta.env.FIREFOX) return null;
  const [open] = await browser.runtime
    .getContexts({ contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT] })
    .catch(() => []);
  return open?.documentUrl ? new URL(open.documentUrl) : null;
}

async function hasDictation(): Promise<boolean> {
  return (await dictationUrl()) !== null;
}

/** One page, in the mode asked for: a page left in the other mode is closed and opened afresh. */
async function openDictation(hold: boolean): Promise<void> {
  if (import.meta.env.FIREFOX) return;
  const open = await dictationUrl();
  if (open && open.searchParams.has('hold') === hold) return;
  if (open) await closeDictation();
  await browser.storage.session.set({ [DICTATION_KEY]: (hold ? 'held' : 'starting') satisfies DictationPhase });
  await browser.offscreen
    .createDocument({
      url: hold ? HOLD_DICTATION_PAGE : DICTATION_PAGE,
      reasons: [browser.offscreen.Reason.USER_MEDIA],
      justification: 'Hands-free mode listens for spoken instructions while the side panel is closed.',
    })
    .catch((error) => console.warn('[browsentic] could not start dictation:', error));
}

async function closeDictation(): Promise<void> {
  if (!(await hasDictation())) return;
  await browser.offscreen.closeDocument().catch(() => undefined);
  await browser.storage.session.remove(DICTATION_KEY);
}

async function hear(report: DictationReport): Promise<void> {
  if (report.op === 'phase') {
    if (report.phase === 'no-service' && (await noteSpeechService('missing')) === 'missing') {
      await sayNoService();
      return;
    }
    if (await hasDictation()) await browser.storage.session.set({ [DICTATION_KEY]: report.phase });
    return;
  }
  if (!serviceAnswered) {
    serviceAnswered = true;
    void noteSpeechService('works');
  }
  if (listeningTab == null) await syncHandsFree();
  if (listeningTab == null) return;
  void post(listeningTab, { channel: HANDS_FREE_CHANNEL, op: 'heard', text: report.text, final: report.final });
}

/**
 * The service failed before it ever transcribed a word here, so this browser has none, and the
 * mic goes with the storage change. The toast says why, since the panel it came from is closed.
 */
async function sayNoService(): Promise<void> {
  await showToast({
    toastId: 'hands-free-no-speech',
    tone: 'warn',
    title: 'Hands-free is not available here',
    body: 'This browser has no speech service to transcribe with. Open Browsentic from the toolbar to keep going by typing.',
  });
}

/** An approval raised in a tab nobody is looking at: a card on the page they are on, or the OS when the browser is behind. */
async function askElsewhere(session: TabSession, pending: PendingApproval, browserInFront: boolean): Promise<void> {
  const title = 'Browsentic needs your OK';
  const body = `${spoken(pending.action)}${pending.site ? ` on ${pending.site}` : ''} — open the tab and tap the mic.`;
  const shown =
    browserInFront &&
    (await showToast({ toastId: `approval-${pending.toolId}`, tone: 'warn', title, body, tabId: session.currentTabId }));
  if (shown) return;
  await browser.notifications
    ?.create(`${NOTIFICATION_PREFIX}${session.currentTabId}:${pending.toolId}`, {
      type: 'basic',
      iconUrl: largestIcon(),
      title,
      message: body,
    })
    .catch(() => undefined);
}

/** `page.clickElement` as a person would say it: “Click element”. */
export const spoken = (action: string): string =>
  action
    .replace(/^page\./, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());

function largestIcon(): string {
  const icons = browser.runtime.getManifest().icons ?? {};
  const [largest] = Object.keys(icons)
    .map(Number)
    .sort((a, b) => b - a);
  return icons[largest] ?? '';
}

async function frontTab(): Promise<Browser.tabs.Tab | null> {
  const window = await browser.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (!window?.focused || window.id == null) return null;
  const [tab] = await browser.tabs.query({ active: true, windowId: window.id }).catch(() => []);
  return tab ?? null;
}

async function readDaemon(): Promise<DaemonState | null> {
  const stored = await browser.storage.session.get(DAEMON_KEY);
  return (stored[DAEMON_KEY] as DaemonState | undefined) ?? null;
}

async function readPhase(): Promise<DictationPhase | null> {
  const stored = await browser.storage.session.get(DICTATION_KEY);
  return (stored[DICTATION_KEY] as DictationPhase | undefined) ?? null;
}

async function readPushToTalk(): Promise<boolean> {
  return (await browser.storage.local.get(PUSH_TO_TALK_KEY))[PUSH_TO_TALK_KEY] === true;
}

async function readPosition(): Promise<OrbPosition | null> {
  const stored = await browser.storage.local.get(ORB_POSITION_KEY);
  return asPosition(stored[ORB_POSITION_KEY]);
}

function asPosition(value: unknown): OrbPosition | null {
  const point = value as Partial<OrbPosition> | null;
  const within = (n: unknown): n is number => typeof n === 'number' && n >= 0 && n <= 1;
  return point && within(point.x) && within(point.y) ? { x: point.x, y: point.y } : null;
}

/* Answered through sendResponse by the orb, for the reason the toast gives: on Chrome a
   returned promise is dropped, and the verdict is what says whether a tab has an orb. */
async function post(tabId: number, command: OrbCommand): Promise<boolean> {
  try {
    return ((await browser.tabs.sendMessage(tabId, command)) as { ok?: boolean } | undefined)?.ok === true;
  } catch {
    return false;
  }
}

const anchorOf = (tab: Browser.tabs.Tab & { id: number }): TabAnchor => ({
  tabId: tab.id,
  url: tab.url,
  windowId: tab.windowId,
  title: tab.title,
});

async function sessionIdFor(tabId: number): Promise<string | null> {
  return sessionOn(await readTabSessions(), tabId)?.sessionId ?? null;
}

async function listen(on: boolean): Promise<void> {
  const state = await readHandsFree();
  if (!state) return;
  if (!on) return writeHandsFree({ ...state, muted: true });
  if (state.muted) return writeHandsFree({ ...state, muted: false });
  await closeDictation();
  await syncHandsFree();
}

async function attach(request: Extract<OrbRequest, { op: 'attach' }>, tab: TabAnchor): Promise<{ ok: boolean; fileId?: string; error?: string }> {
  const { name, mime, size, content } = request.file;
  const id = crypto.randomUUID();
  try {
    if (content && size <= MAX_STORED_FILE_BYTES) await putBytes({ id, name, mime, content });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  runCommand({ op: 'attach', file: { id, name, mime, size }, tab });
  return { ok: true, fileId: id };
}

function answer(request: OrbRequest, tab: Browser.tabs.Tab & { id: number }, respond: (reply: unknown) => void): boolean {
  switch (request.op) {
    case 'sync':
      sent.delete(tab.id);
      void syncHandsFree();
      respond({ ok: true });
      return false;
    case 'submit':
      if (request.text.trim()) {
        runCommand({ op: 'instruct', text: request.text.trim(), tab: anchorOf(tab), focus: request.focus, liveTools: request.liveTools });
      }
      respond({ ok: true });
      return false;
    case 'cancel':
      void sessionIdFor(tab.id).then((sessionId) => sessionId && runCommand({ op: 'cancel', sessionId }));
      respond({ ok: true });
      return false;
    case 'decide':
      void sessionIdFor(tab.id).then(
        (sessionId) =>
          sessionId &&
          runCommand({ op: 'decision', sessionId, toolId: request.toolId, allow: request.allow, remember: request.remember }),
      );
      respond({ ok: true });
      return false;
    case 'listen':
      void listen(request.on);
      respond({ ok: true });
      return false;
    case 'grantMic':
      void openMicPermissionPage();
      respond({ ok: true });
      return false;
    case 'move': {
      const position = asPosition(request.position);
      if (position) void browser.storage.local.set({ [ORB_POSITION_KEY]: position });
      respond({ ok: true });
      return false;
    }
    case 'detach':
      runCommand({ op: 'detach', fileId: request.fileId });
      respond({ ok: true });
      return false;
    case 'pushToTalk':
      void browser.storage.local.set({ [PUSH_TO_TALK_KEY]: request.on === true });
      respond({ ok: true });
      return false;
    case 'talk':
      if (tab.id === listeningTab) {
        const command: DictationCommand = { channel: DICTATION_CHANNEL, op: 'talk', on: request.on === true };
        void browser.runtime.sendMessage(command).catch(() => undefined);
      }
      respond({ ok: true });
      return false;
    case 'pick':
      pickFocusIn({ id: tab.id, windowId: tab.windowId })
        .then(respond)
        .catch((error) => respond({ error: String(error) }));
      return true;
    case 'attach':
      attach(request, anchorOf(tab))
        .then(respond)
        .catch((error) => respond({ ok: false, error: String(error) }));
      return true;
    case 'openPanel':
      respond({ ok: true });
      return false;
  }
}

export function serveHandsFree(): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isDictationReport(message)) {
      if (sender.url && new URL(sender.url).pathname === `/${DICTATION_PAGE}`) void hear(message);
      return;
    }
    if (!isOrbRequest(message)) return;
    const tab = sender.tab;
    if (tab?.id == null) return;
    /* The click that reached us is the only gesture the panel will get — spent before any
       await, exactly as the rail does. Hands-free ends when the panel reports itself open. */
    if (message.op === 'openPanel' && tab.windowId != null) void openSidePanel(tab.windowId).catch(() => undefined);
    return answer(message, tab as Browser.tabs.Tab & { id: number }, sendResponse) || undefined;
  });

  onPanelPresence((open) => {
    panelOpen = open;
    void syncHandsFree();
  });

  onTurnSettled((sessionId, items) => {
    const reply = replyOf(items);
    if (!reply) return;
    void (async () => {
      if (!(await readHandsFree())) return;
      const session = (await readTabSessions())[sessionId];
      if (session) await post(session.currentTabId, { channel: HANDS_FREE_CHANNEL, op: 'say', ...reply });
    })();
  });

  browser.notifications?.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    const tabId = Number(notificationId.slice(NOTIFICATION_PREFIX.length).split(':')[0]);
    void browser.notifications.clear(notificationId);
    void browser.tabs.update(tabId, { active: true }).then((tab) => {
      if (tab?.windowId != null) void browser.windows.update(tab.windowId, { focused: true });
    }).catch(() => undefined);
  });

  browser.tabs.onActivated.addListener(() => void syncHandsFree());
  browser.windows?.onFocusChanged.addListener(() => void syncHandsFree());
  browser.tabs.onRemoved.addListener((tabId) => {
    sent.delete(tabId);
    orbTabs.delete(tabId);
  });
  browser.tabs.onUpdated.addListener((tabId, changed) => {
    if (changed.status !== 'loading') return;
    sent.delete(tabId);
    orbTabs.delete(tabId);
  });
  browser.storage.session.onChanged.addListener((changes) => {
    if (HANDS_FREE_KEY in changes || DICTATION_KEY in changes || TAB_SESSIONS_KEY in changes || DAEMON_KEY in changes) {
      void syncHandsFree();
    }
  });
  browser.storage.local.onChanged.addListener((changes) => {
    if (THEME_KEY in changes || ORB_POSITION_KEY in changes || SPEECH_SERVICE_KEY in changes || PUSH_TO_TALK_KEY in changes) {
      void syncHandsFree();
    }
  });

  void syncHandsFree();
}
