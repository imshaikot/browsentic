import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRIDGE_JOB, bridgeJobPlist, dropQuarantinedBunLibraries, startBridgeJob, type Launchd } from './quarantine';

const onMac = process.platform === 'darwin';

describe('the launchd job that starts the Bridge outside the browser', () => {
  let loaded: { plist: string; label: string; existed: boolean }[];
  const jobs: Launchd = {
    load: (file, label) => void loaded.push({ plist: readFileSync(file, 'utf8'), label, existed: existsSync(file) }),
  };

  beforeEach(() => {
    loaded = [];
  });

  it('runs the daemon once, now, with the environment it is handed', () => {
    expect(startBridgeJob('/opt/node/bin/node', '/Users/me/cli/dist/daemon-main.js', { PATH: '/opt/homebrew/bin:/usr/bin', TOKEN: 'a&b<c>' }, jobs)).toBe(true);

    expect(loaded).toHaveLength(1);
    const [{ plist, label, existed }] = loaded;
    expect(existed).toBe(true);
    expect(label).toBe(BRIDGE_JOB);
    expect(label).toMatch(/^com\.browsentic\.bridge\.[0-9a-f]{8}$/);
    expect(plist).toContain('<array><string>/opt/node/bin/node</string><string>/Users/me/cli/dist/daemon-main.js</string></array>');
    expect(plist).toContain('<key>PATH</key><string>/opt/homebrew/bin:/usr/bin</string>');
    expect(plist).toContain('<key>TOKEN</key><string>a&amp;b&lt;c&gt;</string>');
    expect(plist).toContain('<key>RunAtLoad</key><true/>');
    expect(plist).not.toContain('KeepAlive');
  });

  it('leaves no property list behind, holding the environment, once launchd has it', () => {
    startBridgeJob('/node', '/daemon-main.js', { SECRET: 'x' }, jobs);

    expect(loaded[0].existed).toBe(true);
    expect(readdirSync(join(process.env.BROWSENTIC_HOME!, 'native-host'))).not.toContain('bridge-job.plist');
  });

  it('keeps the browser’s own launchd service and bundle out of the job', () => {
    const plist = bridgeJobPlist('/node', '/daemon-main.js', {
      HOME: '/Users/me',
      XPC_SERVICE_NAME: 'application.com.google.Chrome.1234.5678',
      XPC_FLAGS: '0x0',
      __CFBundleIdentifier: 'com.google.Chrome',
    });

    expect(plist).toContain('<key>HOME</key><string>/Users/me</string>');
    expect(plist).not.toContain('XPC_');
    expect(plist).not.toContain('Chrome');
  });

  it('says so when launchd refuses it, so the caller spawns the Bridge itself', () => {
    const refusing: Launchd = {
      load: () => {
        throw new Error('Bootstrap failed: 5: Input/output error');
      },
    };

    expect(startBridgeJob('/node', '/daemon-main.js', {}, refusing)).toBe(false);
    expect(readFileSync(join(process.env.BROWSENTIC_HOME!, 'daemon.log'), 'utf8')).toContain('could not start the Bridge through launchd');
  });

  it.runIf(onMac)('is a property list launchd can read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browsentic-plist-'));
    const file = join(dir, 'job.plist');
    writeFileSync(file, bridgeJobPlist('/node', '/daemon-main.js', { ODD: '"quoted" & <tagged> \'single\'' }));

    try {
      expect(spawnSync('plutil', ['-lint', file], { encoding: 'utf8' }).stdout).toContain('OK');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('libraries a Bun-built agent unpacked while the Bridge ran quarantined', () => {
  let dir: string;
  const uid = 501;
  const touch = (...names: string[]) => names.forEach((name) => writeFileSync(join(dir, name), ''));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'browsentic-bun-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('removes this user’s quarantined ones and leaves everything else', () => {
    touch('.bun-501-1d98d107b4c544c0.dylib', '.bun-501-aaaaaaaaaaaaaaaa.node', '.bun-502-bbbbbbbbbbbbbbbb.dylib', 'libsomething.dylib');
    const marked = new Set(['.bun-501-1d98d107b4c544c0.dylib', '.bun-502-bbbbbbbbbbbbbbbb.dylib', 'libsomething.dylib']);

    const dropped = dropQuarantinedBunLibraries({ dir, uid, quarantined: (file) => marked.has(basename(file)) });

    expect(dropped).toEqual([join(dir, '.bun-501-1d98d107b4c544c0.dylib')]);
    expect(readdirSync(dir).sort()).toEqual(['.bun-501-aaaaaaaaaaaaaaaa.node', '.bun-502-bbbbbbbbbbbbbbbb.dylib', 'libsomething.dylib']);
  });

  it('finds nothing to do in a folder that is not there', () => {
    expect(dropQuarantinedBunLibraries({ dir: join(dir, 'gone'), uid, quarantined: () => true })).toEqual([]);
  });

  it.runIf(onMac)('reads the quarantine flag macOS set', () => {
    touch('.bun-501-cccccccccccccccc.dylib', '.bun-501-dddddddddddddddd.dylib');
    spawnSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;6ae24f49;Chrome;', join(dir, '.bun-501-cccccccccccccccc.dylib')]);

    expect(dropQuarantinedBunLibraries({ dir, uid })).toEqual([join(dir, '.bun-501-cccccccccccccccc.dylib')]);
    expect(readdirSync(dir)).toEqual(['.bun-501-dddddddddddddddd.dylib']);
  });
});
