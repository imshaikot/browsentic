/**
 * Lets the browser reach Browsentic Bridge. Chrome, Edge, Brave, Firefox and their forks each launch a
 * program registered as a native messaging host when the extension asks for it. The registration lists
 * the exact extension origins allowed to launch it: both store listings always, plus the unpacked folder
 * and whatever has paired, recomputed on every setup, every pairing and every Bridge start.
 *
 * A browser does not always read its own folder: Brave and Opera read Chrome's on macOS, and every
 * Chromium fork on Windows falls back to Chrome's key. So Chrome's and Mozilla's locations are written
 * whether or not those browsers are installed, and each installed browser's own location on top.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { NATIVE_HOST_NAME } from '@/lib/actions/protocol';
import { FIREFOX_ADDON_ID, STORE_EXTENSION_IDS } from '@/lib/stores';
import { listSessions } from './auth-store';
import { readAgentConfig } from './agent/config';
import { stateDir } from './lockfile';
import { log } from './log';
import { extensionDir } from './paths';
import { BRIDGE_TASK, registerBridgeTask, removeBridgeTask, windowsTasks, type TaskScheduler } from './windows-task';

export { NATIVE_HOST_NAME };

export type Family = 'chromium' | 'firefox';

export interface HostTarget {
  browser: string;
  family: Family;
  /** Any of these present means the browser is installed. */
  installs: string[];
  /** macOS and Linux: every folder this browser reads a manifest from, which is not always its own. */
  manifestDirs?: string[];
  /** Windows: the registry key this browser reads. */
  registryKey?: string;
  /** Written whether or not this browser is installed, because other browsers read it too. */
  baseline?: boolean;
}

interface MacBrowser {
  browser: string;
  family?: Family;
  /** Its folder under ~/Library/Application Support. */
  profile: string;
  apps: string[];
  /** The folders under ~/Library/Application Support whose NativeMessagingHosts it reads. */
  reads: string[];
  baseline?: boolean;
}

const CHROME = 'Google/Chrome';
const MOZILLA = 'Mozilla';

/** A file the browser itself writes into its profile folder, which a baseline manifest written there does not make. */
const PROFILE_MARK: Record<Family, string> = { chromium: 'Local State', firefox: 'profiles.ini' };

