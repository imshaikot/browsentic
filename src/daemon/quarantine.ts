/**
 * A browser on macOS runs its native hosts quarantined, and every process a quarantined one starts is
 * quarantined too. A Bridge the host spawned would mark each file it and its agent CLIs write as
 * downloaded by the browser, and Gatekeeper refuses any of those that is code and not notarized, such
 * as the library OpenCode unpacks into the temporary folder before loading it. A Bridge that launchd
 * starts is no child of the browser and writes its files unmarked.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateDir } from './lockfile';
import { log } from './log';

/** One per Bridge home, so that a scratch Bridge never boots out the real one. */
export const BRIDGE_JOB = `com.browsentic.bridge.${createHash('sha256').update(stateDir).digest('hex').slice(0, 8)}`;

export interface Launchd {
  /** Loads the job afresh, which starts it. Throws when launchd refuses it. */
  load(plistFile: string, label: string): void;
}

const launchctl = (args: string[]) => {
  const { status, stderr } = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
  if (status !== 0) throw new Error(stderr.trim() || `launchctl ${args[0]} exited with ${status}`);
};

export const launchd: Launchd = {
  load: (plistFile, label) => {
    const domain = `gui/${process.getuid?.()}`;
    try {
      launchctl(['bootout', `${domain}/${label}`]);
    } catch {
      // Not loaded: no Bridge was started this way since login.
    }
    launchctl(['bootstrap', domain, plistFile]);
  },
};

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plistString = (value: string) => `<string>${escapeXml(value)}</string>`;

/** Name the browser's own launchd service and bundle, which this job is not. */
const namesTheBrowser = (key: string) => key.startsWith('XPC_') || key === '__CFBundleIdentifier';

/**
 * Runs once, as it loads, with the host's environment, and leaves what it started running when it
 * exits, as the detached spawn it stands in for does. Interactive spares it the CPU and I/O
 * throttling launchd gives a job of no declared type.
 */
export function bridgeJobPlist(nodePath: string, daemonMain: string, env: NodeJS.ProcessEnv): string {
  const variables = Object.entries(env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && !namesTheBrowser(entry[0]))
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>${plistString(value)}`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key>${plistString(BRIDGE_JOB)}`,
    `  <key>ProgramArguments</key><array>${plistString(nodePath)}${plistString(daemonMain)}</array>`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...variables,
    '  </dict>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>AbandonProcessGroup</key><true/>',
    '  <key>ProcessType</key><string>Interactive</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function startBridgeJob(nodePath: string, daemonMain: string, env: NodeJS.ProcessEnv, jobs: Launchd = launchd): boolean {
  const dir = join(stateDir, 'native-host');
  const file = join(dir, 'bridge-job.plist');
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, bridgeJobPlist(nodePath, daemonMain, env), { mode: 0o600 });
    jobs.load(file, BRIDGE_JOB);
    return true;
  } catch (error) {
    log(`native host: could not start the Bridge through launchd: ${String(error)}`);
    return false;
  } finally {
    rmSync(file, { force: true });
  }
}

const hasQuarantine = (file: string) =>
  spawnSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file], { stdio: 'ignore' }).status === 0;

export interface BunLibraries {
  dir?: string;
  uid?: number;
  quarantined?: (file: string) => boolean;
}

/**
 * Bun-built CLIs, OpenCode among them, unpack their native libraries into the temporary folder as
 * `.bun-<uid>-<hash>.<ext>` and reuse that copy on every later start. One unpacked under a quarantined
 * Bridge stays quarantined, and Gatekeeper refuses it with a dialog at each start until it is gone.
 */
export function dropQuarantinedBunLibraries({ dir = tmpdir(), uid = process.getuid?.() ?? 0, quarantined = hasQuarantine }: BunLibraries = {}): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const dropped: string[] = [];
  for (const name of names.filter((entry) => entry.startsWith(`.bun-${uid}-`))) {
    const file = join(dir, name);
    if (!quarantined(file)) continue;
    try {
      rmSync(file, { force: true });
      dropped.push(file);
    } catch {
      continue;
    }
  }
  return dropped;
}
