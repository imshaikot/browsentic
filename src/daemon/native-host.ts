/**
 * Lets the browser start the daemon. Chrome, Edge, Brave and Firefox each launch a program
 * registered as a native messaging host when the extension asks for it; ours only makes sure
 * a daemon is running and exits. The registration lists the exact extension origins allowed
 * to launch it: both store listings always, plus the unpacked folder and whatever has paired,
 * recomputed on every setup and every pairing.
 */

import { execFileSync } from 'node:child_process';
import { NATIVE_HOST_NAME } from '@/lib/actions/protocol';
import { FIREFOX_ADDON_ID, STORE_EXTENSION_IDS } from '@/lib/stores';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { listSessions } from './auth-store';
import { readAgentConfig } from './agent/config';
import { stateDir } from './lockfile';
import { log } from './log';
import { extensionDir } from './paths';

export { NATIVE_HOST_NAME };

type Family = 'chromium' | 'firefox';

export interface HostTarget {
  browser: string;
  family: Family;
  /** Where the browser keeps its profile; the host is only registered where the browser is installed. */
  home: string;
  /** macOS and Linux read the manifest from this directory. */
  manifestDir?: string;
  /** Windows reads the manifest path from this registry key. */
  registryKey?: string;
}

const MAC_BROWSERS: [string, Family, string][] = [
  ['Chrome', 'chromium', 'Google/Chrome'],
  ['Chrome for Testing', 'chromium', 'Google/Chrome for Testing'],
  ['Chromium', 'chromium', 'Chromium'],
  ['Edge', 'chromium', 'Microsoft Edge'],
  ['Brave', 'chromium', 'BraveSoftware/Brave-Browser'],
  ['Vivaldi', 'chromium', 'Vivaldi'],
  ['Arc', 'chromium', 'Arc/User Data'],
  ['Firefox', 'firefox', 'Mozilla'],
];

const LINUX_BROWSERS: [string, Family, string, string][] = [
  ['Chrome', 'chromium', '.config/google-chrome', '.config/google-chrome/NativeMessagingHosts'],
  ['Chromium', 'chromium', '.config/chromium', '.config/chromium/NativeMessagingHosts'],
  ['Edge', 'chromium', '.config/microsoft-edge', '.config/microsoft-edge/NativeMessagingHosts'],
  ['Brave', 'chromium', '.config/BraveSoftware/Brave-Browser', '.config/BraveSoftware/Brave-Browser/NativeMessagingHosts'],
  ['Vivaldi', 'chromium', '.config/vivaldi', '.config/vivaldi/NativeMessagingHosts'],
  ['Firefox', 'firefox', '.mozilla', '.mozilla/native-messaging-hosts'],
];

/**
 * Every Chromium build falls back to Chrome's key, and only Chromium's own reads another first
 * (launch_context_win.cc), so Brave, Vivaldi and Chrome for Testing are let in through Chrome's.
 */
const WINDOWS_BROWSERS: [string, Family, string, 'LOCALAPPDATA' | 'APPDATA', string][] = [
  ['Chrome', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'Google\\Chrome\\User Data'],
  ['Chrome for Testing', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'Google\\Chrome for Testing\\User Data'],
  ['Chromium', 'chromium', 'Chromium', 'LOCALAPPDATA', 'Chromium\\User Data'],
  ['Edge', 'chromium', 'Microsoft\\Edge', 'LOCALAPPDATA', 'Microsoft\\Edge\\User Data'],
  ['Brave', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'BraveSoftware\\Brave-Browser\\User Data'],
  ['Vivaldi', 'chromium', 'Google\\Chrome', 'LOCALAPPDATA', 'Vivaldi\\User Data'],
  ['Firefox', 'firefox', 'Mozilla', 'APPDATA', 'Mozilla\\Firefox'],
];

/** Written for Brave up to 0.8.1, which never read it; an uninstall still takes it away. */
const RETIRED_WINDOWS_VENDORS = ['BraveSoftware\\Brave-Browser'];

