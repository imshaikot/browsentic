import type { BrowserRow } from '@/daemon/browsers';
import { judge } from '@/daemon/android/readiness';
import { androidJson, type AndroidJson } from '@/daemon/android/report';
import type { PhoneFacts } from '@/daemon/android/phone-facts';
import type { TrackedDevice } from '@/daemon/android/devices';
import { AGENT_LIST, AGENTS, type AgentKind } from '@/lib/agents/catalog';
import type { GuardrailSettings } from '@/lib/settings/guardrails';
import type { PreferenceChange } from '@/lib/settings/preferences';
import { EMPTY_PROFILE } from '@/lib/settings/profile';
import type { Source } from '@/lib/stores';
import type { AgentListing, Backend, BlockedBrowser, CliOutput, InstallStamp, Lockfile, NodeInstall, PairRequestSummary, PairedBy, PairingMode, Preferences, QueuedNotice } from './backend';

/**
 * How the stand-in machine pairs, picked by the address's hash: #ask has two browsers waiting to be
 * let in, #kept has two kept out, #arrives has Edge pair by itself a moment after the window opens,
 * and #code pairs only by code. Anything else pairs automatically with nobody waiting.
 */
export type Scenario = 'ask' | 'kept' | 'arrives' | 'code' | 'auto';
const SCENARIOS: Scenario[] = ['ask', 'kept', 'arrives', 'code', 'auto'];
const scenarioOf = (hash: string): Scenario => SCENARIOS.find((scenario) => `#${scenario}` === hash) ?? 'auto';

/** The stand-in, with the hands a test needs: a browser asking, one pairing by itself, a notice arriving, and Windows turning toasts on or off. */
export interface MockBackend extends Backend {
  ask(request: PairRequestSummary): void;
  arrive(): void;
  notify(notice: QueuedNotice): void;
  allowNotices(allowed: boolean): void;
}

/**
 * A stand-in machine for working on the window in a plain browser: `yarn win:preview`. Everything
 * is installed and the daemon is running, unless the address ends in #fresh, which starts from a
 * computer that has nothing yet.
 */