const MAC_BROWSERS: MacBrowser[] = [
  { browser: 'Chrome', profile: CHROME, apps: ['Google Chrome.app'], reads: [CHROME], baseline: true },
  { browser: 'Chrome Beta', profile: 'Google/Chrome Beta', apps: ['Google Chrome Beta.app'], reads: ['Google/Chrome Beta'] },
  { browser: 'Chrome Dev', profile: 'Google/Chrome Dev', apps: ['Google Chrome Dev.app'], reads: ['Google/Chrome Dev'] },
  { browser: 'Chrome Canary', profile: 'Google/Chrome Canary', apps: ['Google Chrome Canary.app'], reads: ['Google/Chrome Canary'] },
  {
    browser: 'Chrome for Testing',
    profile: 'Google/Chrome for Testing',
    apps: ['Google Chrome for Testing.app'],
    reads: ['Google/Chrome for Testing'],
  },
  { browser: 'Chromium', profile: 'Chromium', apps: ['Chromium.app'], reads: ['Chromium'] },
  { browser: 'Edge', profile: 'Microsoft Edge', apps: ['Microsoft Edge.app'], reads: ['Microsoft Edge'] },
  { browser: 'Edge Beta', profile: 'Microsoft Edge Beta', apps: ['Microsoft Edge Beta.app'], reads: ['Microsoft Edge Beta'] },
  { browser: 'Edge Dev', profile: 'Microsoft Edge Dev', apps: ['Microsoft Edge Dev.app'], reads: ['Microsoft Edge Dev'] },
  { browser: 'Edge Canary', profile: 'Microsoft Edge Canary', apps: ['Microsoft Edge Canary.app'], reads: ['Microsoft Edge Canary'] },
  // brave-core points both host folders at Chrome's (brave_main_delegate.cc); its own is kept for when it stops.
  { browser: 'Brave', profile: 'BraveSoftware/Brave-Browser', apps: ['Brave Browser.app'], reads: [CHROME, 'BraveSoftware/Brave-Browser'] },
  {
    browser: 'Brave Beta',
    profile: 'BraveSoftware/Brave-Browser-Beta',
    apps: ['Brave Browser Beta.app'],
    reads: [CHROME, 'BraveSoftware/Brave-Browser-Beta'],
  },
  {
    browser: 'Brave Nightly',
    profile: 'BraveSoftware/Brave-Browser-Nightly',
    apps: ['Brave Browser Nightly.app'],
    reads: [CHROME, 'BraveSoftware/Brave-Browser-Nightly'],
  },
  { browser: 'Vivaldi', profile: 'Vivaldi', apps: ['Vivaldi.app'], reads: ['Vivaldi'] },
  { browser: 'Arc', profile: 'Arc/User Data', apps: ['Arc.app'], reads: ['Arc/User Data', CHROME] },
  { browser: 'Opera', profile: 'com.operasoftware.Opera', apps: ['Opera.app'], reads: [CHROME] },
  { browser: 'Opera GX', profile: 'com.operasoftware.OperaGX', apps: ['Opera GX.app'], reads: [CHROME] },
  { browser: 'Comet', profile: 'Comet', apps: ['Comet.app'], reads: [CHROME] },
  { browser: 'Thorium', profile: 'Thorium', apps: ['Thorium.app'], reads: ['Thorium'] },
  {
    browser: 'Firefox',
    family: 'firefox',
    profile: 'Firefox',
    apps: ['Firefox.app', 'Firefox Developer Edition.app', 'Firefox Nightly.app'],
    reads: [MOZILLA],
    baseline: true,
  },
  { browser: 'Zen', family: 'firefox', profile: 'zen', apps: ['Zen.app', 'Zen Browser.app'], reads: [MOZILLA] },
  { browser: 'LibreWolf', family: 'firefox', profile: 'librewolf', apps: ['LibreWolf.app'], reads: [MOZILLA] },
  { browser: 'Floorp', family: 'firefox', profile: 'Floorp', apps: ['Floorp.app'], reads: [MOZILLA] },
  // Waterfox reads Mozilla's folder only from 6.7.6 on.
  { browser: 'Waterfox', family: 'firefox', profile: 'Waterfox', apps: ['Waterfox.app'], reads: ['Waterfox', MOZILLA] },
];

const LINUX_BROWSERS: [string, Family, string, string][] = [
  ['Chrome', 'chromium', '.config/google-chrome', '.config/google-chrome/NativeMessagingHosts'],
  ['Chromium', 'chromium', '.config/chromium', '.config/chromium/NativeMessagingHosts'],
  ['Edge', 'chromium', '.config/microsoft-edge', '.config/microsoft-edge/NativeMessagingHosts'],
  ['Brave', 'chromium', '.config/BraveSoftware/Brave-Browser', '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts'],
  ['Vivaldi', 'chromium', '.config/vivaldi', '.config/vivaldi/NativeMessagingHosts'],
  ['Firefox', 'firefox', '.mozilla', '.mozilla/native-messaging-hosts'],
];

type WindowsRoot = 'LOCALAPPDATA' | 'APPDATA';

/**
 * Every Chromium build falls back to Chrome's key, and only Chromium's own reads another first
 * (launch_context_win.cc), so Brave, Vivaldi, Opera and Chrome for Testing are let in through Chrome's.
 */
