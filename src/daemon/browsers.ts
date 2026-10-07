/**
 * The browsers setup offers, where each one gets the extension, how to find it on this computer,
 * and how to open a page in it. A store page given on the command line opens in any of them; only
 * their own chrome:// pages are refused there.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import { CHROME_WEB_STORE, EDGE_ADD_ONS, SOURCE_LABEL, type Source } from '@/lib/stores';
import type { SessionSummary } from './control';
import { signedAddonUrl } from './firefox-addon';

export const BROWSER_IDS = ['chrome', 'edge', 'brave', 'arc', 'vivaldi', 'opera', 'chromium', 'firefox'] as const;
export type BrowserId = (typeof BROWSER_IDS)[number];

export const isBrowserId = (value: unknown): value is BrowserId => BROWSER_IDS.includes(value as BrowserId);

interface BrowserEntry {
  label: string;
  /** How the extension names this browser when it connects: its user-agent brand. */
  brand: RegExp;
  extensionsPage: string;
  /** The store button's words in this browser. */
  button: string;
  mac?: string;
  linux?: string[];
  /** The program App Paths registers, and where it installs under Program Files or AppData without one. */
  windows?: [program: string, relative: string];
}

export const BROWSERS: Record<BrowserId, BrowserEntry> = {
  chrome: {
    label: 'Chrome',
    brand: /Google Chrome/i,
    extensionsPage: 'chrome://extensions',
    button: 'Add to Chrome',
    mac: 'Google Chrome.app',
    linux: ['google-chrome', 'google-chrome-stable'],
    windows: ['chrome.exe', 'Google\\Chrome\\Application\\chrome.exe'],
  },
  edge: {
    label: 'Edge',
    brand: /Edge/i,
    extensionsPage: 'edge://extensions',
    button: 'Get',
    mac: 'Microsoft Edge.app',
    linux: ['microsoft-edge', 'microsoft-edge-stable'],
    windows: ['msedge.exe', 'Microsoft\\Edge\\Application\\msedge.exe'],
  },
  brave: {
    label: 'Brave',
    brand: /Brave/i,
    extensionsPage: 'brave://extensions',
    button: 'Add to Brave',
    mac: 'Brave Browser.app',
    linux: ['brave-browser', 'brave'],
    windows: ['brave.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
  },
  arc: {
    label: 'Arc',
    brand: /^Arc$/i,
    extensionsPage: 'arc://extensions',
    button: 'Add to Chrome',
    mac: 'Arc.app',
  },
  vivaldi: {
    label: 'Vivaldi',
    brand: /Vivaldi/i,
    extensionsPage: 'vivaldi://extensions',
    button: 'Add to Chrome',
    mac: 'Vivaldi.app',
    linux: ['vivaldi', 'vivaldi-stable'],
    windows: ['vivaldi.exe', 'Vivaldi\\Application\\vivaldi.exe'],
  },
  opera: {
    label: 'Opera',
    brand: /Opera/i,
    extensionsPage: 'opera://extensions',
    button: 'Add to Opera',
    mac: 'Opera.app',
    linux: ['opera'],
    windows: ['opera.exe', 'Programs\\Opera\\opera.exe'],
  },
  chromium: {
    label: 'Chromium',
    brand: /^Chromium$/i,
    extensionsPage: 'chrome://extensions',
    button: 'Add to Chrome',
    mac: 'Chromium.app',
    linux: ['chromium', 'chromium-browser'],
    windows: ['chromium.exe', 'Chromium\\Application\\chrome.exe'],
  },
  firefox: {
    label: 'Firefox',
    brand: /Firefox/i,
    extensionsPage: 'about:addons',
    button: 'Add',
    mac: 'Firefox.app',
    linux: ['firefox'],
    windows: ['firefox.exe', 'Mozilla Firefox\\firefox.exe'],
  },
};

export function sourceFor(id: BrowserId): Source {
  if (id === 'firefox') return 'firefox';
  return id === 'edge' ? 'edge-add-ons' : 'chrome-web-store';
}

export function storeUrl(id: BrowserId, version: string): string {
  const source = sourceFor(id);
  if (source === 'firefox') return signedAddonUrl(version);
  return source === 'edge-add-ons' ? EDGE_ADD_ONS.url : CHROME_WEB_STORE.url;
}

/** What to press once the page is open, in that browser's own words. */
export function storeSteps(id: BrowserId): string[] {
  if (id === 'firefox') {
    return ['Firefox asks whether to let github.com install software, then whether to add Browsentic. Say yes to both.'];
  }
  if (id === 'opera') {
    return ['Opera first offers its “Install Chrome Extensions” helper: add it, then press “Add to Opera”.'];
  }
  return [`Press “${BROWSERS[id].button}”.`];
}

/** One browser as setup, `browsentic browsers` and the apps show it. */
export interface BrowserRow {
  id: BrowserId;
  label: string;
  installed: boolean;
  source: Source;
  store: string;
  storeUrl: string;
  steps: string[];
  extensionsPage: string;
  connected: boolean;
  sessions: Pick<SessionSummary, 'id' | 'source' | 'extensionVersion' | 'connected'>[];
}

export function browserRows(sessions: SessionSummary[], located: Located[], version: string): BrowserRow[] {
  return BROWSER_IDS.map((id) => {
    const own = sessions.filter((session) => browserOf(session.browser) === id);
    return {
      id,
      label: BROWSERS[id].label,
      installed: located.some((found) => found.id === id),
      source: sourceFor(id),
      store: SOURCE_LABEL[sourceFor(id)],
      storeUrl: storeUrl(id, version),
      steps: storeSteps(id),
      extensionsPage: BROWSERS[id].extensionsPage,
      connected: own.some((session) => session.connected),
      sessions: own.map(({ id, source, extensionVersion, connected }) => ({ id, source, extensionVersion, connected })),
    };
  });
}

/** Which browser a connected extension is in, from the brand it reported. */
export function browserOf(brand: string | undefined): BrowserId | undefined {
  return brand ? BROWSER_IDS.find((id) => BROWSERS[id].brand.test(brand)) : undefined;
}

export interface Located {
  id: BrowserId;
  /** The app bundle, program or command that opens it. */
  path: string;
}

export interface LocateOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  /** The program App Paths registers on Windows, or nothing. */
  registered?: (program: string) => string | undefined;
}