export function mockBackend({ instant = false, fresh = location.hash === '#fresh', scenario = scenarioOf(location.hash) } = {}): MockBackend {
  const home = 'C:\\Users\\you';
  const version = '0.8.0';
  let node: NodeInstall | null = fresh ? null : { path: `${home}\\.browsentic\\runtime\\node\\node.exe`, version: 'v24.11.1', isPrivate: true };
  let installed = fresh ? null : version;
  let stamp: InstallStamp | null = fresh ? null : { version, installedAt: new Date().toISOString() };
  let running = !fresh;
  let linked = !fresh;
  let socket = false;
  let codePending = false;
  let active: AgentKind = 'claude';
  const models: Partial<Record<AgentKind, string>> = {};
  const listeners = new Set<(event: string) => void>();
  let preferences: Preferences = { theme: null, guardrails: guardrails(`${home}\\.browsentic\\config.json`), profile: EMPTY_PROFILE };
  const phones = phoneStates(home);
  let phone = -1;
  let mode: PairingMode = scenario === 'ask' ? 'ask' : scenario === 'code' ? 'code' : 'auto';
  let requests: PairRequestSummary[] = scenario === 'ask' ? [...ASKING] : [];
  let blocked: BlockedBrowser[] = scenario === 'kept' ? [...KEPT_OUT] : [];
  let sessions: PairedSession[] = SESSIONS.map(({ pairedAgo, ...session }) => ({ ...session, pairedAt: ago(pairedAgo) }));
  let sessionReads = 0;
  let noticesAllowed = true;
  let notices: QueuedNotice[] = [];
  const announce = (event: string) => listeners.forEach((listener) => listener(event));
  const arrive = () => void sessions.push({ ...ARRIVING, pairedAt: ago(0) });

  const ok = (stdout: string): CliOutput => ({ ok: true, code: 0, stdout, stderr: '' });
  const later = <T>(value: T, ms = 350) => new Promise<T>((resolve) => setTimeout(() => resolve(value), instant ? 0 : ms));
  const lock = (): Lockfile | null => (running ? { pid: 18115, port: 8765, token: 'mock-token', daemonVersion: version } : null);
  const agents = (): AgentListing => ({
    active,
    runners: AGENT_LIST.map(({ kind, bin }, index) =>
      index < 3
        ? { kind, bin, ready: true, version: `${bin} 2.1.${280 + index}`, model: models[kind] }
        : { kind, bin, ready: false, problem: { code: 'AGENT_MISSING' as const, message: `${AGENTS[kind].label} is not installed.`, fix: AGENTS[kind].install } },
    ),
    catalog: AGENT_LIST,
  });

  const replies: Record<string, (frame: Record<string, unknown>) => Record<string, unknown>> = {
    status: () => ({
      status: {
        connected: true,
        daemonVersion: version,
        protocolVersion: 24,
        port: 8765,
        manifestInSync: true,
        extensionVersion: version,
        connectedBrowsers: sessions.filter((session) => session.connected).length,
        pairedBrowsers: sessions.length,
        pairingPending: codePending,
        pairing: { mode, approver: 'app' },
      },
    }),
    sessions: () => {
      if (scenario === 'arrives' && ++sessionReads === 3) arrive();
      return { sessions: sessions.map((session) => ({ ...session, lastSeenAt: ago(4) })) };
    },
    pair: () => ((codePending = true), { code: 'K7Q2M9', expiresAt: Date.now() + 10 * 60 * 1000 }),
    revoke: ({ session }) => {
      const revoked = sessions.filter((held) => !session || held.id === session);
      sessions = sessions.filter((held) => !revoked.includes(held));
      blocked = [...blocked, ...revoked.map(({ id, browser, origin }) => ({ installId: id, browser, origin, at: new Date().toISOString(), reason: 'revoked' as const }))];
      return { revoked: revoked.length };
    },
    pairRequests: () => ({ requests }),
    decide: ({ request, allow, label }) => {
      const asked = requests.find((held) => held.id === request || held.installId === request);
      const installId = asked?.installId ?? blocked.find((held) => held.installId === request)?.installId;
      if (!installId) return { ok: false, error: 'No request or blocked browser has that id.' };
      requests = requests.filter((held) => held !== asked);
      blocked = blocked.filter((held) => held.installId !== installId);
      if (asked && !allow) blocked = [...blocked, { installId, browser: asked.browser, origin: 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/', at: new Date().toISOString(), reason: 'denied' }];
      if (asked && allow) {
        const named = typeof label === 'string' && label.trim() ? label.trim() : undefined;
        sessions.push({ id: installId, browser: asked.browser, label: named, origin: 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/', source: asked.source as Source, extensionVersion: asked.extensionVersion, pairedAt: ago(0), connected: true, pairedBy: 'approved' });
      }
      announce('pair-requests-changed');
      return { ok: true };
    },
    pairing: ({ set }) => {
      if (typeof set === 'string') {
        mode = set as PairingMode;
        announce('settings-changed');
      }
      return { mode, approver: 'app' };
    },
    blocked: () => ({ blocked }),
    notices: () => ({ ok: true }),
    takeNotices: () => {
      const taken = notices;
      notices = [];
      return { notices: taken };
    },
    openNotice: () => ({ ok: true }),
    label: ({ session, label }) => {
      const named = sessions.find((held) => held.id === session);
      if (named) named.label = String(label).trim() || undefined;
      return { ok: !!named };
    },
    preferences: () => ({ result: { ok: true, data: preferences } }),
    setPreference: ({ change }) => {
      const next = change as PreferenceChange;
      preferences =
        next.kind === 'theme'
          ? { ...preferences, theme: next.theme }
          : next.kind === 'profile'
            ? { ...preferences, profile: next.profile }
            : { ...preferences, guardrails: applyGuardrail(preferences.guardrails, next.setting, next.value) };
      listeners.forEach((listener) => listener('settings-changed'));
      return { result: { ok: true, data: preferences } };
    },
    agent: ({ set }) => {
      if (typeof set === 'string') active = set as AgentKind;
      return { state: agents() };
    },
    android: ({ launch }) => {
      if (launch) phone = phones.length - 2;
      return { result: { ok: true, data: phones[Math.max(phone, 0)] } };
    },
  };

  const commands: Record<string, (args: string[]) => CliOutput> = {
    start: () => ((running = true), ok('started')),
    stop: () => ((running = false), ok('stopped')),
    restart: () => ok('restarted'),
    setup: (args) => {
      const browser = args[args.indexOf('--browser') + 1];
      if (args.includes('--browser')) {
        codePending = true;
        return ok(JSON.stringify({ version, extensionDir: null, daemon: { port: 8765, pid: 18115 }, alreadyPaired: true, chosen: { id: browser, unpacked: false, opened: true, connected: false }, pairingCode: 'R4TW7KXE', expiresAt: Date.now() + 10 * 60 * 1000, browsers: rows(sessions) }));
      }
      if (args.includes('--unpacked')) stamp = { version, installedAt: new Date().toISOString() };
      return ok(JSON.stringify({ version, extensionDir: stamp && `${home}\\browsentic\\extension\\chrome-mv3`, daemon: { port: 8765, pid: 18115 }, alreadyPaired: true, chosen: null, browsers: rows(sessions) }));
    },
    browsers: () => ok(JSON.stringify({ running, browsers: rows(sessions), unpacked: { dir: `${home}\\browsentic\\extension\\chrome-mv3`, version: stamp?.version ?? null } })),
    agent: (args) => {
      if (args[1] === 'model') models[args[2] as AgentKind] = args[3];
      return ok(JSON.stringify(agents()));
    },
    android: () => ok(JSON.stringify(phones[(phone = (phone + 1) % phones.length)])),
    skills: () => ok(JSON.stringify(skills(home))),
    approvals: () => ok(JSON.stringify({ grants: [{ action: 'page.submitForm', host: 'github.com', at: ago(2 * 86400) }, { action: 'page.captureDownload', host: 'github.com', at: ago(86400) }, { action: 'page.submitForm', host: 'news.ycombinator.com', at: ago(3600) }] })),
    downloads: () => ok(JSON.stringify({ dir: `${home}\\browsentic\\downloads`, downloads: [{ id: 'd1', name: 'invoice-2026-09.pdf', mime: 'application/pdf', size: 48213, url: 'https://example.com/invoice.pdf', host: 'example.com', notes: 'PDF, 47 KB, from example.com', savedTo: `${home}\\browsentic\\downloads\\invoice-2026-09.pdf`, capturedAt: ago(5400) }] })),
    uninstall: () => ((installed = null), (stamp = null), (running = false), ok('removed')),
  };

  return {
    appInfo: () =>
      later({
        version,
        system: { name: 'Windows 11 Pro 24H2', architecture: 'ARM64' },
        paths: {
          home,
          state: `${home}\\.browsentic`,
          extensionDir: `${home}\\browsentic\\extension\\chrome-mv3`,
          log: `${home}\\.browsentic\\daemon.log`,
          shim: `${home}\\.browsentic\\bin\\browsentic.exe`,
          mcpShim: `${home}\\.browsentic\\bin\\browsentic-mcp.exe`,
          bin: `${home}\\.browsentic\\bin`,
          config: `${home}\\.browsentic\\config.json`,
          separator: '\\',
        },
        payload: { bundled: version, installed, current: installed === version },
      }),
    locateNode: () => later(node),
    installNode: async (onProgress) => {
      for (let step = 0; step <= 10; step++) {
        onProgress({ fraction: step / 10, label: step < 9 ? 'Downloading Node.js v24.11.1' : 'Unpacking' });
        await later(null, 160);
      }
      node = { path: `${home}\\.browsentic\\runtime\\node\\node.exe`, version: 'v24.11.1', isPrivate: true };
      return node;
    },
    installPayload: async () => void (installed = await later(version, 700)),
    cli: async (args) => later((commands[args[0]] ?? (() => ok('')))(args)),
    npmInstall: (pkg) => later(ok(`added 1 package: ${pkg}`), 1200),
    extensionStamp: () => later(stamp, 120),
    browsers: () =>
      later([
        { name: 'Google Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
        { name: 'Microsoft Edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
        { name: 'Brave', path: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
        { name: 'Firefox', path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' },
      ]),
    openExtensionsPage: () => later(undefined),
    agentsOnPath: (bins) => later(fresh ? [] : bins.slice(0, 3)),
    readLock: () => later(lock(), 60),
    logTail: () => later(log(), 60),
    commandLink: () => later({ linkedIn: linked ? `${home}\\.browsentic\\bin` : null, foreign: null }),
    setCommandLink: (on) => later({ linkedIn: (linked = on) ? `${home}\\.browsentic\\bin` : null, foreign: null }),
    controlConnect: () => (running ? later(!socket && (socket = true), 40) : Promise.reject(new Error('The daemon is not running. Turn it on from the Overview tab.'))),
    controlRequest: (frame) => later((replies[String(frame.op)] ?? (() => ({})))(frame), 60),
    controlClose: () => later(void (socket = false), 20),
    trayStatus: () => later(undefined, 0),
    pairRequests: () => later(undefined, 0),
    announcePaired: () => later(undefined, 0),
    noticesAllowed: () => later(noticesAllowed, 0),
    postNotices: () => later(undefined, 0),
    checkUpdate: () => later(null),
    installUpdate: () => later(undefined),
    onControlEvent: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onTray: () => () => undefined,
    onPairLink: () => () => undefined,
    onPairingLaunch: () => () => undefined,
    onNoticeLink: () => () => undefined,
    onWindowFocus: () => () => undefined,
    openUrl: async (url) => void window.open(url, '_blank'),
    reveal: async () => undefined,
    setWindowTheme: async () => undefined,
    ask: (request) => {
      requests = [...requests, request];
      announce('pair-requests-changed');
    },
    arrive,
    notify: (notice) => {
      notices = [...notices.filter((queued) => queued.id !== notice.id), notice];
      announce('notices-changed');
    },
    allowNotices: (allowed) => void (noticesAllowed = allowed),
  };
}

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

interface MockSession {
  id: string;
  browser?: string;
  label?: string;
  origin: string;
  source: Source;
  extensionVersion: string;
  pairedAgo: number;
  connected: boolean;
  pairedBy?: PairedBy;
}

type PairedSession = Omit<MockSession, 'pairedAgo'> & { pairedAt: string };

/** A store copy in Chrome that paired by itself, an unpacked one in Brave a build behind and named for work, and Edge and Firefox yet to get it. */
const SESSIONS: MockSession[] = [
  { id: 's1', browser: 'Google Chrome', origin: 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/', source: 'chrome-web-store', extensionVersion: '0.8.0', pairedAgo: 3 * 86400, connected: true, pairedBy: 'auto' },
  { id: 's2', browser: 'Brave', label: 'Brave (work)', origin: 'chrome-extension://pplbfkdfiimmogofmehpibbmldcefgpc/', source: 'unpacked', extensionVersion: '0.7.15', pairedAgo: 9 * 86400, connected: true, pairedBy: 'code' },
];

const ARRIVING: Omit<MockSession, 'pairedAgo'> = {
  id: '6f1c2a90-3b7e-4d1a-9c55-0e8f5d2b7a41',
  browser: 'Microsoft Edge',
  origin: 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/',
  source: 'chrome-web-store',
  extensionVersion: '0.8.0',
  connected: true,
  pairedBy: 'auto',
};

const asked = (seconds: number) => Date.now() - seconds * 1000;

/** A second Brave profile with the store copy, then a Firefox that asked a little later. */
const ASKING: PairRequestSummary[] = [
  { id: 'Rq7bX2kp', installId: '3e9a51c0-77d2-4b8e-a1f4-6c0d2e9b5f13', browser: 'Brave', source: 'chrome-web-store', extensionVersion: '0.8.0', firstAt: asked(40), lastAskAt: asked(5), nonce: 'q0Zt8Hn3LwVb1yRk5sXe2A' },
  { id: 'Fx4mN8cd', installId: 'a71f0b2e-5c94-4d3a-8e6b-29f1c7d04e88', browser: 'Firefox', source: 'firefox', extensionVersion: '0.8.0', firstAt: asked(12), lastAskAt: asked(2), nonce: 'Jm2Pw9Ux4Ec7Kb1Sd6Fh3Q' },
];

const KEPT_OUT: BlockedBrowser[] = [
  { installId: 'c4d8e2f1-0a6b-4c3d-9e7f-1b2a3c4d5e6f', browser: 'Vivaldi', origin: 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/', at: new Date(Date.now() - 2 * 86400 * 1000).toISOString(), reason: 'revoked' },
  { installId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', browser: 'Opera', origin: 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/', at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), reason: 'denied' },
];

const STORES = {
  'chrome-web-store': { store: 'Chrome Web Store', storeUrl: 'https://chromewebstore.google.com/detail/browsentic/npmocgldfflonjjmdadmdefpnfagnjmp' },
  firefox: { store: 'Firefox add-on', storeUrl: 'https://github.com/imshaikot/browsentic/releases/download/v0.8.0/browsentic-0.8.0-firefox.xpi' },
};

function rows(paired: Pick<MockSession, 'id' | 'browser' | 'source' | 'extensionVersion' | 'connected'>[]): BrowserRow[] {
  const row = (id: BrowserRow['id'], label: string, brand: string, installed: boolean): BrowserRow => {
    const sessions = paired.filter((session) => session.browser === brand).map(({ id, source, extensionVersion, connected }) => ({ id, source, extensionVersion, connected }));
    const firefox = id === 'firefox';
    const source = firefox ? 'firefox' : 'chrome-web-store';
    return {
      id,
      label,
      installed,
      source,
      ...STORES[source],
      steps: [
        firefox
          ? 'Firefox asks whether to let github.com install software, then whether to add Browsentic. Say yes to both.'
          : id === 'edge'
            ? 'Press “Allow extensions from other stores” if Edge shows it at the top of the page, confirm, and press “Add to Chrome”.'
            : `Press “${label === 'Brave' ? 'Add to Brave' : 'Add to Chrome'}”.`,
      ],
      extensionsPage: firefox ? 'about:addons' : `${id === 'edge' ? 'edge' : id === 'brave' ? 'brave' : 'chrome'}://extensions`,
      connected: sessions.some((session) => session.connected),
      sessions,
    };
  };
  return [
    row('chrome', 'Chrome', 'Google Chrome', true),
    row('edge', 'Edge', 'Microsoft Edge', true),
    row('brave', 'Brave', 'Brave', true),
    row('firefox', 'Firefox', 'Firefox', true),
    row('vivaldi', 'Vivaldi', 'Vivaldi', false),
  ];
}

function guardrails(configPath: string): GuardrailSettings {
  return {
    rules: [
      { id: 'form-submission', title: 'Submits a form', reason: 'Submitting a form can send, buy or post something on your behalf.', fallback: 'confirm' },
      { id: 'site-tool-call', title: 'Calls a tool the site provides', reason: 'A site’s own tools can act on your account there.', fallback: 'confirm' },
      { id: 'file-upload', title: 'Uploads one of the user’s files', reason: 'A file leaves your computer.', fallback: 'confirm', override: 'allow' },
      { id: 'file-download', title: 'Saves a file from the page to disk', reason: 'A file from the web lands on your disk.', fallback: 'allow' },
      { id: 'off-scope-navigation', title: 'Leaves the sites this run is about', reason: 'A run stays on the sites it was asked about.', fallback: 'confirm' },
      { id: 'code-injection', title: 'Runs code it wrote in the page', reason: 'Code the agent wrote runs with the page’s access.', fallback: 'deny', locked: true },
      { id: 'non-http-navigation', title: 'Non-http navigation', reason: 'file:, javascript: and data: addresses are not the web.', fallback: 'deny', locked: true },
    ],
    fence: { enabled: true, overridden: false },
    unattended: { effect: 'deny', overridden: false },
    hosts: ['github.com', 'localhost'],
    configPath,
  };
}

function applyGuardrail(settings: GuardrailSettings, setting: string, value: unknown): GuardrailSettings {
  if (setting === 'fence') return { ...settings, fence: { enabled: value === null ? true : Boolean(value), overridden: value !== null } };
  if (setting === 'unattended') return { ...settings, unattended: { effect: value === 'allow' ? 'allow' : 'deny', overridden: value !== null } };
  return {
    ...settings,
    rules: settings.rules.map((rule) => (rule.id === setting ? { ...rule, override: value === null ? undefined : (value as typeof rule.fallback) } : rule)),
  };
}

function skills(home: string) {
  const skill = (name: string, description: string, source: string, domains: string[] = [], isDefault = false, provenance = 'authored') => ({
    name,
    description,
    triggers: [],
    isDefault,
    category: 'browsing',
    domains,
    source,
    provenance,
    path: `${home}\\browsentic\\skills\\${name}\\SKILL.md`,
  });
  return {
    dirs: ['~\\.browsentic\\cli\\skills', '~\\browsentic\\skills'],
    agent: 'claude',
    agentSkills: [{ name: 'review', description: 'Reviews the current diff for correctness bugs.' }],
    skills: [
      skill('browser-control', 'Drives the page: finds elements by what they say, fills forms, and checks each step landed.', 'bundled', [], true),
      skill('browse-navigation', 'Moves between pages and tabs without losing the thread of a task.', 'bundled', [], true),
      skill('a-eye', 'Reads a picture the user points at, or a chart the page drew.', 'bundled'),
      skill('github-issues', 'Triages issues: labels, duplicates and the first reply.', 'user', ['github.com']),
      skill('hn-front-page', 'A site map of Hacker News: where the threads, the comments and the flags are.', 'user', ['news.ycombinator.com'], false, 'generated'),
    ],
  };
}

function log() {
  const stamp = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
  return [
    `${stamp(310)} daemon listening on 127.0.0.1:8765`,
    `${stamp(300)} native host registered for Chrome, Edge`,
    `${stamp(240)} browser connected: Google Chrome (extension 0.8.0)`,
    `${stamp(200)} paired chrome-extension://pplbfkdfiimmogofmehpibbmldcefgpc`,
    `${stamp(120)} run 7f3a started: claude, 1 tab`,
    `${stamp(90)} page.submitForm on github.com: confirm → allowed`,
    `${stamp(60)} run 7f3a finished in 41s`,
    `${stamp(30)} agent codex: version probe failed: exited 1`,
  ].join('\n');
}

/** What `browsentic android --json` says on Windows, one state per "Check again": no adb, no phone, waiting for Allow, Chrome closed, ready. */
function phoneStates(home: string): AndroidJson[] {
  const adb = { path: `${home}\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe`, version: '37.0.1-14963125' };
  const pixel: TrackedDevice = { serial: '38041FDJH00ABC', state: 'ready', adbState: 'device', transport: 'usb', model: 'Pixel 8', transportId: '3' };
  const facts: PhoneFacts = {
    booted: true,
    model: 'Pixel 8',
    manufacturer: 'Google',
    android: '16',
    sdk: 36,
    screen: { width: 1080, height: 2400, density: 420, awake: true },
    chrome: { installed: true, version: '150.0.7871.186', running: true, debuggable: true },
  };
  const seen = (devices: Parameters<typeof judge>[0]['devices'], found: typeof adb | null = adb) =>
    androidJson(judge({ enabled: true, platform: 'win32', adb: found, devices }));
  return [
    seen([], null),
    seen([]),
    seen([{ device: { ...pixel, state: 'unauthorized', adbState: 'unauthorized', model: undefined }, facts: null }]),
    seen([{ device: pixel, facts: { ...facts, chrome: { ...facts.chrome, running: false, debuggable: false } } }]),
    seen([{ device: pixel, facts }]),
  ];
}