const WINDOWS_BROWSERS: [string, Family, string, WindowsRoot, string][] = [
  ['Chrome', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'Google\\Chrome\\User Data'],
  ['Chrome Beta', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'Google\\Chrome Beta\\User Data'],
  ['Chrome Dev', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'Google\\Chrome Dev\\User Data'],
  ['Chrome Canary', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'Google\\Chrome SxS\\User Data'],
  ['Chrome for Testing', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'Google\\Chrome for Testing\\User Data'],
  ['Chromium', 'chromium', 'Chromium', 'LOCALAPPDATA', 'Chromium\\User Data'],
  ['Edge', 'chromium', 'Microsoft\\Edge', 'LOCALAPPDATA', 'Microsoft\\Edge\\User Data'],
  ['Edge Beta', 'chromium', 'Microsoft\\Edge', 'LOCALAPPDATA', 'Microsoft\\Edge Beta\\User Data'],
  ['Edge Dev', 'chromium', 'Microsoft\\Edge', 'LOCALAPPDATA', 'Microsoft\\Edge Dev\\User Data'],
  ['Edge Canary', 'chromium', 'Microsoft\\Edge', 'LOCALAPPDATA', 'Microsoft\\Edge SxS\\User Data'],
  ['Brave', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'BraveSoftware\\Brave-Browser\\User Data'],
  ['Brave Beta', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'BraveSoftware\\Brave-Browser-Beta\\User Data'],
  ['Brave Nightly', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'BraveSoftware\\Brave-Browser-Nightly\\User Data'],
  ['Vivaldi', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'Vivaldi\\User Data'],
  ['Opera', 'chromium', 'Google\\Chrome', 'APPDATA', 'Opera Software\\Opera Stable'],
  ['Opera GX', 'chromium', 'Google\\Chrome', 'APPDATA', 'Opera Software\\Opera GX Stable'],
  ['Firefox', 'firefox', 'Mozilla', 'APPDATA', 'Mozilla\\Firefox'],
  ['Zen', 'firefox', 'Mozilla', 'APPDATA', 'zen'],
  ['LibreWolf', 'firefox', 'Mozilla', 'APPDATA', 'librewolf'],
  ['Waterfox', 'firefox', 'Mozilla', 'APPDATA', 'Waterfox'],
  ['Floorp', 'firefox', 'Mozilla', 'APPDATA', 'Floorp'],
];

const WINDOWS_BASELINES = new Set(['Chrome', 'Firefox']);

/** Written for Brave up to 0.8.1, which never read it; an uninstall still takes it away. */
const RETIRED_WINDOWS_VENDORS = ['BraveSoftware\\Brave-Browser'];

