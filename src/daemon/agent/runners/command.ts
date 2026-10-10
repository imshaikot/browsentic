import { execFile, spawn, type ChildProcess, type ChildProcessByStdio, type SpawnOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { win32 } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { configPath } from '../config';
import { RunError } from './types';

/**
 * How the daemon starts an agent CLI, and stops one. On macOS and Linux that is `spawn` and a
 * signal. Windows needs three things spawn does not do on its own:
 *
 *  - **An npm install is a batch file.** `codex` is `codex.cmd`, which spawn will not find on
 *    PATH, and will not run without a shell when named. A shell is no answer: a prompt runs to
 *    many lines, which cmd.exe cannot pass as one argument, and it carries page text, which cmd.exe
 *    would interpret. So the shim is read, and the program it names is started instead.
 *  - **No console window.** The daemon has none, so each console program it starts would get one.
 *  - **No signals.** A kill ends the one process, and whatever it started lives on.
 */

export type CliProcess = ChildProcessByStdio<Writable | null, Readable, Readable>;

export interface Command {
  file: string;
  args: string[];
}

/** What Windows allows a whole command line, the program's own name included. */
export const WINDOWS_COMMAND_LINE_MAX = 32_767;

const WINDOWS_EXTENSIONS = '.COM;.EXE;.BAT;.CMD';

/** The last line of an npm or pnpm shim: the program, quoted and relative to the shim, then `%*`. */
const SHIM_TARGET = /"%~?dp0%?\\([^"]+)"\s+%\*/gi;

interface Lookup {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  read?: (path: string) => string;
}

/**
 * The program `bin` runs and the arguments to start it with. Unchanged everywhere but Windows, and
 * unchanged there too when `bin` is not found — spawn's own ENOENT is what says it is not installed.
 */
export function resolveCommand(
  bin: string,
  args: readonly string[],
  { platform = process.platform, env = process.env, exists = existsSync, read = (path) => readFileSync(path, 'utf8') }: Lookup = {},
): Command {
  if (platform !== 'win32') return { file: bin, args: [...args] };
  const found = onPath(bin, env, exists);
  if (!found) return { file: bin, args: [...args] };
  return /\.(cmd|bat)$/i.test(found) ? throughShim(found, args, read) : { file: found, args: [...args] };
}

function onPath(bin: string, env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string | null {
  const extensions = (variable(env, 'PATHEXT') ?? WINDOWS_EXTENSIONS).split(';').filter(Boolean);
  const names = [...(win32.extname(bin) ? [bin] : []), ...extensions.map((extension) => `${bin}${extension.toLowerCase()}`)];
  const placed = win32.dirname(bin) !== '.';
  const dirs = placed ? [''] : (variable(env, 'PATH') ?? '').split(';').map((dir) => dir.replace(/^"|"$/g, '')).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = dir ? win32.join(dir, name) : name;
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/** Windows spells a variable any way it likes, and a plain copy of the environment keeps that spelling. */
export function variable(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1];
}

function throughShim(shim: string, args: readonly string[], read: (path: string) => string): Command {
  let text = '';
  try {
    text = read(shim);
  } catch {
    // Unreadable reads as unrecognized, which is refused below.
  }
  const target = [...text.matchAll(SHIM_TARGET)].map(([, path]) => path).find((path) => !/(^|\\)node\.exe$/i.test(path));
  if (target) {
    const file = win32.join(win32.dirname(shim), target);
    if (/\.(exe|com)$/i.test(file)) return { file, args: [...args] };
    // A shim for a script names the interpreter it looks for beside itself; only Node's is ours to stand in for.
    if (/\\node\.exe"/i.test(text)) return { file: process.execPath, args: [file, ...args] };
  }
  throw new RunError(
    'AGENT_UNUSABLE',
    `"${shim}" is a batch file Browsentic cannot see through, and it starts no batch file itself, because a prompt ` +
      `cannot cross cmd.exe intact. Set this agent's "bin" in ${configPath} to the program that file runs.`,
  );
}

/** How long Windows will find this command line: each argument quoted, its quotes and backslashes escaped. */
export function commandLineLength({ file, args }: Command): number {
  const quoted = (arg: string) => arg.length + 2 + (arg.match(/["\\]/g)?.length ?? 0);
  return [file, ...args].reduce((total, arg) => total + quoted(arg) + 1, 0);
}

/**
 * Starts an agent CLI: stdout and stderr piped, stdin closed unless it is to be written to. Refuses
 * a batch file it cannot see through, and a command line too long for Windows to start.
 */
export function spawnCli(
  bin: string,
  args: readonly string[],
  { stdin = 'ignore', ...options }: Omit<SpawnOptions, 'stdio'> & { stdin?: 'ignore' | 'pipe' } = {},
  platform: NodeJS.Platform = process.platform,
): CliProcess {
  const command = resolveCommand(bin, args, { platform, env: options.env ?? process.env });
  if (platform === 'win32') {
    const length = commandLineLength(command);
    if (length >= WINDOWS_COMMAND_LINE_MAX) {
      throw new RunError(
        'AGENT_FAILED',
        `This turn is too long for Windows to start: its command line would be ${length} characters, past the ${WINDOWS_COMMAND_LINE_MAX} ` +
          'Windows allows. Start a new conversation, or leave out site notes, attached files or fetched data.',
      );
    }
  }
  try {
    return spawn(command.file, command.args, { ...options, stdio: [stdin, 'pipe', 'pipe'], windowsHide: true }) as CliProcess;
  } catch (error) {
    throw new RunError('AGENT_UNUSABLE', `Could not start "${command.file}": ${(error as Error).message}`);
  }
}

/**
 * Stops a CLI. On Windows that ends it and everything it started, at once, since there is no signal
 * it could pass on; a process already gone is left alone, so its id cannot reach whatever reused it.
 */
export function stopTree(child: ChildProcess, signal: NodeJS.Signals, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32') {
    child.kill(signal);
    return;
  }
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
    if (error) child.kill(signal);
  });
}
