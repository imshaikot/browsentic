import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  NATIVE_HOST_NAME,
  decodeNativeMessage,
  encodeNativeMessage,
  hostManifest,
  hostTargets,
  installNativeHost,
  launcherScript,
  nativeHostDir,
  registeredBrowsers,
  removeNativeHost,
  unpackedExtensionOrigin,
} from './native-host';
import { extensionDir } from './paths';

describe('unpackedExtensionOrigin', () => {
  it('names the folder the way Chrome does', () => {
    expect(unpackedExtensionOrigin('/Users/shahriar/browsentic/extension/chrome-mv3')).toBe(
      'chrome-extension://pplbfkdfiimmogofmehpibbmldcefgpc/',
    );
  });
});

describe('hostTargets', () => {
  it('points each browser at its own manifest folder, or its registry key on Windows', () => {
    const mac = hostTargets('darwin', '/Users/me').find((target) => target.browser === 'Edge');
    expect(mac?.manifestDir).toBe('/Users/me/Library/Application Support/Microsoft Edge/NativeMessagingHosts');
    const linux = hostTargets('linux', '/home/me').find((target) => target.browser === 'Firefox');
    expect(linux).toMatchObject({ family: 'firefox', manifestDir: '/home/me/.mozilla/native-messaging-hosts' });
    const windows = hostTargets('win32').find((target) => target.browser === 'Chrome');
    expect(windows?.registryKey).toBe(`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`);
  });
});

describe('hostManifest', () => {
  it('lets Chromium in by origin and Firefox by add-on id', () => {
    expect(hostManifest('chromium', '/x/launcher', ['chrome-extension://abc/'])).toMatchObject({
      name: NATIVE_HOST_NAME,
      type: 'stdio',
      path: '/x/launcher',
      allowed_origins: ['chrome-extension://abc/'],
    });
    expect(hostManifest('firefox', '/x/launcher', [])).toMatchObject({ allowed_extensions: ['browsentic@browsentic.com'] });
  });
});

describe('launcherScript', () => {
  it('pins node, the CLI and PATH, and falls back to npx once the CLI moves', () => {
    const script = launcherScript({
      platform: 'darwin',
      cliPath: "/Users/o'neil/cli.js",
      nodePath: '/opt/node/bin/node',
      pathEnv: '/opt/node/bin:/usr/bin',
    });
    expect(script.split('\n')).toEqual([
      '#!/bin/sh',
      "PATH='/opt/node/bin:/usr/bin'",
      'export PATH',
      "NODE='/opt/node/bin/node'",
      '[ -x "$NODE" ] || NODE=node',
      "CLI='/Users/o'\\''neil/cli.js'",
      'if [ -f "$CLI" ]; then exec "$NODE" "$CLI" native-host "$@"; fi',
      'exec npx --yes browsentic native-host "$@"',
      '',
    ]);
  });

  it('writes a batch file on Windows', () => {
    const script = launcherScript({ platform: 'win32', cliPath: 'C:\\b\\cli.js', nodePath: 'C:\\node.exe', pathEnv: 'C:\\bin' });
    expect(script).toContain('"C:\\node.exe" "C:\\b\\cli.js" native-host %*');
    expect(script).toContain('call npx --yes browsentic native-host %*');
  });
});

describe('the message frame', () => {
  it('round-trips a message and waits for a whole one', () => {
    const frame = encodeNativeMessage({ op: 'ensure' });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    expect(decodeNativeMessage(frame)).toEqual({ op: 'ensure' });
    expect(decodeNativeMessage(frame.subarray(0, frame.length - 1))).toBeUndefined();
  });
});

describe('registering the host', () => {
  const chromeHome = join(homedir(), '.config', 'google-chrome');
  const manifest = join(chromeHome, 'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`);

  beforeEach(() => {
    removeNativeHost('linux');
    rmSync(chromeHome, { recursive: true, force: true });
    mkdirSync(chromeHome, { recursive: true });
  });

  it('registers with the browsers that are installed, letting in the unpacked extension', () => {
    const installed = installNativeHost('/opt/browsentic/dist/cli.js', 'linux');

    expect(installed.browsers).toEqual(['Chrome']);
    expect(statSync(installed.launcher).mode & 0o777).toBe(0o755);
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toMatchObject({
      path: installed.launcher,
      allowed_origins: [unpackedExtensionOrigin(extensionDir())],
    });
    expect(registeredBrowsers('linux')).toEqual(['Chrome']);
  });

  it('removes every trace on uninstall', () => {
    installNativeHost('/opt/browsentic/dist/cli.js', 'linux');

    removeNativeHost('linux');

    expect(existsSync(manifest)).toBe(false);
    expect(existsSync(nativeHostDir)).toBe(false);
    expect(registeredBrowsers('linux')).toEqual([]);
  });
});
