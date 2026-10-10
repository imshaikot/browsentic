import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_HOST_NAME,
  STOPPED_REPLY,
  allowedOrigins,
  answerNativeMessage,
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
  type Registry,
} from './native-host';
import { extensionDir } from './paths';
import { bits, modeOf } from './test/modes';

describe('unpackedExtensionOrigin', () => {
  it('names the folder the way Chrome does', () => {
    expect(unpackedExtensionOrigin('/Users/shahriar/browsentic/extension/chrome-mv3', 'darwin')).toBe(
      'chrome-extension://pplbfkdfiimmogofmehpibbmldcefgpc/',
    );
  });

  it('hashes a Windows path as UTF-16, whichever case the drive letter was typed in', () => {
    const upper = unpackedExtensionOrigin('C:\\Users\\me\\browsentic\\extension\\chrome-mv3', 'win32');

    expect(unpackedExtensionOrigin('c:\\Users\\me\\browsentic\\extension\\chrome-mv3', 'win32')).toBe(upper);
    expect(unpackedExtensionOrigin('C:\\Users\\me\\browsentic\\extension\\chrome-mv3', 'linux')).not.toBe(upper);
    expect(unpackedExtensionOrigin('C:\\Users\\Me\\browsentic\\extension\\chrome-mv3', 'win32')).not.toBe(upper);
  });
});

describe('allowedOrigins', () => {
  it('lets the unpacked extension start the daemon before it has ever paired, on Windows too', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(allowedOrigins(platform)).toContain(unpackedExtensionOrigin(extensionDir(), platform));
    }
  });

  it('lets both store copies start the daemon before they have ever paired', () => {
    expect(allowedOrigins('darwin')).toEqual(
      expect.arrayContaining([
        'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/',
        'chrome-extension://cbkjhkgjcpihokphhdkbahilpcjojpdc/',
      ]),
    );
  });
});