export function locateBrowsers(options: LocateOptions = {}): Located[] {
  const { platform = process.platform, home = homedir(), env = process.env, exists = existsSync, registered = appPath } = options;
  return BROWSER_IDS.flatMap((id): Located[] => {
    const path = locate(BROWSERS[id], { platform, home, env, exists, registered });
    return path ? [{ id, path }] : [];
  });
}

function locate(entry: BrowserEntry, { platform, home, env, exists, registered }: Required<LocateOptions>): string | undefined {
  if (platform === 'darwin') {
    return entry.mac && [posix.join('/Applications', entry.mac), posix.join(home, 'Applications', entry.mac)].find(exists);
  }
  if (platform === 'win32') {
    if (!entry.windows) return undefined;
    const [program, relative] = entry.windows;
    const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((root): root is string => !!root);
    return [registered(program), ...roots.map((root) => `${root}\\${relative}`)].find((path) => !!path && exists(path));
  }
  const dirs = (env.PATH ?? '').split(posix.delimiter).filter(Boolean);
  return entry.linux?.flatMap((bin) => dirs.map((dir) => posix.join(dir, bin))).find(exists);
}

function appPath(program: string): string | undefined {
  for (const hive of ['HKCU', 'HKLM']) {
    try {
      const out = execFileSync('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${program}`, '/ve'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const value = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(out)?.[1]?.trim().replace(/^"|"$/g, '');
      if (value) return value;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Opens the page in that browser, or in the default one when it was not found. Never waits on it,
 * and never hides it: on Windows windowsHide hides a program's first window, not only a console.
 */
export function openPage(url: string, browser?: Located, platform: NodeJS.Platform = process.platform): void {
  const [file, args] = launch(url, browser, platform);
  const child = spawn(file, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

export function launch(url: string, browser: Located | undefined, platform: NodeJS.Platform): [string, string[]] {
  if (platform === 'darwin') return ['open', browser ? ['-a', browser.path, url] : [url]];
  if (browser) return [browser.path, [url]];
  return platform === 'win32' ? ['explorer.exe', [url]] : ['xdg-open', [url]];
}
