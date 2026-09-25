/**
 * Lets the browser start the daemon. Chrome, Edge, Brave and Firefox each launch a program
 * registered as a native messaging host when the extension asks for it; ours only makes sure
 * a daemon is running and exits. The registration lists the exact extension origins allowed
 * to launch it, recomputed on every setup and every pairing.
 */

import { execFileSync } from 'node:child_process';
import { NATIVE_HOST_NAME } from '@/lib/actions/protocol';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { listSessions } from './auth-store';
import { readAgentConfig } from './agent/config';
import { stateDir } from './lockfile';
import { log } from './log';
import { extensionDir } from './paths';

export { NATIVE_HOST_NAME };
export const FIREFOX_ADDON_ID = 'browsentic@browsentic.com';

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

const WINDOWS_BROWSERS: [string, Family, string][] = [
  ['Chrome', 'chromium', 'Google\\Chrome'],
  ['Chromium', 'chromium', 'Chromium'],
  ['Edge', 'chromium', 'Microsoft\\Edge'],
  ['Brave', 'chromium', 'BraveSoftware\\Brave-Browser'],
  ['Firefox', 'firefox', 'Mozilla'],
];

export function hostTargets(platform: NodeJS.Platform = process.platform, home = homedir()): HostTarget[] {
  if (platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support');
    return MAC_BROWSERS.map(([browser, family, dir]) => ({
      browser,
      family,
      home: join(support, dir),
      manifestDir: join(support, dir, 'NativeMessagingHosts'),
    }));
  }
  if (platform === 'win32') {
    return WINDOWS_BROWSERS.map(([browser, family, vendor]) => ({
      browser,
      family,
      home: '',
      registryKey: `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    }));
  }
  return LINUX_BROWSERS.map(([browser, family, dir, manifests]) => ({
    browser,
    family,
    home: join(home, dir),
    manifestDir: join(home, manifests),
  }));
}

/** Chrome names an unpacked extension after its folder: the SHA-256 of the path, spelled in a–p. */
export function unpackedExtensionOrigin(dir: string): string {
  const hex = createHash('sha256').update(dir).digest('hex').slice(0, 32);
  const id = [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('');
  return `chrome-extension://${id}/`;
}

const asOrigin = (origin: string) => (origin.endsWith('/') ? origin : `${origin}/`);

export function allowedOrigins(platform: NodeJS.Platform = process.platform): string[] {
  const paired = listSessions()
    .map((session) => session.origin)
    .filter((origin) => origin.startsWith('chrome-extension://'));
  const unpacked = platform === 'win32' ? [] : [unpackedExtensionOrigin(extensionDir(readAgentConfig().extensionDir))];
  return [...new Set([...unpacked, ...paired].map(asOrigin))].sort();
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
    return [
      '@echo off',
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

function register(targets: HostTarget[], launcher: string, origins: readonly string[]): string[] {
  const registered: string[] = [];
  for (const target of targets) {
    const manifest = `${JSON.stringify(hostManifest(target.family, launcher, origins), null, 2)}\n`;
    try {
      if (target.registryKey) {
        const file = join(nativeHostDir, `${target.family}.json`);
        writeFileSync(file, manifest);
        execFileSync('reg', ['add', target.registryKey, '/ve', '/t', 'REG_SZ', '/d', file, '/f'], { stdio: 'ignore' });
      } else if (target.manifestDir && existsSync(target.home)) {
        mkdirSync(target.manifestDir, { recursive: true });
        writeFileSync(join(target.manifestDir, `${NATIVE_HOST_NAME}.json`), manifest);
      } else continue;
      registered.push(target.browser);
    } catch (error) {
      log(`native host: could not register for ${target.browser}: ${String(error)}`);
    }
  }
  return registered;
}

export function installNativeHost(cliPath: string, platform: NodeJS.Platform = process.platform): HostInstall {
  const launcher = launcherPath(platform);
  mkdirSync(nativeHostDir, { recursive: true, mode: 0o700 });
  writeFileSync(launcher, launcherScript({ platform, cliPath, nodePath: process.execPath, pathEnv: process.env.PATH ?? '' }));
  if (platform !== 'win32') chmodSync(launcher, 0o755);
  return { launcher, browsers: register(hostTargets(platform), launcher, allowedOrigins(platform)) };
}

/** A newly paired browser has to be let in; the launcher stays as setup wrote it. */
export function refreshNativeHost(platform: NodeJS.Platform = process.platform): void {
  const launcher = launcherPath(platform);
  if (!existsSync(launcher)) return;
  register(hostTargets(platform), launcher, allowedOrigins(platform));
}

export function removeNativeHost(platform: NodeJS.Platform = process.platform): string[] {
  const removed: string[] = [];
  for (const target of hostTargets(platform)) {
    try {
      if (target.registryKey) {
        execFileSync('reg', ['delete', target.registryKey, '/f'], { stdio: 'ignore' });
        removed.push(target.registryKey);
        continue;
      }
      const manifest = join(target.manifestDir!, `${NATIVE_HOST_NAME}.json`);
      if (!existsSync(manifest)) continue;
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

export function registeredBrowsers(platform: NodeJS.Platform = process.platform): string[] {
  if (!existsSync(launcherPath(platform))) return [];
  return hostTargets(platform)
    .filter((target) =>
      target.registryKey
        ? existsSync(join(nativeHostDir, `${target.family}.json`))
        : existsSync(join(target.manifestDir!, `${NATIVE_HOST_NAME}.json`)),
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

export async function serveNativeHost(ensure: () => Promise<{ port: number }>): Promise<void> {
  const message = (await readNativeMessage(process.stdin)) as { op?: unknown } | null;
  const reply =
    message?.op === 'ensure'
      ? await ensure()
          .then((lock) => ({ ok: true, port: lock.port }))
          .catch((error) => ({ ok: false, error: String(error) }))
      : { ok: false, error: 'Expected {"op":"ensure"}.' };
  log(`native host: ${reply.ok ? 'daemon ready' : `could not start the daemon — ${'error' in reply ? reply.error : ''}`}`);
  await new Promise<void>((resolve) => process.stdout.write(encodeNativeMessage(reply), () => resolve()));
}

