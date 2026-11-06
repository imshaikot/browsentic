/**
 * A browser on macOS runs its native hosts quarantined, and every process a quarantined one starts is
 * quarantined too. A Bridge spawned there would mark each file it and its agent CLIs write as
 * downloaded by the browser, and Gatekeeper refuses any of those that is code and not notarized, such
 * as the library OpenCode unpacks into the temporary folder before loading it. A Bridge that launchd
 * starts is no child of the browser and writes its files unmarked.
 */

import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateDir } from './lockfile';
import { log } from './log';

const QUARANTINE = 'com.apple.quarantine';
const USER_APPROVED = 0x40;
const BOOTSTRAP_RETRY_MS = 300;

/** One per Bridge home, so that a scratch Bridge never boots out the real one. */
export const BRIDGE_JOB = `com.browsentic.bridge.${createHash('sha256').update(stateDir).digest('hex').slice(0, 8)}`;

export type JobState = 'running' | 'idle' | 'absent';

export interface Launchd {
  state(label: string): JobState;
  bootout(label: string): void;
  /** Loads the job, which starts it. Throws when launchd refuses it. */
  bootstrap(plistFile: string): void;
}

const launchctl = (args: string[]): string => {
  const { status, stdout, stderr, error } = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
  if (error) throw error;
  if (status !== 0) throw new Error(stderr.trim() || `launchctl ${args[0]} exited with ${status}`);
  return stdout;
};

const domain = () => `gui/${process.getuid?.()}`;

export const launchd: Launchd = {
  state: (label) => {
    try {
      return /^\tstate = running$/m.test(launchctl(['print', `${domain()}/${label}`])) ? 'running' : 'idle';
    } catch {
      return 'absent';
    }
  },
  bootout: (label) => void launchctl(['bootout', `${domain()}/${label}`]),
  bootstrap: (plistFile) => void launchctl(['bootstrap', domain(), plistFile]),
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

/**
 * Starts the Bridge as a launchd job. A job launchd is still running is a Bridge on its way up, or
 * one too busy to answer, so it is waited for and never booted out. False when launchd would not
 * take the job, and the caller spawns the Bridge itself.
 */
export async function startBridgeJob(nodePath: string, daemonMain: string, env: NodeJS.ProcessEnv, jobs: Launchd = launchd): Promise<boolean> {
  const dir = join(stateDir, 'native-host');
  const file = join(dir, 'bridge-job.plist');
  try {
    const state = jobs.state(BRIDGE_JOB);
    if (state === 'running') return true;
    if (state === 'idle') jobs.bootout(BRIDGE_JOB);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, bridgeJobPlist(nodePath, daemonMain, env), { mode: 0o600 });
    try {
      jobs.bootstrap(file);
    } catch {
      // launchd can still be taking the old job down when the new one arrives.
      await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_RETRY_MS));
      jobs.bootstrap(file);
    }
    return true;
  } catch (error) {
    log(`native host: could not start the Bridge through launchd: ${String(error)}`);
    return false;
  } finally {
    rmSync(file, { force: true });
  }
}

/** On uninstall: launchd keeps a job, and the environment it carries, until logout. */
export function removeBridgeJob(jobs: Launchd = launchd): boolean {
  if (jobs.state(BRIDGE_JOB) === 'absent') return false;
  try {
    jobs.bootout(BRIDGE_JOB);
    return true;
  } catch {
    return false;
  }
}

const quarantineOf = (file: string): string | null => {
  const { status, stdout } = spawnSync('/usr/bin/xattr', ['-p', QUARANTINE, file], { encoding: 'utf8' });
  return status === 0 ? stdout.trim() : null;
};

/** Whether what this process writes comes out quarantined, passed on by whatever started it. */
export function runsQuarantined(): boolean {
  const probe = join(stateDir, `.quarantine-probe-${process.pid}`);
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(probe, '');
    return quarantineOf(probe) !== null;
  } catch {
    return false;
  } finally {
    rmSync(probe, { force: true });
  }
}

const quarantineOfAsync = (file: string): Promise<string | null> =>
  new Promise((resolve) => execFile('/usr/bin/xattr', ['-p', QUARANTINE, file], (error, stdout) => resolve(error ? null : stdout.trim())));

/** The user let it run with Open Anyway, which Gatekeeper records in the flag instead of removing it. */
const approved = (quarantine: string) => (Number.parseInt(quarantine.split(';')[0], 16) & USER_APPROVED) !== 0;

export interface BunLibraries {
  dir?: string;
  uid?: number;
  quarantineOf?: (file: string) => Promise<string | null>;
}

/**
 * Bun-built CLIs, OpenCode among them, unpack their native libraries into the temporary folder as
 * `.bun-<uid>-<hash>.<ext>` and reuse that copy on every later start. One unpacked under a quarantined
 * Bridge stays quarantined, and Gatekeeper refuses it with a dialog at each start until it is gone.
 */
export async function dropQuarantinedBunLibraries({ dir = tmpdir(), uid = process.getuid?.() ?? 0, quarantineOf = quarantineOfAsync }: BunLibraries = {}): Promise<string[]> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.startsWith(`.bun-${uid}-`));
  } catch {
    return [];
  }
  const dropped: string[] = [];
  for (const file of names.map((name) => join(dir, name))) {
    const quarantine = await quarantineOf(file);
    if (quarantine === null || approved(quarantine)) continue;
    try {
      rmSync(file, { force: true });
      dropped.push(file);
    } catch {
      continue;
    }
  }
  return dropped;
}
