import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BRIDGE_JOB,
  bridgeJobPlist,
  dropQuarantinedBunLibraries,
  removeBridgeJob,
  runsQuarantined,
  startBridgeJob,
  type JobState,
  type Launchd,
} from './quarantine';

const onMac = process.platform === 'darwin';
const logged = () => readFileSync(join(process.env.BROWSENTIC_HOME!, 'daemon.log'), 'utf8');

function fakeLaunchd(state: JobState, refusals = 0) {
  const calls: string[] = [];
  const plists: string[] = [];
  const jobs: Launchd = {
    state: () => state,
    bootout: (label) => void calls.push(`bootout ${label}`),
    bootstrap: (file) => {
      calls.push(`bootstrap ${existsSync(file)}`);
      plists.push(readFileSync(file, 'utf8'));
      if (refusals-- > 0) throw new Error('Bootstrap failed: 5: Input/output error');
    },
  };
  return { jobs, calls, plists };
}

describe('the launchd job that starts the Bridge outside a quarantined caller', () => {
  it('runs the daemon once, now, with the environment it is handed', async () => {
    const { jobs, calls, plists } = fakeLaunchd('absent');

    expect(await startBridgeJob('/opt/node/bin/node', '/Users/me/cli/dist/daemon-main.js', { PATH: '/opt/homebrew/bin:/usr/bin', TOKEN: 'a&b<c>' }, jobs)).toBe(true);

    expect(calls).toEqual(['bootstrap true']);
    expect(BRIDGE_JOB).toMatch(/^com\.browsentic\.bridge\.[0-9a-f]{8}$/);
    expect(plists[0]).toContain(`<key>Label</key><string>${BRIDGE_JOB}</string>`);
    expect(plists[0]).toContain('<array><string>/opt/node/bin/node</string><string>/Users/me/cli/dist/daemon-main.js</string></array>');
    expect(plists[0]).toContain('<key>PATH</key><string>/opt/homebrew/bin:/usr/bin</string>');
    expect(plists[0]).toContain('<key>TOKEN</key><string>a&amp;b&lt;c&gt;</string>');
    expect(plists[0]).toContain('<key>RunAtLoad</key><true/>');
    expect(plists[0]).not.toContain('KeepAlive');
  });

  it('replaces a job that has finished with a fresh one', async () => {
    const { jobs, calls } = fakeLaunchd('idle');

    expect(await startBridgeJob('/node', '/daemon-main.js', {}, jobs)).toBe(true);
    expect(calls).toEqual([`bootout ${BRIDGE_JOB}`, 'bootstrap true']);
  });

  it('waits for a job that is still running instead of booting it out', async () => {
    const { jobs, calls } = fakeLaunchd('running');

    expect(await startBridgeJob('/node', '/daemon-main.js', {}, jobs)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('tries once more while launchd is still taking the old job down', async () => {
    const { jobs, calls } = fakeLaunchd('idle', 1);

    expect(await startBridgeJob('/node', '/daemon-main.js', {}, jobs)).toBe(true);
    expect(calls).toEqual([`bootout ${BRIDGE_JOB}`, 'bootstrap true', 'bootstrap true']);
  });

  it('says so when launchd refuses it, so the caller spawns the Bridge itself', async () => {
    const { jobs } = fakeLaunchd('absent', 2);

    expect(await startBridgeJob('/node', '/daemon-main.js', {}, jobs)).toBe(false);
    expect(logged()).toContain('could not start the Bridge through launchd');
  });

  it('leaves no property list behind, holding the environment, once launchd has it', async () => {
    await startBridgeJob('/node', '/daemon-main.js', { SECRET: 'x' }, fakeLaunchd('absent').jobs);

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

  it('is taken away on uninstall, when there is one', () => {
    const loaded = fakeLaunchd('idle');
    expect(removeBridgeJob(loaded.jobs)).toBe(true);
    expect(loaded.calls).toEqual([`bootout ${BRIDGE_JOB}`]);

    const none = fakeLaunchd('absent');
    expect(removeBridgeJob(none.jobs)).toBe(false);
    expect(none.calls).toEqual([]);
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

  it.runIf(onMac)('is needed only when what this process writes comes out quarantined', () => {
    expect(runsQuarantined()).toBe(false);
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

  it('removes this user’s quarantined ones and leaves everything else', async () => {
    touch('.bun-501-1d98d107b4c544c0.dylib', '.bun-501-aaaaaaaaaaaaaaaa.node', '.bun-502-bbbbbbbbbbbbbbbb.dylib', 'libsomething.dylib');
    const marked = new Set(['.bun-501-1d98d107b4c544c0.dylib', '.bun-502-bbbbbbbbbbbbbbbb.dylib', 'libsomething.dylib']);
    const quarantineOf = async (file: string) => (marked.has(basename(file)) ? '0081;6ae24f49;Chrome;' : null);

    expect(await dropQuarantinedBunLibraries({ dir, uid, quarantineOf })).toEqual([join(dir, '.bun-501-1d98d107b4c544c0.dylib')]);
    expect(readdirSync(dir).sort()).toEqual(['.bun-501-aaaaaaaaaaaaaaaa.node', '.bun-502-bbbbbbbbbbbbbbbb.dylib', 'libsomething.dylib']);
  });

  it('keeps one the user let run with Open Anyway', async () => {
    touch('.bun-501-1d98d107b4c544c0.dylib');

    expect(await dropQuarantinedBunLibraries({ dir, uid, quarantineOf: async () => '00c1;6ae24f49;Chrome;' })).toEqual([]);
    expect(readdirSync(dir)).toEqual(['.bun-501-1d98d107b4c544c0.dylib']);
  });

  it('finds nothing to do in a folder that is not there', async () => {
    expect(await dropQuarantinedBunLibraries({ dir: join(dir, 'gone'), uid, quarantineOf: async () => '0081;0;x;' })).toEqual([]);
  });

  it.runIf(onMac)('reads the quarantine flag macOS set', async () => {
    touch('.bun-501-cccccccccccccccc.dylib', '.bun-501-dddddddddddddddd.dylib');
    spawnSync('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0081;6ae24f49;Chrome;', join(dir, '.bun-501-cccccccccccccccc.dylib')]);

    expect(await dropQuarantinedBunLibraries({ dir, uid })).toEqual([join(dir, '.bun-501-cccccccccccccccc.dylib')]);
    expect(readdirSync(dir)).toEqual(['.bun-501-dddddddddddddddd.dylib']);
  });
});
