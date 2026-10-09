import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { spawnCli, stopTree, variable } from '../agent/runners/command';

const VERSION_TIMEOUT_MS = 5_000;
/** `winget install Google.PlatformTools` unpacks here and puts the folder on PATH, which a Bridge started earlier does not see. */
const WINGET_PLATFORM_TOOLS = 'Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe';
const START_SERVER_TIMEOUT_MS = 15_000;

export interface AdbFound {
  path: string;
  version?: string;
  /** The first line adb printed when it failed to run. */
  broken?: string;
}

export interface Where {
  configured?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

/** Where adb is looked for, first match first: the user's own setting, PATH, the SDK variables, then where installers put it. */
export function adbCandidates({ configured, env = process.env, platform = process.platform, home = homedir() }: Where = {}): string[] {
  const windows = platform === 'win32';
  const path = windows ? win32 : posix;
  const exe = windows ? 'adb.exe' : 'adb';
  const localAppData = variable(env, 'LOCALAPPDATA') ?? path.join(home, 'AppData', 'Local');
  const sdkRoots = [
    variable(env, 'ANDROID_HOME'),
    variable(env, 'ANDROID_SDK_ROOT'),
    platform === 'darwin' ? path.join(home, 'Library', 'Android', 'sdk') : undefined,
    windows ? path.join(localAppData, 'Android', 'Sdk') : undefined,
    platform === 'linux' ? path.join(home, 'Android', 'Sdk') : undefined,
  ];
  const candidates = [
    configured,
    ...(variable(env, 'PATH') ?? '')
      .split(windows ? ';' : ':')
      .map((dir) => dir.replace(/^"|"$/g, ''))
      .filter(Boolean)
      .map((dir) => path.join(dir, exe)),
    ...sdkRoots.filter((root): root is string => !!root).map((root) => path.join(root, 'platform-tools', exe)),
    ...(windows ? [path.join(localAppData, 'Microsoft', 'WinGet', 'Packages', WINGET_PLATFORM_TOOLS, 'platform-tools', exe)] : ['/opt/homebrew/bin/adb', '/usr/local/bin/adb']),
  ];
  return [...new Set(candidates.filter((candidate): candidate is string => !!candidate))];
}

export function isProgram(path: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function locateAdb(where: Where = {}, exists: (path: string) => boolean = isProgram): Promise<AdbFound | null> {
  const path = adbCandidates(where).find((candidate) => exists(candidate));
  if (!path) return null;
  const answer = await capture(path, ['version'], VERSION_TIMEOUT_MS);
  return answer.ok ? { path, version: versionOf(answer.output) } : { path, broken: firstLine(answer.output) ?? answer.error ?? 'it did not run' };
}

/** `Version 37.0.0-14910828` names the platform-tools release; older builds print only the protocol's `version 1.0.41`. */
export function versionOf(output: string): string | undefined {
  return /^Version (\S+)/m.exec(output)?.[1] ?? /Android Debug Bridge version (\S+)/.exec(output)?.[1];
}

/**
 * Started only when no server answers: `adb start-server` against a running server of another
 * version would kill it. Its output is not read, because the server it forks keeps any pipe it
 * inherits open for as long as it runs.
 */
export function startServer(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(path, ['start-server'], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      stopTree(child, 'SIGKILL');
      resolve(false);
    }, START_SERVER_TIMEOUT_MS);
    child.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function capture(path: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    let output = '';
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(path, args);
    } catch (error) {
      return resolve({ ok: false, output, error: (error as Error).message });
    }
    const timer = setTimeout(() => {
      stopTree(child, 'SIGKILL');
      resolve({ ok: false, output, error: `timed out after ${timeoutMs} ms` });
    }, timeoutMs);
    const collect = (chunk: Buffer) => (output += chunk.toString());
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output, error: error.message });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });
}

const firstLine = (output: string): string | undefined =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 200);
