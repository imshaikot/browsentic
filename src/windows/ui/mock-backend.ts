import { AGENT_LIST, AGENTS, type AgentKind } from '@/lib/agents/catalog';
import type { GuardrailSettings } from '@/lib/settings/guardrails';
import type { PreferenceChange } from '@/lib/settings/preferences';
import type { AgentListing, Backend, CliOutput, InstallStamp, Lockfile, NodeInstall, Preferences } from './backend';

/**
 * A stand-in machine for working on the window in a plain browser: `yarn win:preview`. Everything
 * is installed and the daemon is running, unless the address ends in #fresh, which starts from a
 * computer that has nothing yet.
 */
export function mockBackend({ instant = false, fresh = location.hash === '#fresh' } = {}): Backend {
  const home = 'C:\\Users\\you';
  const version = '0.8.0';
  let node: NodeInstall | null = fresh ? null : { path: `${home}\\.browsentic\\runtime\\node\\node.exe`, version: 'v24.11.1', isPrivate: true };
  let installed = fresh ? null : version;
  let stamp: InstallStamp | null = fresh ? null : { version, installedAt: new Date().toISOString() };
  let running = !fresh;
  let linked = !fresh;
  let socket = false;
  let active: AgentKind = 'claude';
  const models: Partial<Record<AgentKind, string>> = {};
  const listeners = new Set<(event: string) => void>();
  let preferences: Preferences = { theme: null, guardrails: guardrails(`${home}\\.browsentic\\config.json`) };

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
      status: { connected: true, daemonVersion: version, protocolVersion: 21, port: 8765, manifestInSync: true, extensionVersion: version, connectedBrowsers: 1, pairedBrowsers: 1, pairingPending: false },
    }),
    sessions: () => ({
      sessions: [
        { id: 's1', browser: 'Google Chrome', origin: 'chrome-extension://pplbfkdfiimmogofmehpibbmldcefgpc/', extensionVersion: version, pairedAt: ago(3 * 86400), lastSeenAt: ago(4), connected: true },
        { id: 's2', browser: 'Microsoft Edge', origin: 'chrome-extension://jmhkmekhafbfbkmpoheoinnbicpbnlpa/', extensionVersion: '0.7.6', pairedAt: ago(9 * 86400), lastSeenAt: ago(2 * 3600), connected: false },
      ],
    }),
    pair: () => ({ code: 'K7Q2M9', expiresAt: Date.now() + 10 * 60 * 1000 }),
    revoke: () => ({ revoked: 1 }),
    preferences: () => ({ result: { ok: true, data: preferences } }),
    setPreference: ({ change }) => {
      const next = change as PreferenceChange;
      preferences = next.kind === 'theme' ? { ...preferences, theme: next.theme } : { ...preferences, guardrails: applyGuardrail(preferences.guardrails, next.setting, next.value) };
      listeners.forEach((listener) => listener('settings-changed'));
      return { result: { ok: true, data: preferences } };
    },
    agent: ({ set }) => {
      if (typeof set === 'string') active = set as AgentKind;
      return { state: agents() };
    },
  };

  const commands: Record<string, (args: string[]) => CliOutput> = {
    start: () => ((running = true), ok('started')),
    stop: () => ((running = false), ok('stopped')),
    restart: () => ok('restarted'),
    setup: () => ((stamp = { version, installedAt: new Date().toISOString() }), ok(JSON.stringify({ version, extensionDir: `${home}\\browsentic\\extension\\chrome-mv3`, daemon: { port: 8765, pid: 18115 }, alreadyPaired: true, pairingCode: null }))),
    agent: (args) => {
      if (args[1] === 'model') models[args[2] as AgentKind] = args[3];
      return ok(JSON.stringify(agents()));
    },
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
    browsers: () => later([{ name: 'Google Chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }, { name: 'Microsoft Edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' }]),
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
    checkUpdate: () => later(null),
    installUpdate: () => later(undefined),
    onControlEvent: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    onTray: () => () => undefined,
    openUrl: async (url) => void window.open(url, '_blank'),
    reveal: async () => undefined,
    setWindowTheme: async () => undefined,
  };
}

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

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
