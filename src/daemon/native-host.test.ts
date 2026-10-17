import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  NATIVE_HOST_NAME,
  allowedOrigins,
  hostManifest,
  hostTargets,
  installNativeHost,
  launcherPath,
  launcherPins,
  launcherScript,
  nativeHostDir,
  refreshNativeHost,
  registeredBrowsers,
  registersHosts,
  registrationCurrent,
  removeNativeHost,
  unpackedExtensionOrigin,
  writeIfChanged,
  type Registry,
} from './native-host';
import { extensionDir } from './paths';
import { bits, modeOf } from './test/modes';
import type { TaskScheduler } from './windows-task';

const STORE_ORIGINS = ['chrome-extension://cbkjhkgjcpihokphhdkbahilpcjojpdc/', 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/'];

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
    expect(allowedOrigins('darwin')).toEqual(expect.arrayContaining(STORE_ORIGINS));
  });
});

describe('hostTargets', () => {
  const mac = (browser: string) => hostTargets('darwin', '/Users/me').find((target) => target.browser === browser);
  const support = '/Users/me/Library/Application Support';

  it('points each browser at the folders it reads, or its registry key on Windows', () => {
    expect(mac('Edge')?.manifestDirs).toEqual([`${support}/Microsoft Edge/NativeMessagingHosts`]);
    const linux = hostTargets('linux', '/home/me').find((target) => target.browser === 'Firefox');
    expect(linux).toMatchObject({ family: 'firefox', manifestDirs: ['/home/me/.mozilla/native-messaging-hosts'] });
    const windows = hostTargets('win32', 'C:\\Users\\me', {}).find((target) => target.browser === 'Chrome');
    expect(windows).toMatchObject({
      installs: ['C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data'],
      registryKey: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`,
    });
  });

  it('sends Brave and Opera on macOS to Chrome’s folder, which is the one they read', () => {
    expect(mac('Brave')?.manifestDirs).toContain(`${support}/Google/Chrome/NativeMessagingHosts`);
    expect(mac('Opera')?.manifestDirs).toEqual([`${support}/Google/Chrome/NativeMessagingHosts`]);
  });

  it('finds Firefox on macOS by its own profile folder, and writes to Mozilla’s', () => {
    expect(mac('Firefox')).toMatchObject({
      family: 'firefox',
      installs: expect.arrayContaining([`${support}/Firefox/profiles.ini`, '/Applications/Firefox.app']),
      manifestDirs: [`${support}/Mozilla/NativeMessagingHosts`],
      baseline: true,
    });
  });

  it('leaves Tor Browser out on purpose', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(hostTargets(platform, '/Users/me', {}).map((target) => target.browser)).not.toContain('Tor Browser');
    }
  });

  it('adds a macOS fork no table names, at the data folder its Info.plist gives', () => {
    const forks = [
      { browser: 'Helium', app: '/Applications/Helium.app', dataDir: 'net.imput.helium' },
      { browser: 'Brave Browser', app: '/Applications/Brave Browser.app', dataDir: 'BraveSoftware/Brave-Browser' },
    ];
    const targets = hostTargets('darwin', '/Users/me', {}, forks);
    expect(targets.find((target) => target.browser === 'Helium')).toMatchObject({
      installs: ['/Applications/Helium.app'],
      manifestDirs: [`${support}/net.imput.helium/NativeMessagingHosts`],
    });
    expect(targets.filter((target) => target.browser.startsWith('Brave Browser'))).toEqual([]);
  });

  it('lets Brave, Vivaldi and Opera in on Windows through the key Chrome reads, which every Chromium build falls back to', () => {
    const keys = Object.fromEntries(hostTargets('win32', 'C:\\Users\\me', {}).map((target) => [target.browser, target.registryKey]));
    expect(keys.Brave).toBe(keys.Chrome);
    expect(keys.Vivaldi).toBe(keys.Chrome);
    expect(keys.Opera).toBe(keys.Chrome);
    expect(keys.Edge).toBe(`HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`);
    expect(keys.Zen).toBe(keys.Firefox);
  });

  it('looks for Windows profiles where AppData really is', () => {
    const env = { LOCALAPPDATA: 'D:\\Local', APPDATA: 'D:\\Roaming' };
    const homes = Object.fromEntries(hostTargets('win32', 'C:\\Users\\me', env).map((target) => [target.browser, target.installs[0]]));
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
  const pins = { cliPath: "/Users/o'neil/cli.js", nodePath: '/opt/node/bin/node', pathEnv: '/opt/node/bin:/usr/bin' };

  it('pins node, the CLI and PATH, keeps Node quiet, and falls back to npx once the CLI moves', () => {
    expect(launcherScript({ platform: 'darwin', ...pins }).split('\n')).toEqual([
      '#!/bin/sh',
      "PATH='/opt/node/bin:/usr/bin'",
      'NODE_NO_WARNINGS=1',
      'export PATH NODE_NO_WARNINGS',
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
    expect(script).toContain('set "NODE_NO_WARNINGS=1"');
    expect(script).toContain('call npx --yes browsentic native-host %*');
  });

  it('switches cmd.exe to UTF-8 before the first path, so a name like José survives', () => {
    const lines = launcherScript({ platform: 'win32', cliPath: 'C:\\Users\\José\\cli.js', nodePath: 'C:\\node.exe', pathEnv: 'C:\\bin' }).split('\r\n');
    expect(lines.slice(0, 2)).toEqual(['@echo off', 'chcp 65001 >nul']);
  });

  it('reads back what a launcher was pinned to, on both platforms', () => {
    expect(launcherPins(launcherScript({ platform: 'darwin', ...pins }), 'darwin')).toEqual(pins);
    const windows = { cliPath: 'C:\\Users\\José\\cli.js', nodePath: 'C:\\Program Files\\nodejs\\node.exe', pathEnv: 'C:\\bin;C:\\x' };
    expect(launcherPins(launcherScript({ platform: 'win32', ...windows }), 'win32')).toEqual(windows);
  });

  it('reads a launcher an older Bridge wrote, before Node was kept quiet', () => {
    const old = ['#!/bin/sh', "PATH='/usr/bin'", 'export PATH', "NODE='/old/node'", '[ -x "$NODE" ] || NODE=node', "CLI='/old/cli.js'", ''].join('\n');
    expect(launcherPins(old, 'darwin')).toEqual({ pathEnv: '/usr/bin', nodePath: '/old/node', cliPath: '/old/cli.js' });
  });
});

describe('writeIfChanged', () => {
  const file = join(homedir(), 'write-if-changed.json');

  it('writes a new file, leaves an identical one alone, and replaces a different one whole', () => {
    rmSync(file, { force: true });
    expect(writeIfChanged(file, 'a')).toBe(true);
    expect(writeIfChanged(file, 'a')).toBe(false);
    expect(writeIfChanged(file, 'b')).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('b');
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });
});

describe('registersHosts', () => {
  it('registers from a Bridge whose state lives in the home folder', () => {
    expect(registersHosts({ state: '/Users/me/.browsentic', home: '/Users/me', env: {}, platform: 'darwin' })).toBe(true);
    expect(registersHosts({ state: 'C:\\Users\\Me\\.browsentic', home: 'c:\\users\\me', env: {}, platform: 'win32' })).toBe(true);
  });

  it('never points the user’s browsers at a scratch Bridge kept elsewhere', () => {
    expect(registersHosts({ state: '/tmp/scratch/.browsentic', home: '/Users/me', env: {}, platform: 'darwin' })).toBe(false);
    expect(registersHosts({ state: '/Users/me', home: '/Users/me', env: {}, platform: 'darwin' })).toBe(false);
    expect(registersHosts({ state: '/Users/meet/.browsentic', home: '/Users/me', env: {}, platform: 'darwin' })).toBe(false);
  });

  it('reads Windows paths as Windows paths, whichever browsers’ layout is being worked out', () => {
    const windows = { state: 'C:\\Users\\RUNNER~1\\Temp\\t\\.browsentic', home: 'C:\\Users\\RUNNER~1\\Temp\\t', env: {} };
    expect(registersHosts({ ...windows, platform: 'linux' })).toBe(true);
    expect(registersHosts({ ...windows, platform: 'darwin' })).toBe(true);
    expect(registersHosts({ ...windows, state: 'D:\\scratch\\.browsentic', platform: 'linux' })).toBe(false);
  });

  it('lets someone who really keeps it elsewhere say so', () => {
    expect(registersHosts({ state: '/Volumes/x/.browsentic', home: '/Users/me', env: { BROWSENTIC_REGISTER_HOST: '1' }, platform: 'darwin' })).toBe(true);
  });

  it('installs, refreshes and removes nothing from a scratch Bridge', () => {
    const scratch = { platform: 'linux', state: '/tmp/elsewhere', env: {} } as const;
    expect(installNativeHost('/opt/browsentic/dist/cli.js', scratch)).toMatchObject({ browsers: [], skipped: expect.any(String) });
    expect(removeNativeHost(scratch)).toEqual([]);
  });
});

describe('registering the host on Linux', () => {
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
      allowed_origins: [...STORE_ORIGINS, unpackedExtensionOrigin(extensionDir(), 'linux')].sort(),
    });
    expect(registeredBrowsers(linux)).toEqual(['Chrome']);
    expect(registrationCurrent(linux)).toBe(true);
  });

  it('says so when an older Bridge’s manifest leaves the store copies out', () => {
    installNativeHost('/opt/browsentic/dist/cli.js', linux);
    writeFileSync(manifest, JSON.stringify(hostManifest('chromium', '/x', ['chrome-extension://old/'])));

    expect(registrationCurrent(linux)).toBe(false);
  });

  it('removes every trace on uninstall', () => {
    installNativeHost('/opt/browsentic/dist/cli.js', linux);

    removeNativeHost(linux);

    expect(existsSync(manifest)).toBe(false);
    expect(existsSync(nativeHostDir)).toBe(false);
    expect(registeredBrowsers(linux)).toEqual([]);
  });

  // A read-only folder stands in for one an administrator locked; Windows folders have no such mode.
  it.skipIf(process.platform === 'win32')('goes on past a manifest it may not delete, so the rest of an uninstall still runs', () => {
    installNativeHost('/opt/browsentic/dist/cli.js', linux);
    chmodSync(dirname(manifest), 0o555);
    try {
      expect(removeNativeHost(linux)).toEqual([nativeHostDir]);
    } finally {
      chmodSync(dirname(manifest), 0o755);
    }
  });
});

describe('registering the host on macOS', () => {
  const home = homedir();
  const support = posix.join(home, 'Library', 'Application Support');
  const manifestIn = (dir: string) => posix.join(support, dir, 'NativeMessagingHosts', `${NATIVE_HOST_NAME}.json`);
  const mac = (installed: string[], forks: { browser: string; app: string; dataDir: string }[] = []) =>
    ({ platform: 'darwin', home, forks: () => forks, exists: (path: string) => installed.includes(path) }) as const;

  beforeEach(() => {
    removeNativeHost(mac([]));
    rmSync(support, { recursive: true, force: true });
  });

  it('writes Chrome’s and Mozilla’s folders even when neither browser is installed', () => {
    const installed = installNativeHost('/opt/browsentic/dist/cli.js', mac([]));

    expect(installed.browsers).toEqual([]);
    expect(JSON.parse(readFileSync(manifestIn('Google/Chrome'), 'utf8'))).toMatchObject({ allowed_origins: expect.arrayContaining(STORE_ORIGINS) });
    expect(JSON.parse(readFileSync(manifestIn('Mozilla'), 'utf8'))).toMatchObject({ allowed_extensions: ['browsentic@browsentic.com'] });
  });

  it('lets a Mac with Brave and no Chrome start the Bridge, through Chrome’s folder', () => {
    const machine = mac(['/Applications/Brave Browser.app']);

    expect(installNativeHost('/opt/browsentic/dist/cli.js', machine).browsers).toEqual(['Brave']);
    expect(existsSync(manifestIn('Google/Chrome'))).toBe(true);
    expect(registeredBrowsers(machine)).toEqual(['Brave']);
  });

  it('registers Firefox on a Mac that never made a Mozilla folder', () => {
    const machine = mac([posix.join(support, 'Firefox', 'profiles.ini')]);

    expect(installNativeHost('/opt/browsentic/dist/cli.js', machine).browsers).toEqual(['Firefox']);
    expect(existsSync(manifestIn('Mozilla'))).toBe(true);
  });

  it('does not take the Chrome folder its own baseline made for Chrome being installed', () => {
    const onDisk = (path: string) => path.startsWith(support) && existsSync(path);
    const machine = { ...mac(['/Applications/Brave Browser.app']), exists: (path: string) => path === '/Applications/Brave Browser.app' || onDisk(path) };

    expect(installNativeHost('/opt/browsentic/dist/cli.js', machine).browsers).toEqual(['Brave']);
    expect([existsSync(posix.join(support, 'Google/Chrome')), registeredBrowsers(machine)]).toEqual([true, ['Brave']]);
  });

  it('registers a fork in the data folder its Info.plist names', () => {
    const machine = mac(['/Applications/Helium.app'], [{ browser: 'Helium', app: '/Applications/Helium.app', dataDir: 'net.imput.helium' }]);

    expect(installNativeHost('/opt/browsentic/dist/cli.js', machine).browsers).toEqual(['Helium']);
    expect(existsSync(manifestIn('net.imput.helium'))).toBe(true);
  });

  it('removes what it wrote, baselines included', () => {
    installNativeHost('/opt/browsentic/dist/cli.js', mac(['/Applications/Brave Browser.app']));

    removeNativeHost(mac([]));

    expect(existsSync(manifestIn('Google/Chrome'))).toBe(false);
    expect(existsSync(manifestIn('BraveSoftware/Brave-Browser'))).toBe(false);
    expect(existsSync(manifestIn('Mozilla'))).toBe(false);
  });
});

describe('refreshing the registration', () => {
  const linux = { platform: 'linux' } as const;
  const gone = '/gone/for/good';

  beforeEach(() => removeNativeHost(linux));

  it('does nothing before setup has written a launcher', () => {
    refreshNativeHost(linux);
    expect(existsSync(launcherPath('linux'))).toBe(false);
  });

  it('repins a launcher whose CLI and Node have gone to the ones this Bridge runs on', () => {
    installNativeHost(join(gone, 'cli.js'), linux);
    writeFileSync(launcherPath('linux'), launcherScript({ platform: 'linux', cliPath: join(gone, 'cli.js'), nodePath: join(gone, 'node'), pathEnv: '/usr/bin' }));
    const here = join(homedir(), 'cli.js');
    writeFileSync(here, '');

    refreshNativeHost({ ...linux, cliPath: here, nodePath: process.execPath });

    expect(launcherPins(readFileSync(launcherPath('linux'), 'utf8'), 'linux')).toEqual({ cliPath: here, nodePath: process.execPath, pathEnv: '/usr/bin' });
  });

  it('keeps a launcher whose pins still exist, but brings it up to date', () => {
    const here = join(homedir(), 'cli.js');
    writeFileSync(here, '');
    installNativeHost(here, linux);
    const old = ['#!/bin/sh', "PATH='/usr/bin'", 'export PATH', `NODE='${process.execPath}'`, `CLI='${here}'`, ''].join('\n');
    writeFileSync(launcherPath('linux'), old);

    refreshNativeHost({ ...linux, cliPath: join(gone, 'cli.js') });

    const script = readFileSync(launcherPath('linux'), 'utf8');
    expect(script).toContain('NODE_NO_WARNINGS=1');
    expect(launcherPins(script, 'linux')).toEqual({ cliPath: here, nodePath: process.execPath, pathEnv: '/usr/bin' });
  });
});

describe('registering the host on Windows', () => {
  const home = 'C:\\Users\\me';
  const profile = (dir: string) => `C:\\Users\\me\\AppData\\Local\\${dir}\\User Data`;
  const key = (vendor: string) => `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
  let keys: Map<string, string>;
  let scheduled: string[];
  const registry: Registry = {
    set: (path, value) => void keys.set(path, value),
    has: (path) => keys.has(path),
    remove: (path) => {
      if (!keys.delete(path)) throw new Error(`no key ${path}`);
    },
  };
  const tasks: TaskScheduler = {
    register: (file) => void scheduled.push(`register ${readFileSync(file).subarray(2).toString('utf16le').includes('daemon-main.js')}`),
    run: () => void scheduled.push('run'),
    remove: () => void scheduled.push('remove'),
    exists: () => scheduled.lastIndexOf('register true') > scheduled.lastIndexOf('remove'),
  };
  const windows = (installed: string[]) =>
    ({ platform: 'win32', home, env: {}, registry, tasks, state: 'C:\\Users\\me\\.browsentic', exists: (path: string) => installed.includes(path) }) as const;

  beforeEach(() => {
    keys = new Map();
    scheduled = [];
    removeNativeHost(windows([]));
    scheduled = [];
  });

  it('writes Chrome’s and Mozilla’s keys always, and each installed browser’s own', () => {
    const machine = windows([profile('Microsoft\\Edge'), profile('BraveSoftware\\Brave-Browser')]);

    const installed = installNativeHost('C:\\b\\dist\\cli.js', machine);

    expect(installed.browsers).toEqual(['Edge', 'Brave']);
    expect([...keys.keys()].sort()).toEqual([key('Google\\Chrome'), key('Microsoft\\Edge'), key('Mozilla')]);
    expect(JSON.parse(readFileSync(keys.get(key('Google\\Chrome'))!, 'utf8'))).toMatchObject({ path: installed.launcher });
    expect(registeredBrowsers(machine)).toEqual(['Edge', 'Brave']);
  });

  it('registers a Beta, Dev or Canary channel through the key its browser reads', () => {
    const machine = windows([profile('Google\\Chrome SxS'), profile('Microsoft\\Edge Beta')]);

    expect(installNativeHost('C:\\b\\dist\\cli.js', machine).browsers).toEqual(['Chrome Canary', 'Edge Beta']);
    expect(registeredBrowsers(machine)).toEqual(['Chrome Canary', 'Edge Beta']);
  });

  it('lets a browser installed since setup start the Bridge through the baseline key', () => {
    installNativeHost('C:\\b\\dist\\cli.js', windows([profile('Microsoft\\Edge')]));

    expect(registeredBrowsers(windows([profile('Microsoft\\Edge'), profile('Google\\Chrome')]))).toEqual(['Chrome', 'Edge']);
  });

  it('registers the task that starts the Bridge for Firefox, and takes it away on uninstall', () => {
    installNativeHost('C:\\b\\dist\\cli.js', windows([]));
    expect(scheduled).toEqual(['register true']);

    removeNativeHost(windows([]));
    expect(scheduled).toContain('remove');
  });

  it('registers the task again when it has gone missing, and leaves one that is there alone', () => {
    installNativeHost('C:\\b\\dist\\cli.js', windows([]));
    refreshNativeHost(windows([]));
    expect(scheduled).toEqual(['register true']);

    scheduled.push('remove');
    refreshNativeHost(windows([]));
    expect(scheduled).toEqual(['register true', 'remove', 'register true']);
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