describe('hostTargets', () => {
  it('points each browser at its own manifest folder, or its registry key on Windows', () => {
    const mac = hostTargets('darwin', '/Users/me').find((target) => target.browser === 'Edge');
    expect(mac?.manifestDir).toBe('/Users/me/Library/Application Support/Microsoft Edge/NativeMessagingHosts');
    const linux = hostTargets('linux', '/home/me').find((target) => target.browser === 'Firefox');
    expect(linux).toMatchObject({ family: 'firefox', manifestDir: '/home/me/.mozilla/native-messaging-hosts' });
    const windows = hostTargets('win32', 'C:\\Users\\me', {}).find((target) => target.browser === 'Chrome');
    expect(windows).toMatchObject({
      home: 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data',
      registryKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    });
  });

  it('lets Brave and Vivaldi in through the key Chrome reads, which every Chromium build falls back to', () => {
    const keys = Object.fromEntries(hostTargets('win32', 'C:\\Users\\me', {}).map((target) => [target.browser, target.registryKey]));
    expect(keys.Brave).toBe(keys.Chrome);
    expect(keys.Vivaldi).toBe(keys.Chrome);
    expect(keys.Edge).toBe(`HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`);
  });

  it('looks for Windows profiles where AppData really is', () => {
    const env = { LOCALAPPDATA: 'D:\\Local', APPDATA: 'D:\\Roaming' };
    const homes = Object.fromEntries(hostTargets('win32', 'C:\\Users\\me', env).map((target) => [target.browser, target.home]));
    expect(homes.Edge).toBe('D:\\Local\\Microsoft\\Edge\\User Data');
    expect(homes.Firefox).toBe('D:\\Roaming\\Mozilla\\Firefox');
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

  it('switches cmd.exe to UTF-8 before the first path, so a name like José survives', () => {
    const lines = launcherScript({ platform: 'win32', cliPath: 'C:\\Users\\José\\cli.js', nodePath: 'C:\\node.exe', pathEnv: 'C:\\bin' }).split('\r\n');
    expect(lines.slice(0, 2)).toEqual(['@echo off', 'chcp 65001 >nul']);
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

describe('answering the browser', () => {
  const ensure = vi.fn(async () => ({ port: 8765 }));

  beforeEach(() => ensure.mockClear());

  it('starts the daemon when asked', async () => {
    expect(await answerNativeMessage({ op: 'ensure' }, ensure, () => false)).toEqual({ ok: true, port: 8765 });
    expect(ensure).toHaveBeenCalledOnce();
  });

  it('leaves a daemon stopped on purpose down', async () => {
    expect(await answerNativeMessage({ op: 'ensure' }, ensure, () => true)).toBe(STOPPED_REPLY);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('refuses anything but ensure', async () => {
    expect(await answerNativeMessage({ op: 'spawn' }, ensure, () => false)).toMatchObject({ ok: false });
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe('registering the host', () => {
  const linux = { platform: 'linux' } as const;
  const chromeHome = join(homedir(), '.config', 'google-chrome');
  const manifest = join(chromeHome, 'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`);

  beforeEach(() => {
    removeNativeHost(linux);
    rmSync(chromeHome, { recursive: true, force: true });
    mkdirSync(chromeHome, { recursive: true });
  });

  it('registers with the browsers that are installed, letting in both store copies and the unpacked one', () => {
    const installed = installNativeHost('/opt/browsentic/dist/cli.js', linux);

    expect(installed.browsers).toEqual(['Chrome']);
    expect(modeOf(installed.launcher)).toBe(bits(0o755));
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toMatchObject({
      path: installed.launcher,
      allowed_origins: [
        'chrome-extension://cbkjhkgjcpihokphhdkbahilpcjojpdc/',
        unpackedExtensionOrigin(extensionDir(), 'linux'),
        'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/',
      ].sort(),
    });
    expect(registeredBrowsers(linux)).toEqual(['Chrome']);
  });

  it('removes every trace on uninstall', () => {
    installNativeHost('/opt/browsentic/dist/cli.js', linux);

    removeNativeHost(linux);

    expect(existsSync(manifest)).toBe(false);
    expect(existsSync(nativeHostDir)).toBe(false);
    expect(registeredBrowsers(linux)).toEqual([]);
  });
});

describe('registering the host on Windows', () => {
  const home = 'C:\\Users\\me';
  const profile = (dir: string) => `C:\\Users\\me\\AppData\\Local\\${dir}\\User Data`;
  const key = (vendor: string) => `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
  let keys: Map<string, string>;
  const registry: Registry = {
    set: (path, value) => void keys.set(path, value),
    has: (path) => keys.has(path),
    remove: (path) => {
      if (!keys.delete(path)) throw new Error(`no key ${path}`);
    },
  };
  const windows = (installed: string[]) => ({ platform: 'win32', home, env: {}, registry, exists: (path: string) => installed.includes(path) }) as const;

  beforeEach(() => {
    keys = new Map();
    removeNativeHost(windows([]));
  });

  it('registers only with the browsers that are installed, as macOS and Linux do', () => {
    const machine = windows([profile('Microsoft\\Edge'), profile('BraveSoftware\\Brave-Browser')]);

    const installed = installNativeHost('C:\\b\\dist\\cli.js', machine);

    expect(installed.browsers).toEqual(['Edge', 'Brave']);
    expect([...keys.keys()].sort()).toEqual([key('Google\\Chrome'), key('Microsoft\\Edge')]);
    expect(JSON.parse(readFileSync(keys.get(key('Google\\Chrome'))!, 'utf8'))).toMatchObject({ path: installed.launcher });
    expect(registeredBrowsers(machine)).toEqual(['Edge', 'Brave']);
  });

  it('says a browser installed since setup cannot start the daemon yet', () => {
    installNativeHost('C:\\b\\dist\\cli.js', windows([profile('Microsoft\\Edge')]));

    expect(registeredBrowsers(windows([profile('Microsoft\\Edge'), profile('Google\\Chrome')]))).toEqual(['Edge']);
  });

  it('removes every key on uninstall, the one written for Brave before it was known to read Chrome’s too', () => {
    installNativeHost('C:\\b\\dist\\cli.js', windows([profile('Google\\Chrome')]));
    keys.set(key('BraveSoftware\\Brave-Browser'), 'old');

    const removed = removeNativeHost(windows([]));

    expect(keys.size).toBe(0);
    expect(removed).toEqual(expect.arrayContaining([key('Google\\Chrome'), key('BraveSoftware\\Brave-Browser'), nativeHostDir]));
    expect(registeredBrowsers(windows([profile('Google\\Chrome')]))).toEqual([]);
  });
});
