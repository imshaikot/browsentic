import { useSyncExternalStore } from 'react';

import { AGENT_LIST, type AgentDescriptor, type AgentKind } from '@/lib/agents/catalog';
import type { GuardrailValue } from '@/lib/settings/guardrails';
import type { PreferenceChange } from '@/lib/settings/preferences';
import type { ThemeId } from '@/lib/settings/theme';
import type { BrowserRow } from '@/daemon/browsers';
import type { AndroidJson } from '@/daemon/android/report';
import type {
  AgentListing,
  AppInfo,
  Backend,
  Browser,
  BridgeStatus,
  CliOutput,
  CommandLink,
  DownloadListing,
  Grant,
  InstallStamp,
  Lockfile,
  NodeInstall,
  PairingCode,
  Preferences,
  Release,
  SessionSummary,
  SkillListing,
} from './backend';

export type Phase = 'preflight' | 'main';
export type DaemonPhase = 'off' | 'starting' | 'on' | 'stopping';
export type Tab = 'overview' | 'browsers' | 'android' | 'agents' | 'skills' | 'activity' | 'logs' | 'settings' | 'about';
export const TABS: Tab[] = ['overview', 'browsers', 'android', 'agents', 'skills', 'activity', 'logs', 'settings', 'about'];

export type CheckId = 'system' | 'node' | 'command' | 'browser' | 'agent';
export const CHECKS: CheckId[] = ['system', 'node', 'command', 'browser', 'agent'];
/** What "Set up everything" installs on its own. A browser, the extension and an agent are the user's pick. */
export const INSTALLS_AUTOMATICALLY: CheckId[] = ['node', 'command'];

/** Asked of the command whenever it has to run setup with nobody to answer it. */
const QUIET_SETUP = ['setup', '--no-pair', '--no-open', '--no-wait', '--no-self-update', '--json'];

export type CheckState =
  | { kind: 'waiting' }
  | { kind: 'checking' }
  | { kind: 'passed' | 'missing' | 'advisory' | 'failed'; text: string }
  | { kind: 'working'; fraction?: number; text: string };

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'downloading'; fraction: number }
  | { kind: 'relaunching' }
  | { kind: 'failed'; reason: string };

export type Appearance = 'system' | 'light' | 'dark';

export interface Notice {
  id: number;
  text: string;
  isError: boolean;
}

export interface State {
  phase: Phase;
  tab: Tab;
  checks: Record<CheckId, CheckState>;
  preflightBusy: boolean;
  fixing: boolean;
  info?: AppInfo;
  node?: NodeInstall | null;
  daemon: DaemonPhase;
  lock?: Lockfile;
  status?: BridgeStatus;
  sessions: SessionSummary[];
  pairing?: PairingCode;
  agents?: AgentListing;
  /** `browsentic android --json` while the Android tab is open; the Bridge looks for phones only then. */
  android?: AndroidJson;
  /** A phone has been ready on this computer before, so the setup steps start folded. */
  androidReadyOnce: boolean;
  preferences?: Preferences;
  /** The running daemon never answered for its settings: it predates this app and needs a restart. */
  preferencesUnsupported: boolean;
  skills?: SkillListing;
  grants: Grant[];
  downloads?: DownloadListing;
  stamp?: InstallStamp | null;
  browsers: Browser[];
  /** Every browser `browsentic browsers` knows, where it gets the extension, and the copies it runs. */
  browserRows: BrowserRow[];
  logText: string;
  commandLink?: CommandLink;
  update?: Release;
  updatePhase: UpdatePhase;
  lastUpdateCheck?: number;
  busy: string[];
  notice?: Notice;
  appearance: Appearance;
  startDaemonOnLaunch: boolean;
}