const windowsKey = (vendor: string) => `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;

/** A macOS app that names its own Chromium user-data folder in Info.plist, as forks do. */
export interface ChromiumFork {
  browser: string;
  app: string;
  dataDir: string;
}

export function hostTargets(
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
  env = process.env,
  forks: readonly ChromiumFork[] = [],
): HostTarget[] {
  if (platform === 'darwin') {
    const support = posix.join(home, 'Library', 'Application Support');
    const hostsIn = (dir: string) => posix.join(support, dir, 'NativeMessagingHosts');
    const known = MAC_BROWSERS.map(({ browser, family = 'chromium', profile, apps, reads, baseline }) => ({
      browser,
      family,
      installs: [posix.join(support, profile, PROFILE_MARK[family]), ...apps.flatMap((app) => macApps(home).map((root) => posix.join(root, app)))],
      manifestDirs: reads.map(hostsIn),
      baseline,
    }));
    const covered = new Set(MAC_BROWSERS.flatMap(({ apps }) => apps));
    const discovered = forks
      .filter((fork) => !covered.has(posix.basename(fork.app)))
      .map((fork) => ({ browser: fork.browser, family: 'chromium' as const, installs: [fork.app], manifestDirs: [hostsIn(fork.dataDir)] }));
    return [...known, ...discovered];
  }
  if (platform === 'win32') {
    const roots = {
      LOCALAPPDATA: env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'),
      APPDATA: env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'),
    };
    return WINDOWS_BROWSERS.map(([browser, family, vendor, root, profile]) => ({
      browser,
      family,
      installs: [win32.join(roots[root], profile)],
      registryKey: windowsKey(vendor),
      baseline: WINDOWS_BASELINES.has(browser),
    }));
  }
  return LINUX_BROWSERS.map(([browser, family, dir, manifests]) => ({
    browser,
    family,
    installs: [posix.join(home, dir)],
    manifestDirs: [posix.join(home, manifests)],
  }));
}

const macApps = (home: string) => ['/Applications', posix.join(home, 'Applications')];

const CR_PRODUCT_DIR = /<key>CrProductDirName<\/key>\s*<string>([^<]+)<\/string>/;

/** Chromium derives a fork's host folder from CrProductDirName (chrome_paths_mac.mm), so a fork no table names still gets one. */
export function chromiumForks(home = homedir()): ChromiumFork[] {
  return macApps(home).flatMap((root) => {
    let names: string[];
    try {
      names = readdirSync(root).filter((name) => name.endsWith('.app'));
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      const dataDir = productDir(posix.join(root, name, 'Contents', 'Info.plist'));
      return dataDir ? [{ browser: name.slice(0, -'.app'.length), app: posix.join(root, name), dataDir }] : [];
    });
  });
}

function productDir(plist: string): string | undefined {
  let raw: Buffer;
  try {
    raw = readFileSync(plist);
  } catch {
    return undefined;
  }
  if (!raw.includes('CrProductDirName')) return undefined;
  const text = raw.toString('utf8');
  const named = text.startsWith('bplist') ? binaryPlistValue(plist) : CR_PRODUCT_DIR.exec(text)?.[1];
  const dir = named?.trim();
  return dir && !dir.startsWith('/') && !dir.split('/').includes('..') ? dir : undefined;
}

function binaryPlistValue(plist: string): string | undefined {
  try {
    return execFileSync('plutil', ['-extract', 'CrProductDirName', 'raw', '-o', '-', plist], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

/**
 * Chrome names an unpacked extension after its folder: the SHA-256 of the path, spelled in a–p.
 * On Windows it hashes the path as UTF-16, with a lower-case drive letter raised first
 * (`crx_file::id_util::MaybeNormalizePath`).
 */
export function unpackedExtensionOrigin(dir: string, platform: NodeJS.Platform = process.platform): string {
  const path =
    platform === 'win32' ? Buffer.from(dir.replace(/^[a-z](?=:)/, (drive) => drive.toUpperCase()), 'utf16le') : dir;
  const hex = createHash('sha256').update(path).digest('hex').slice(0, 32);
  const id = [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
  return `chrome-extension://${id}/`;
}

const asOrigin = (origin: string) => (origin.endsWith('/') ? origin : `${origin}/`);

export function allowedOrigins(platform: NodeJS.Platform = process.platform): string[] {
  const paired = listSessions()
    .map((session) => session.origin)
    .filter((origin) => origin.startsWith('chrome-extension://'));
  const unpacked = unpackedExtensionOrigin(extensionDir(readAgentConfig().extensionDir), platform);
  const stores = STORE_EXTENSION_IDS.map((id) => `chrome-extension://${id}/`);
  return [...new Set([...stores, unpacked, ...paired].map(asOrigin))].sort();
}