const windowsKey = (vendor: string) => `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;

export function hostTargets(platform: NodeJS.Platform = process.platform, home = homedir(), env = process.env): HostTarget[] {
  if (platform === 'darwin') {
    const support = posix.join(home, 'Library', 'Application Support');
    return MAC_BROWSERS.map(([browser, family, dir]) => ({
      browser,
      family,
      home: posix.join(support, dir),
      manifestDir: posix.join(support, dir, 'NativeMessagingHosts'),
    }));
  }
  if (platform === 'win32') {
    const roots = {
      LOCALAPPDATA: env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'),
      APPDATA: env.APPDATA ?? win32.join(home, 'AppData', 'Roaming'),
    };
    return WINDOWS_BROWSERS.map(([browser, family, vendor, root, profile]) => ({
      browser,
      family,
      home: win32.join(roots[root], profile),
      registryKey: windowsKey(vendor),
    }));
  }
  return LINUX_BROWSERS.map(([browser, family, dir, manifests]) => ({
    browser,
    family,
    home: posix.join(home, dir),
    manifestDir: posix.join(home, manifests),
  }));
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
    description: 'Starts the Browsentic daemon when the browser needs it',
    path: launcher,
    type: 'stdio',
    ...(family === 'firefox' ? { allowed_extensions: [FIREFOX_ADDON_ID] } : { allowed_origins: origins }),
  };
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export function launcherScript(options: {
  platform: NodeJS.Platform;
  cliPath: string;
  nodePath: string;
  pathEnv: string;
}): string {
  const { platform, cliPath, nodePath, pathEnv } = options;
  if (platform === 'win32') {
    // cmd.exe reads each line in the console's code page, which mangles a UTF-8 path like C:\Users\José.
    return [
      '@echo off',
      'chcp 65001 >nul',
      `set "PATH=${pathEnv}"`,
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
    'export PATH',
    `NODE=${shellQuote(nodePath)}`,
    '[ -x "$NODE" ] || NODE=node',
    `CLI=${shellQuote(cliPath)}`,
    'if [ -f "$CLI" ]; then exec "$NODE" "$CLI" native-host "$@"; fi',
    'exec npx --yes browsentic native-host "$@"',
    '',
  ].join('\n');
}

export const nativeHostDir = join(stateDir, 'native-host');
export const launcherPath = (platform: NodeJS.Platform = process.platform) =>
  join(nativeHostDir, platform === 'win32' ? 'browsentic-native-host.cmd' : 'browsentic-native-host');

export interface HostInstall {
  launcher: string;
  browsers: string[];
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
  /** Whether a browser's profile is there. */
  exists?: (path: string) => boolean;
  registry?: Registry;
}

const machine = ({
  platform = process.platform,
  home = homedir(),
  env = process.env,
  exists = existsSync,
  registry = windowsRegistry,
}: HostOptions) => ({ platform, targets: hostTargets(platform, home, env), exists, registry });

function register(launcher: string, options: HostOptions): string[] {
  const { platform, targets, exists, registry } = machine(options);
  const origins = allowedOrigins(platform);
  const registered: string[] = [];
  const written = new Set<string>();
  for (const target of targets.filter((candidate) => exists(candidate.home))) {
    const manifest = `${JSON.stringify(hostManifest(target.family, launcher, origins), null, 2)}\n`;
    try {
      if (target.registryKey && !written.has(target.registryKey)) {
        const file = join(nativeHostDir, `${target.family}.json`);
        writeFileSync(file, manifest);
        registry.set(target.registryKey, file);
        written.add(target.registryKey);
      } else if (target.manifestDir) {
        mkdirSync(target.manifestDir, { recursive: true });
        writeFileSync(join(target.manifestDir, `${NATIVE_HOST_NAME}.json`), manifest);
      }
      registered.push(target.browser);
    } catch (error) {
      log(`native host: could not register for ${target.browser}: ${String(error)}`);
    }
  }
  return registered;
}

export function installNativeHost(cliPath: string, options: HostOptions = {}): HostInstall {
  const { platform = process.platform } = options;
  const launcher = launcherPath(platform);
  mkdirSync(nativeHostDir, { recursive: true, mode: 0o700 });
  writeFileSync(launcher, launcherScript({ platform, cliPath, nodePath: process.execPath, pathEnv: process.env.PATH ?? '' }));
  if (platform !== 'win32') chmodSync(launcher, 0o755);
  return { launcher, browsers: register(launcher, options) };
}

/** A newly paired browser has to be let in; the launcher stays as setup wrote it. */
export function refreshNativeHost(options: HostOptions = {}): void {
  const launcher = launcherPath(options.platform);
  if (!existsSync(launcher)) return;
  register(launcher, options);
}

export function removeNativeHost(options: HostOptions = {}): string[] {
  const { platform, targets, registry } = machine(options);
  const removed: string[] = [];
  if (platform === 'win32') {
    for (const key of new Set([...targets.map((target) => target.registryKey!), ...RETIRED_WINDOWS_VENDORS.map(windowsKey)])) {
      try {
        registry.remove(key);
        removed.push(key);
      } catch {
        continue;
      }
    }
  }
  for (const target of targets.filter((candidate) => candidate.manifestDir)) {
    const manifest = join(target.manifestDir!, `${NATIVE_HOST_NAME}.json`);
    if (!existsSync(manifest)) continue;
    rmSync(manifest, { force: true });
    removed.push(manifest);
  }
  if (existsSync(nativeHostDir)) {
    rmSync(nativeHostDir, { recursive: true, force: true });
    removed.push(nativeHostDir);
  }
  return removed;
}

/** The installed browsers that can start the daemon, read back from where each one looks. */
export function registeredBrowsers(options: HostOptions = {}): string[] {
  const { platform, targets, exists, registry } = machine(options);
  if (!existsSync(launcherPath(platform))) return [];
  const keys = new Map<string, boolean>();
  const hasKey = (key: string) => {
    if (!keys.has(key)) keys.set(key, registry.has(key));
    return keys.get(key)!;
  };
  return targets
    .filter((target) => exists(target.home))
    .filter((target) =>
      target.registryKey ? hasKey(target.registryKey) : existsSync(join(target.manifestDir!, `${NATIVE_HOST_NAME}.json`)),
    )
    .map((target) => target.browser);
}

export function encodeNativeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

export function decodeNativeMessage(buffer: Buffer): unknown | undefined {
  if (buffer.length < 4) return undefined;
  const length = buffer.readUInt32LE(0);
  if (buffer.length < 4 + length) return undefined;
  try {
    return JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
  } catch {
    return null;
  }
}

function readNativeMessage(input: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve) => {
    let held = Buffer.alloc(0);
    const done = (value: unknown) => {
      input.removeAllListeners('data');
      resolve(value);
    };
    input.on('data', (chunk: Buffer) => {
      held = Buffer.concat([held, chunk]);
      const message = decodeNativeMessage(held);
      if (message !== undefined) done(message);
    });
    input.on('end', () => done(null));
  });
}

export const STOPPED_REPLY = { ok: false, error: 'Stopped with "browsentic stop"; "browsentic start" lets the browser start it again.' };

export async function serveNativeHost(ensure: () => Promise<{ port: number }>, held: () => boolean): Promise<void> {
  const message = (await readNativeMessage(process.stdin)) as { op?: unknown } | null;
  const reply = await answerNativeMessage(message, ensure, held);
  if (reply !== STOPPED_REPLY) {
    log(`native host: ${reply.ok ? 'daemon ready' : `could not start the daemon — ${'error' in reply ? reply.error : ''}`}`);
  }
  await new Promise<void>((resolve) => process.stdout.write(encodeNativeMessage(reply), () => resolve()));
}

export async function answerNativeMessage(
  message: { op?: unknown } | null,
  ensure: () => Promise<{ port: number }>,
  held: () => boolean,
): Promise<{ ok: boolean; port?: number; error?: string }> {
  if (message?.op !== 'ensure') return { ok: false, error: 'Expected {"op":"ensure"}.' };
  if (held()) return STOPPED_REPLY;
  return ensure()
    .then((lock) => ({ ok: true, port: lock.port }))
    .catch((error) => ({ ok: false, error: String(error) }));
}