const MINIMUM_NODE = 20;
const FINISH_UPDATE = 'browsentic/finishUpdateOnLaunch';
const APPEARANCE = 'browsentic/appearance';
const START_ON_LAUNCH = 'browsentic/startDaemonOnLaunch';
const ANDROID_READY_ONCE = 'browsentic/androidReadyOnce';
const CLAUDE_CODE = '@anthropic-ai/claude-code';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const store = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* A window with no storage keeps its choices for this session only. */
  }
};

export const isPassed = (state: CheckState | undefined) => state?.kind === 'passed';
export const needsAttention = (state: CheckState | undefined) => state?.kind === 'missing' || state?.kind === 'failed';
export const isInstalling = (phase: UpdatePhase) => phase.kind === 'downloading' || phase.kind === 'relaunching';

export function failureOf(output: CliOutput): string {
  const text = (output.stderr.trim() || output.stdout.trim()).slice(-400);
  return text || 'The browsentic command exited with an error. See the Logs tab.';
}

/** The CLI's --json output, from its first bracket: a warning printed before it is not part of it. */
export function parseJson<T>(output: CliOutput, command: string): T {
  if (!output.ok) throw new Error(failureOf(output));
  const start = output.stdout.search(/[[{]/);
  try {
    return JSON.parse(output.stdout.slice(start)) as T;
  } catch {
    throw new Error(`“browsentic ${command}” printed something this app cannot read. Update the app.`);
  }
}

/** A path as a Windows user reads one in prose: under %USERPROFILE%, never with a tilde. */
export function short(path: string, info: AppInfo | undefined): string {
  if (!info || !path.toLowerCase().startsWith(info.paths.home.toLowerCase())) return path;
  const rest = path.slice(info.paths.home.length);
  return info.paths.separator === '\\' ? `%USERPROFILE%${rest}` : `~${rest}`;
}

export const initialState = (): State => ({
  phase: 'preflight',
  tab: 'overview',
  checks: Object.fromEntries(CHECKS.map((id) => [id, { kind: 'waiting' }])) as Record<CheckId, CheckState>,
  preflightBusy: true,
  fixing: false,
  daemon: 'off',
  sessions: [],
  preferencesUnsupported: false,
  grants: [],
  browsers: [],
  browserRows: [],
  logText: '',
  updatePhase: { kind: 'idle' },
  busy: [],
  appearance: (stored(APPEARANCE) as Appearance | null) ?? 'system',
  startDaemonOnLaunch: stored(START_ON_LAUNCH) !== 'false',
  androidReadyOnce: stored(ANDROID_READY_ONCE) === '1',
});

export class Model {
  private state: State = initialState();
  private listeners = new Set<() => void>();
  private poller?: ReturnType<typeof setInterval>;
  private updateWatcher?: ReturnType<typeof setInterval>;
  private stopEvents?: () => void;
  private watchingAndroid = false;
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private noticeCount = 0;
  private started = false;

  constructor(
    private readonly backend: Backend,
    private readonly pace: (ms: number) => Promise<unknown> = pause,
  ) {
    backend.onTray((action) => {
      if (action === 'toggle') void this.setDaemon(this.state.daemon === 'off');
      if (action === 'restart') void this.restartDaemon();
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.state;

  private set(patch: Partial<State> | ((state: State) => Partial<State>)) {
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    const before = this.state;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
    if (before.daemon !== this.state.daemon || before.status !== this.state.status || before.phase !== this.state.phase) {
      void this.syncTray();
    }
  }

  private check(id: CheckId, state: CheckState) {
    this.set((current) => ({ checks: { ...current.checks, [id]: state } }));
  }

  get canEnter() {
    return INSTALLS_AUTOMATICALLY.every((id) => isPassed(this.state.checks[id]));
  }

  get needsSetup() {
    return INSTALLS_AUTOMATICALLY.some((id) => !isPassed(this.state.checks[id]));
  }

  /** Only an unpacked copy waits for ↻: a store copy updates when its browser says. */
  get extensionNeedsReload() {
    const { stamp, sessions } = this.state;
    return !!stamp && sessions.some((session) => session.connected && session.source === 'unpacked' && session.extensionVersion !== stamp.version);
  }

  /** The browsers worth a row: found on this computer or already paired, else the usual few to try. */
  get offeredBrowsers() {
    const rows = this.state.browserRows;
    const found = rows.filter((row) => row.installed || row.sessions.length > 0);
    return found.length ? found : rows.filter((row) => ['chrome', 'edge', 'brave', 'firefox'].includes(row.id));
  }

  // Preflight

  start() {
    if (this.started) return;
    this.started = true;
    void this.runPreflight();
  }

  async runPreflight() {
    this.set({ preflightBusy: true, checks: initialState().checks });
    for (const id of CHECKS) {
      this.check(id, { kind: 'checking' });
      const [state] = await Promise.all([this.evaluate(id), this.pace(420)]);
      this.check(id, state);
    }
    this.set({ preflightBusy: false });
    if (this.finishingUpdate()) {
      await this.setUpEverything();
      if (this.state.phase === 'main') this.say(`Browsentic ${this.state.info?.version} is installed.`);
      return;
    }
    if (this.canEnter && !CHECKS.some((id) => needsAttention(this.state.checks[id]))) {
      await this.pace(900);
      this.enter();
    }
  }

  private async evaluate(id: CheckId): Promise<CheckState> {
    try {
      switch (id) {
        case 'system': {
          const info = await this.backend.appInfo();
          this.set({ info });
          return { kind: 'passed', text: `${info.system.name} · ${info.system.architecture}` };
        }
        case 'node': {
          const node = await this.backend.locateNode();
          this.set({ node });
          if (!node) {
            return { kind: 'missing', text: `Version ${MINIMUM_NODE} or newer runs Browsentic Bridge. A private copy goes in ${this.short(`${this.state.info?.paths.state}${this.sep}runtime`)}.` };
          }
          return { kind: 'passed', text: `${node.version} · ${node.isPrivate ? 'private copy' : this.short(node.path)}` };
        }
        case 'command': {
          const info = await this.backend.appInfo();
          this.set({ info });
          const { bundled, installed, current } = info.payload;
          const cli = this.short(`${info.paths.state}${this.sep}cli`);
          if (!bundled) return { kind: 'failed', text: 'This copy of Browsentic carries no CLI payload. Download a fresh one from browsentic.com.' };
          if (current) return { kind: 'passed', text: `v${bundled} in ${cli}` };
          if (installed && installed !== bundled) return { kind: 'missing', text: `v${installed} is installed; this app carries v${bundled}.` };
          return { kind: 'missing', text: `Installs the command and what runs in the background into ${cli}.` };
        }
        case 'browser': {
          const browsers = await this.backend.browsers();
          this.set({ browsers });
          return browsers.length
            ? { kind: 'passed', text: browsers.map((browser) => browser.name).join(', ') }
            : { kind: 'advisory', text: 'None found. Chrome, Edge, Brave, Vivaldi, Opera or Firefox all work.' };
        }
        case 'agent': {
          const found = await this.backend.agentsOnPath(AGENT_LIST.map((agent) => agent.bin));
          const labels = AGENT_LIST.filter((agent) => found.includes(agent.bin)).map((agent) => agent.label);
          return labels.length
            ? { kind: 'passed', text: labels.join(', ') }
            : { kind: 'advisory', text: 'None on your PATH. The side panel needs one, such as Claude Code or Codex.' };
        }
      }
    } catch (error) {
      return { kind: 'failed', text: messageOf(error) };
    }
  }

  /** After an update the new app carries a newer command and extension, and the person already asked for them. */
  private finishingUpdate() {
    const asked = stored(FINISH_UPDATE) === 'true';
    store(FINISH_UPDATE, null);
    return asked && !isPassed(this.state.checks.command) && isPassed(this.state.checks.node);
  }

  async setUpEverything() {
    this.set({ fixing: true });
    try {
      for (const id of INSTALLS_AUTOMATICALLY) {
        if (!isPassed(this.state.checks[id]) && !(await this.fix(id))) return;
      }
      if (this.canEnter) {
        await this.pace(700);
        this.enter();
      }
    } finally {
      this.set({ fixing: false });
    }
  }

  async fix(id: CheckId): Promise<boolean> {
    try {
      switch (id) {
        case 'node': {
          this.check(id, { kind: 'working', fraction: 0, text: 'Starting' });
          const node = await this.backend.installNode(({ fraction, label }) => this.check('node', { kind: 'working', fraction, text: label }));
          this.set({ node });
          break;
        }
        case 'command': {
          this.requireNode();
          this.check(id, { kind: 'working', text: `Copying Browsentic Bridge into ${this.short(`${this.state.info?.paths.state}${this.sep}cli`)}` });
          const wasRunning = !!(await this.backend.readLock()) && !!this.state.info?.payload.installed;
          if (wasRunning) await this.backend.cli(['stop']);
          await this.backend.installPayload();
          if (wasRunning) {
            this.check(id, { kind: 'working', text: 'Restarting Browsentic Bridge on the new build' });
            await this.run(['start']);
          }
          // Registers it with every browser, store copies included, so a browser can start it.
          this.check(id, { kind: 'working', text: 'Letting your browsers start it' });
          parseJson(await this.backend.cli(QUIET_SETUP, 120), 'setup');
          break;
        }
        case 'agent': {
          this.requireNode();
          this.check(id, { kind: 'working', text: `npm install --global ${CLAUDE_CODE}` });
          const output = await this.backend.npmInstall(CLAUDE_CODE);
          if (!output.ok) throw new Error(failureOf(output));
          break;
        }
        case 'browser':
          await this.backend.openUrl('https://www.google.com/chrome/');
          return true;
        case 'system':
          return true;
      }
      const state = await this.evaluate(id);
      this.check(id, state);
      return state.kind === 'passed';
    } catch (error) {
      this.check(id, { kind: 'failed', text: messageOf(error) });
      return false;
    }
  }

  enter() {
    this.set({ phase: 'main' });
    this.startPolling();
    void this.refreshCommandLink();
    void this.loadBrowsers();
    if (this.state.startDaemonOnLaunch && this.state.daemon === 'off') void this.setDaemon(true);
    this.watchForUpdates();
  }

  showPreflight() {
    this.set({ phase: 'preflight' });
    void this.runPreflight();
  }

  setTab(tab: Tab) {
    if (this.state.phase === 'main') this.set({ tab });
  }

  // Daemon

  private startPolling() {
    this.stopEvents?.();
    this.stopEvents = this.backend.onControlEvent((event) => {
      if (event === 'android-changed') return void this.loadAndroid();
      if (event !== 'settings-changed') return;
      void this.loadPreferences();
      void this.loadAgents();
    });
    clearInterval(this.poller);
    void this.refresh();
    this.poller = setInterval(() => void this.refresh(), 2000);
  }

  dispose() {
    this.stopPolling();
    clearTimeout(this.noticeTimer);
  }

  private stopPolling() {
    clearInterval(this.poller);
    clearInterval(this.updateWatcher);
    this.stopEvents?.();
  }

  async refresh() {
    const lock = await this.backend.readLock().catch(() => null);
    if (!lock) return this.markOff();
    try {
      if (await this.backend.controlConnect()) {
        void this.loadPreferences(true);
        if (this.watchingAndroid) void this.watchAndroid(true);
      }
      const status = (await this.control({ op: 'status' })).status as BridgeStatus;
      const sessions = (await this.control({ op: 'sessions' })).sessions as SessionSummary[];
      const stamp = await this.backend.extensionStamp();
      const changed = linkOf(sessions) !== linkOf(this.state.sessions);
      this.set((state) => ({
        lock,
        status,
        sessions,
        stamp,
        daemon: state.daemon === 'stopping' ? 'stopping' : 'on',
        pairing: state.pairing && status.pairingPending && state.pairing.expiresAt > Date.now() ? state.pairing : undefined,
      }));
      if (!this.state.agents) await this.loadAgents();
      if (changed) void this.loadBrowsers();
    } catch {
      await this.backend.controlClose();
      this.markOff();
    }
  }

  private markOff() {
    if (this.state.daemon === 'starting') return;
    this.set({ daemon: 'off', lock: undefined, status: undefined, sessions: [], pairing: undefined, preferences: undefined });
  }

  async setDaemon(on: boolean) {
    if (!this.state.node || this.state.daemon !== (on ? 'off' : 'on')) return;
    this.set({ daemon: on ? 'starting' : 'stopping' });
    try {
      if (on) await this.run(['start']);
      else {
        await this.backend.controlClose();
        await this.run(['stop']);
      }
    } catch (error) {
      this.report(error);
    }
    this.set({ daemon: on ? 'starting' : 'off' });
    if (!on) this.markOff();
    await this.refresh();
    if (on && this.snapshot().daemon === 'starting') this.set({ daemon: 'off' });
  }

  async restartDaemon() {
    await this.perform('restart', async () => {
      this.set({ daemon: 'starting' });
      await this.backend.controlClose();
      await this.run(['restart']);
      this.set({ agents: undefined });
    });
    await this.refresh();
    if (this.snapshot().daemon === 'starting') this.set({ daemon: 'off' });
  }

  // Operations

  newPairingCode() {
    return this.perform('pair', async () => {
      const reply = await this.control({ op: 'pair' });
      this.set({ pairing: { code: String(reply.code), expiresAt: Number(reply.expiresAt) } });
    });
  }

  async revoke(session?: SessionSummary) {
    await this.perform('revoke', async () => {
      const reply = await this.control(session ? { op: 'revoke', origin: session.origin, session: session.id } : { op: 'revoke' });
      const count = Number(reply.revoked);
      this.say(count === 0 ? 'Nothing to unpair.' : `Unpaired ${count} browser${count === 1 ? '' : 's'}.`);
    });
    await this.refresh();
  }

  async loadAgents() {
    if (!this.state.node) return;
    try {
      this.set({ agents: parseJson<AgentListing>(await this.backend.cli(['agent', '--json']), 'agent') });
    } catch {
      /* The Agents tab shows its own offline hint; a failed background read says nothing. */
    }
  }

  /** The tab subscribes while it shows and lets go when it leaves, so phones are looked for only while someone is looking at them. */
  async watchAndroid(on: boolean) {
    this.watchingAndroid = on;
    if (this.state.daemon !== 'on') return;
    await this.control({ op: 'android', watch: on }).catch(() => undefined);
    if (on) await this.loadAndroid();
  }

  loadAndroid() {
    return this.perform('android', async () => this.showAndroid(await this.readAndroid()), true);
  }

  openChrome(serial: string) {
    return this.perform(`android:${serial}`, async () => {
      outcome((await this.control({ op: 'android', launch: serial }, 40_000)).result);
      this.showAndroid(await this.readAndroid());
    });
  }

  private async readAndroid() {
    return parseJson<AndroidJson>(await this.backend.cli(['android', '--json'], 30), 'android');
  }

  private showAndroid(android: AndroidJson) {
    if (android.ready && !this.state.androidReadyOnce) store(ANDROID_READY_ONCE, '1');
    this.set((state) => ({ android, androidReadyOnce: state.androidReadyOnce || android.ready }));
  }

  async loadPreferences(watch = false) {
    try {
      const reply = await this.control({ op: 'preferences', watch });
      this.set({ preferences: outcome<Preferences>(reply.result), preferencesUnsupported: false });
    } catch (error) {
      if (messageOf(error).includes('did not answer in time')) this.set({ preferencesUnsupported: true });
    }
  }

  setBrowserTheme(theme: ThemeId) {
    return this.setPreference('theme', { kind: 'theme', theme });
  }

  setGuardrail(setting: string, value: GuardrailValue) {
    return this.setPreference(`guardrail:${setting}`, { kind: 'guardrail', setting, value });
  }

  private setPreference(key: string, change: PreferenceChange) {
    return this.perform(key, async () => {
      const reply = await this.control({ op: 'setPreference', change });
      this.set({ preferences: outcome<Preferences>(reply.result) });
    });
  }

  selectAgent(kind: AgentKind) {
    return this.agentChange(kind, { op: 'agent', set: kind });
  }

  repairAgent(kind: AgentKind) {
    return this.agentChange(kind, { op: 'agent', grant: kind });
  }

  private agentChange(kind: AgentKind, frame: Record<string, unknown>) {
    return this.perform(`agent:${kind}`, async () => {
      const reply = await this.control(frame, 60_000);
      this.set((state) => ({ agents: { ...(reply.state as AgentListing), catalog: state.agents?.catalog } }));
    });
  }

  setModel(model: string | null, kind: AgentKind) {
    return this.perform(`agent:${kind}`, async () => {
      await this.run(['agent', 'model', kind, ...(model ? [model] : [])]);
      this.set({ agents: parseJson<AgentListing>(await this.backend.cli(['agent', '--json']), 'agent') });
    });
  }

  async installAgent(descriptor: AgentDescriptor) {
    if (!descriptor.install.startsWith('npm ') || !this.state.node) {
      await this.backend.openUrl(descriptor.docs);
      return;
    }
    const pkg = descriptor.install.split(' ').at(-1) ?? '';
    await this.perform(`agent:${descriptor.kind}`, async () => {
      const output = await this.backend.npmInstall(pkg);
      if (!output.ok) throw new Error(failureOf(output));
      this.set({ agents: parseJson<AgentListing>(await this.backend.cli(['agent', '--json']), 'agent') });
      this.say(`${descriptor.label} is installed. Run “${descriptor.bin}” in a terminal once to sign in.`);
    });
  }

  loadSkills() {
    return this.perform('skills', async () => this.set({ skills: parseJson<SkillListing>(await this.backend.cli(['skills', '--json']), 'skills') }), true);
  }

  loadActivity() {
    return this.perform(
      'activity',
      async () => {
        const grants = parseJson<{ grants: Grant[] }>(await this.backend.cli(['approvals', '--json']), 'approvals').grants;
        const downloads = parseJson<DownloadListing>(await this.backend.cli(['downloads', '--json']), 'downloads');
        this.set({ grants, downloads });
      },
      true,
    );
  }

  clearApprovals(host?: string) {
    return this.perform('approvals', async () => {
      await this.run(['approvals', 'clear', ...(host ? [host] : [])]);
      this.set({ grants: parseJson<{ grants: Grant[] }>(await this.backend.cli(['approvals', '--json']), 'approvals').grants });
    });
  }

  clearDownloads() {
    return this.perform('downloads', async () => {
      await this.run(['downloads', 'clear']);
      this.set({ downloads: parseJson<DownloadListing>(await this.backend.cli(['downloads', '--json']), 'downloads') });
    });
  }

  async loadBrowsers() {
    if (!this.state.node) return;
    try {
      this.set({ browserRows: parseJson<{ browsers: BrowserRow[] }>(await this.backend.cli(['browsers', '--json']), 'browsers').browsers });
    } catch {
      /* The card falls back to the usual browsers until the command answers. */
    }
  }

  /**
   * Opens the browser's store page in that browser and hands out the code its popup asks for. The
   * command opens it where it found the browser; anywhere else, the default browser gets the page.
   */
  addExtension(row: BrowserRow) {
    return this.perform(`add:${row.id}`, async () => {
      const result = parseJson<SetupResult>(await this.backend.cli(['setup', '--browser', row.id, '--no-wait', '--no-self-update', '--json'], 120), 'setup');
      if (!result.chosen?.opened) await this.backend.openUrl(row.storeUrl);
      if (result.pairingCode && result.expiresAt) this.set({ pairing: { code: result.pairingCode, expiresAt: result.expiresAt } });
      this.say(`${row.steps[0]} Then click Browsentic in ${row.label}’s toolbar and enter the code below.`);
    });
  }

  reinstallExtension() {
    return this.perform('extension', async () => {
      const result = parseJson<SetupResult>(await this.backend.cli(['setup', '--unpacked', '--no-pair', '--no-open', '--no-wait', '--no-self-update', '--force', '--json'], 120), 'setup');
      this.set({ stamp: await this.backend.extensionStamp() });
      this.say(`Extension v${result.version} written. Press ↻ on its card at chrome://extensions.`);
    });
  }

  async openExtensionsPage(browser: Browser) {
    await copy(this.state.info?.paths.extensionDir ?? '');
    try {
      await this.backend.openExtensionsPage(browser);
      this.say('The extension’s folder is on your clipboard. In the folder picker, paste it into the address bar.');
    } catch (error) {
      this.report(error);
    }
  }

  async loadLog() {
    const logText = await this.backend.logTail().catch(() => '');
    if (logText !== this.state.logText) this.set({ logText });
  }

  async refreshCommandLink() {
    this.set({ commandLink: await this.backend.commandLink().catch(() => undefined) });
  }

  async setCommandLink(on: boolean) {
    try {
      const commandLink = await this.backend.setCommandLink(on);
      this.set({ commandLink });
      if (on) this.say('“browsentic” now runs from any new terminal.');
    } catch (error) {
      this.report(error);
    }
  }

  async uninstall(keepSkills: boolean) {
    await this.perform('uninstall', async () => {
      await this.backend.controlClose();
      await this.backend.setCommandLink(false).catch(() => undefined);
      await this.run(['uninstall', '--yes', ...(keepSkills ? ['--keep-skills'] : [])], 60);
      this.stopPolling();
      this.markOff();
      this.set({ phase: 'preflight' });
    });
    await this.runPreflight();
  }

  setAppearance(appearance: Appearance) {
    store(APPEARANCE, appearance);
    this.set({ appearance });
  }

  setStartDaemonOnLaunch(on: boolean) {
    store(START_ON_LAUNCH, String(on));
    this.set({ startDaemonOnLaunch: on });
  }

  // Updates

  private watchForUpdates() {
    clearInterval(this.updateWatcher);
    void this.checkForUpdate();
    this.updateWatcher = setInterval(() => void this.checkForUpdate(), 6 * 3600 * 1000);
  }

  async checkForUpdate(announce = false) {
    if (this.state.updatePhase.kind !== 'idle') return;
    this.set({ updatePhase: { kind: 'checking' } });
    try {
      const found = await this.backend.checkUpdate();
      if (found && found.version !== this.state.update?.version) {
        this.say(`Browsentic ${found.version} is out. You have ${this.state.info?.version}. Update from the Overview tab.`);
      } else if (announce && !found) {
        this.say(`Browsentic ${this.state.info?.version} is the latest.`);
      }
      this.set({ update: found ?? undefined, lastUpdateCheck: Date.now() });
    } catch (error) {
      if (announce) this.report(error);
    } finally {
      if (this.snapshot().updatePhase.kind === 'checking') this.set({ updatePhase: { kind: 'idle' } });
    }
  }

  async installUpdate() {
    if (!this.state.update || isInstalling(this.state.updatePhase)) return;
    this.set({ updatePhase: { kind: 'downloading', fraction: 0 } });
    store(FINISH_UPDATE, 'true');
    try {
      await this.backend.installUpdate((fraction) => this.set({ updatePhase: { kind: 'downloading', fraction } }));
      this.set({ updatePhase: { kind: 'relaunching' } });
    } catch (error) {
      store(FINISH_UPDATE, null);
      this.set({ updatePhase: { kind: 'failed', reason: messageOf(error) } });
    }
  }

  dismissUpdateFailure() {
    if (this.state.updatePhase.kind === 'failed') this.set({ updatePhase: { kind: 'idle' } });
  }

  // Plumbing

  private get sep() {
    return this.state.info?.paths.separator ?? '\\';
  }

  private short(path: string) {
    return short(path, this.state.info);
  }

  private requireNode() {
    if (!this.state.node) throw new Error('Node.js has to be installed first.');
  }

  private async run(args: string[], timeoutSecs?: number) {
    const output = await this.backend.cli(args, timeoutSecs);
    if (!output.ok) throw new Error(failureOf(output));
    return output;
  }

  private async control(frame: Record<string, unknown>, timeoutMs?: number) {
    const reply = await this.backend.controlRequest(frame, timeoutMs);
    if (typeof reply.error === 'object' && reply.error) throw new Error(String((reply.error as { message?: unknown }).message ?? 'Browsentic Bridge refused that.'));
    return reply;
  }

  private async perform(key: string, work: () => Promise<unknown>, quiet = false) {
    if (!this.state.node || this.state.busy.includes(key)) return;
    this.set((state) => ({ busy: [...state.busy, key] }));
    try {
      await work();
    } catch (error) {
      if (!quiet) this.report(error);
    } finally {
      this.set((state) => ({ busy: state.busy.filter((held) => held !== key) }));
    }
  }

  reveal(path: string) {
    return this.backend.reveal(path).catch((error) => this.report(error));
  }

  openUrl(url: string) {
    return this.backend.openUrl(url).catch((error) => this.report(error));
  }

  isBusy(key: string) {
    return this.state.busy.includes(key);
  }

  say(text: string) {
    this.show(text, false);
  }

  report(error: unknown) {
    this.show(messageOf(error), true);
  }

  private show(text: string, isError: boolean) {
    const notice = { id: ++this.noticeCount, text, isError };
    this.set({ notice });
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      if (this.state.notice?.id === notice.id) this.set({ notice: undefined });
    }, isError ? 7000 : 4500);
  }

  private async syncTray() {
    const { daemon, status, phase } = this.state;
    const label = { off: 'Off', starting: 'Starting', on: 'Running', stopping: 'Stopping' }[daemon];
    const link = status ? ` · extension ${status.connected ? 'connected' : 'not connected'}` : '';
    await this.backend
      .trayStatus({
        summary: `Browsentic Bridge: ${label}${status ? ` · 127.0.0.1:${status.port}` : ''}${link}`,
        toggle: daemon === 'on' ? 'Turn Off' : 'Turn On',
        canToggle: phase === 'main' && (daemon === 'on' || daemon === 'off'),
        canRestart: daemon === 'on',
      })
      .catch(() => undefined);
  }
}

/** What `setup --json` reports that the app acts on. */
interface SetupResult {
  version: string;
  chosen: { id: string; opened: boolean; connected: boolean } | null;
  pairingCode?: string;
  expiresAt?: number;
}

/** Which copies are connected, as one string: a change is what makes the browser rows worth reading again. */
const linkOf = (sessions: SessionSummary[]) => sessions.map((session) => `${session.id}:${session.connected}`).join(',');

export function outcome<T>(result: unknown): T {
  const answer = result as { ok?: boolean; data?: T; error?: { message?: string } } | undefined;
  if (answer?.ok && answer.data !== undefined) return answer.data;
  throw new Error(answer?.error?.message ?? 'Browsentic Bridge answered with something this app cannot read. Update the app.');
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Something went wrong.';
}

export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* Nothing to fall back on: the button says Copied only when this succeeds. */
    throw new Error('The clipboard refused the copy.');
  }
}

export function useModelState(model: Model): State {
  return useSyncExternalStore(model.subscribe, model.snapshot);
}