export function hostManifest(family: Family, launcher: string, origins: readonly string[]): Record<string, unknown> {
  return {
    name: NATIVE_HOST_NAME,
    description: 'Starts and connects to Browsentic Bridge when the browser needs it',
    path: launcher,
    type: 'stdio',
    ...(family === 'firefox' ? { allowed_extensions: [FIREFOX_ADDON_ID] } : { allowed_origins: origins }),
  };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export interface LauncherPins {
  cliPath: string;
  nodePath: string;
  pathEnv: string;
}

/**
 * A host must write nothing but its framed reply: Firefox up to 157 on macOS can wait forever on a host
 * that writes to stderr (bug 1981177), and Node prints its own warnings there.
 */
export function launcherScript(options: LauncherPins & { platform: NodeJS.Platform }): string {
  const { platform, cliPath, nodePath, pathEnv } = options;
  if (platform === 'win32') {
    // cmd.exe reads each line in the console's code page, which mangles a UTF-8 path like C:\Users\José.
    return [
      '@echo off',
      'chcp 65001 >nul',
      `set "PATH=${pathEnv}"`,
      'set "NODE_NO_WARNINGS=1"',
      `if exist "${cliPath}" (`,
      `  "${nodePath}" "${cliPath}" native-host %*`,
      ') else (',
      '  call npx --yes browsentic native-host %*',
      ')',
      '',
    ].join('\r\n');
  }
  return [
    '#!/bin/sh',
    `PATH=${shellQuote(pathEnv)}`,
    'NODE_NO_WARNINGS=1',
    'export PATH NODE_NO_WARNINGS',
    `NODE=${shellQuote(nodePath)}`,
    '[ -x "$NODE" ] || NODE=node',
    `CLI=${shellQuote(cliPath)}`,
    'if [ -f "$CLI" ]; then exec "$NODE" "$CLI" native-host "$@"; fi',
    'exec npx --yes browsentic native-host "$@"',
    '',
  ].join('\n');
}

const unquoteShell = (quoted: string) => quoted.replace(/'\\''/g, "'");

/** What a launcher was pinned to, read back from the script itself. */
export function launcherPins(script: string, platform: NodeJS.Platform): LauncherPins | null {
  if (platform === 'win32') {
    const run = /^\s*"([^"]+)" "([^"]+)" native-host %\*\s*$/m.exec(script);
    const path = /^set "PATH=(.*)"\s*$/m.exec(script);
    return run && path ? { nodePath: run[1], cliPath: run[2], pathEnv: path[1] } : null;
  }
  const quoted = (name: string) => new RegExp(`^${name}='((?:[^']|'\\\\'')*)'$`, 'm').exec(script)?.[1];
  const [nodePath, cliPath, pathEnv] = ['NODE', 'CLI', 'PATH'].map(quoted);
  return nodePath !== undefined && cliPath !== undefined && pathEnv !== undefined
    ? { nodePath: unquoteShell(nodePath), cliPath: unquoteShell(cliPath), pathEnv: unquoteShell(pathEnv) }
    : null;
}

export const nativeHostDir = join(stateDir, 'native-host');
export const launcherPath = (platform: NodeJS.Platform = process.platform) =>
  join(nativeHostDir, platform === 'win32' ? 'browsentic-native-host.cmd' : 'browsentic-native-host');

export interface HostInstall {
  launcher: string;
  browsers: string[];
  /** Set when nothing was registered because this Bridge's state lives outside the home folder. */
  skipped?: string;
}

/** The keys Windows browsers read. A test hands in its own. */
export interface Registry {
  set(key: string, value: string): void;
  has(key: string): boolean;
  /** Throws when the key is not there. */
  remove(key: string): void;
}

// The daemon re-registers on every pairing, and it has no console: each reg.exe would get a window of its own.
const reg = (args: string[]) => execFileSync('reg', args, { stdio: 'ignore', windowsHide: true });

export const windowsRegistry: Registry = {
  set: (key, value) => reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f']),
  has: (key) => {
    try {
      reg(['query', key, '/ve']);
      return true;
    } catch {
      return false;
    }
  },
  remove: (key) => reg(['delete', key, '/f']),
};

export interface HostOptions {
  platform?: NodeJS.Platform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Whether a browser's profile or app is there. */
  exists?: (path: string) => boolean;
  registry?: Registry;
  /** macOS apps that name their own Chromium data folder. */
  forks?: () => readonly ChromiumFork[];
  /** Where this Bridge keeps its state. */
  state?: string;
  /** Windows Task Scheduler, which starts the Bridge for Firefox. */
  tasks?: TaskScheduler;
}

/**
 * The user's browsers read one set of manifests and keys. A Bridge whose state lives outside the home
 * folder, a scratch BROWSENTIC_HOME above all, must not point them at its own launcher, or the user's
 * browsers would wake and pair with a throwaway Bridge.
 */
export function registersHosts({ state = stateDir, home = homedir(), env = process.env }: HostOptions = {}): boolean {
  if (env.BROWSENTIC_REGISTER_HOST === '1') return true;
  // The two are paths on this machine, whichever browsers' layout a caller is working out, so their own spelling decides.
  const windowsPaths = WINDOWS_PATH.test(home) || WINDOWS_PATH.test(state);
  const path = windowsPaths ? win32 : posix;
  const fold = (value: string) => (windowsPaths || process.platform === 'darwin' ? value.toLowerCase() : value);
  const inside = path.relative(fold(home), fold(state));
  return !!inside && !inside.startsWith('..') && !path.isAbsolute(inside);
}

const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;

const machine = ({
  platform = process.platform,
  home = homedir(),
  env = process.env,
  exists = existsSync,
  registry = windowsRegistry,
  forks = () => (platform === 'darwin' ? chromiumForks(home) : []),
}: HostOptions) => ({ platform, targets: hostTargets(platform, home, env, forks()), exists, registry });

const installedTarget = (target: HostTarget, exists: (path: string) => boolean) => target.installs.some(exists);

/** Leaves an unchanged file alone, and never leaves a half-written one where a browser reads it. */
export function writeIfChanged(file: string, content: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false;
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, file);
  return true;
}

function register(launcher: string, options: HostOptions): string[] {
  const { platform, targets, exists, registry } = machine(options);
  const origins = allowedOrigins(platform);
  const chosen = targets.filter((target) => target.baseline || installedTarget(target, exists));
  const done = new Map<string, boolean>();
  const write = (location: string, family: Family, put: (manifest: string) => void) => {
    if (done.has(location)) return done.get(location)!;
    try {
      put(`${JSON.stringify(hostManifest(family, launcher, origins), null, 2)}\n`);
      done.set(location, true);
    } catch (error) {
      log(`native host: could not register at ${location}: ${String(error)}`);
      done.set(location, false);
    }
    return done.get(location)!;
  };
  for (const target of chosen) {
    if (target.registryKey) {
      write(target.registryKey, target.family, (manifest) => {
        const file = join(nativeHostDir, `${target.family}.json`);
        writeIfChanged(file, manifest);
        registry.set(target.registryKey!, file);
      });
    }
    for (const dir of target.manifestDirs ?? []) {
      write(dir, target.family, (manifest) => {
        mkdirSync(dir, { recursive: true });
        writeIfChanged(join(dir, `${NATIVE_HOST_NAME}.json`), manifest);
      });
    }
  }
  const reached = (target: HostTarget) => [target.registryKey, ...(target.manifestDirs ?? [])].some((location) => !!location && done.get(location));
  return chosen.filter((target) => installedTarget(target, exists) && reached(target)).map((target) => target.browser);
}

const SKIPPED = 'this Bridge keeps its state outside your home folder, so it leaves your browsers registered with the one that does not';

const daemonMainBeside = (cliPath: string) => join(dirname(cliPath), 'daemon-main.js');

export function installNativeHost(cliPath: string, options: HostOptions = {}): HostInstall {
  const { platform = process.platform, tasks = windowsTasks } = options;
  const launcher = launcherPath(platform);
  if (!registersHosts(options)) return { launcher, browsers: [], skipped: SKIPPED };
  mkdirSync(nativeHostDir, { recursive: true, mode: 0o700 });
  writeLauncher({ cliPath, nodePath: process.execPath, pathEnv: process.env.PATH ?? '' }, platform);
  if (platform === 'win32') registerBridgeTask(process.execPath, daemonMainBeside(cliPath), tasks);
  return { launcher, browsers: register(launcher, options) };
}

function writeLauncher(pins: LauncherPins, platform: NodeJS.Platform): void {
  const launcher = launcherPath(platform);
  if (writeIfChanged(launcher, launcherScript({ ...pins, platform })) && platform !== 'win32') chmodSync(launcher, 0o755);
}

export interface Refresh extends HostOptions {
  /** The CLI this Bridge runs from, to repin a launcher whose own CLI or Node has gone. */
  cliPath?: string;
  nodePath?: string;
}

/**
 * Re-registers with what is installed now, letting in whatever has paired since. A launcher whose
 * Node or CLI has gone (a Node upgrade, a moved payload) is repinned to the ones this Bridge runs on.
 */
export function refreshNativeHost(options: Refresh = {}): void {
  const { platform = process.platform, cliPath, nodePath = process.execPath, exists = existsSync, tasks = windowsTasks } = options;
  const launcher = launcherPath(platform);
  if (!existsSync(launcher) || !registersHosts(options)) return;
  const pinned = launcherPins(readFileSync(launcher, 'utf8'), platform);
  const healed = pinned && {
    pathEnv: pinned.pathEnv,
    cliPath: exists(pinned.cliPath) || !cliPath || !exists(cliPath) ? pinned.cliPath : cliPath,
    nodePath: exists(pinned.nodePath) || !exists(nodePath) ? pinned.nodePath : nodePath,
  };
  try {
    if (healed) writeLauncher(healed, platform);
  } catch (error) {
    log(`native host: could not rewrite the launcher: ${String(error)}`);
  }
  const repinned = !!healed && (healed.cliPath !== pinned.cliPath || healed.nodePath !== pinned.nodePath);
  if (repinned) log(`native host: repinned the launcher to ${healed.nodePath} ${healed.cliPath}`);
  if (platform === 'win32' && healed && (repinned || !tasks.exists())) registerBridgeTask(healed.nodePath, daemonMainBeside(healed.cliPath), tasks);
  register(launcher, options);
}

export function removeNativeHost(options: HostOptions = {}): string[] {
  if (!registersHosts(options)) return [];
  const { platform, targets, registry } = machine(options);
  const removed: string[] = [];
  if (platform === 'win32' && removeBridgeTask(options.tasks)) removed.push(`the ${BRIDGE_TASK} task`);
  if (platform === 'win32') {
    const keys = new Set([...targets.map((target) => target.registryKey!), ...RETIRED_WINDOWS_VENDORS.map(windowsKey)]);
    for (const key of keys) {
      try {
        registry.remove(key);
        removed.push(key);
      } catch {
        continue;
      }
    }
  }
  for (const dir of new Set(targets.flatMap((target) => target.manifestDirs ?? []))) {
    const manifest = join(dir, `${NATIVE_HOST_NAME}.json`);
    if (!existsSync(manifest)) continue;
    try {
      rmSync(manifest, { force: true });
      removed.push(manifest);
    } catch {
      continue;
    }
  }
  if (existsSync(nativeHostDir)) {
    rmSync(nativeHostDir, { recursive: true, force: true });
    removed.push(nativeHostDir);
  }
  return removed;
}

/** The installed browsers that can start the Bridge, read back from where each one looks. */
export function registeredBrowsers(options: HostOptions = {}): string[] {
  const { platform, targets, exists, registry } = machine(options);
  if (!existsSync(launcherPath(platform))) return [];
  const keys = new Map<string, boolean>();
  const hasKey = (key: string) => {
    if (!keys.has(key)) keys.set(key, registry.has(key));
    return keys.get(key)!;
  };
  return targets
    .filter((target) => installedTarget(target, exists))
    .filter((target) =>
      target.registryKey
        ? hasKey(target.registryKey)
        : (target.manifestDirs ?? []).some((dir) => existsSync(join(dir, `${NATIVE_HOST_NAME}.json`))),
    )
    .map((target) => target.browser);
}

/** Whether every manifest this Bridge wrote still lets in both store copies; one an older Bridge wrote may not. */
export function registrationCurrent(options: HostOptions = {}): boolean {
  const { platform, targets } = machine(options);
  const files =
    platform === 'win32'
      ? (['chromium'] as const).map((family) => join(nativeHostDir, `${family}.json`))
      : targets.filter((target) => target.family === 'chromium').flatMap((target) => (target.manifestDirs ?? []).map((dir) => join(dir, `${NATIVE_HOST_NAME}.json`)));
  return files.filter(existsSync).every((file) => {
    try {
      const origins = (JSON.parse(readFileSync(file, 'utf8')) as { allowed_origins?: string[] }).allowed_origins ?? [];
      return STORE_EXTENSION_IDS.every((id) => origins.includes(`chrome-extension://${id}/`));
    } catch {
      return false;
    }
  });
}
