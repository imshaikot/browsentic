import { once } from 'node:events';
import { describe, expect, test } from 'vitest';
import { commandLineLength, resolveCommand, spawnCli, stopTree, WINDOWS_COMMAND_LINE_MAX } from './command';
import { RunError } from './types';

const NPM = 'C:\\Users\\sam\\AppData\\Roaming\\npm';
const PNPM = 'C:\\Users\\sam\\AppData\\Local\\pnpm';

/** What npm's cmd-shim writes for a package whose bin is a Node script. */
const npmScriptShim = (script: string) => `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*
`;

/** What it writes for a bin that is already a program. */
const npmProgramShim = (program: string) => `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%dp0%\\${program}"   %*
`;

/** And for a script whose shebang names another interpreter. */
const npmShellShim = `@ECHO off
SETLOCAL
CALL :find_dp0
IF EXIST "%dp0%\\/bin/sh.exe" (
  SET "_prog=%dp0%\\/bin/sh.exe"
) ELSE (
  SET "_prog=/bin/sh"
)
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\tool\\bin\\tool" %*
`;

const pnpmShim = `@SETLOCAL
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=${PNPM}\\global\\5\\node_modules\\.pnpm\\node_modules"
)
@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\global\\5\\node_modules\\@qwen-code\\qwen-code\\cli.js" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\\global\\5\\node_modules\\@qwen-code\\qwen-code\\cli.js" %*
)
`;

/** A Windows machine where only `files` exist, with `path` as its PATH. */
const windows = (files: Record<string, string>, env: NodeJS.ProcessEnv = { Path: `C:\\Windows\\System32;${NPM}` }) => ({
  platform: 'win32' as const,
  env,
  exists: (path: string) => Object.keys(files).some((file) => file.toLowerCase() === path.toLowerCase()),
  read: (path: string) => {
    const file = Object.keys(files).find((name) => name.toLowerCase() === path.toLowerCase());
    if (file === undefined) throw new Error(`ENOENT: ${path}`);
    return files[file];
  },
});

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof RunError ? { code: error.code, message: error.message } : error;
  }
  throw new Error('expected it to be refused');
};

describe('the program an agent command runs', () => {
  test('macOS and Linux run the command as it is written', () => {
    expect(resolveCommand('codex', ['exec', '--json'], { platform: 'darwin' })).toEqual({ file: 'codex', args: ['exec', '--json'] });
    expect(resolveCommand('/opt/homebrew/bin/claude', ['-p'], { platform: 'linux' })).toEqual({
      file: '/opt/homebrew/bin/claude',
      args: ['-p'],
    });
  });

  test('an npm install on Windows is its Node script, run by the Node the daemon runs on', () => {
    const machine = windows({ [`${NPM}\\codex.cmd`]: npmScriptShim('node_modules\\@openai\\codex\\bin\\codex.js') });
    expect(resolveCommand('codex', ['app-server', '-c', 'x=1'], machine)).toEqual({
      file: process.execPath,
      args: [`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`, 'app-server', '-c', 'x=1'],
    });
  });

  test('an npm shim for a program starts that program', () => {
    const machine = windows({ [`${NPM}\\claude.cmd`]: npmProgramShim('node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe') });
    expect(resolveCommand('claude', ['-p'], machine)).toEqual({
      file: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
      args: ['-p'],
    });
  });

  test('a pnpm shim is seen through the same way', () => {
    const machine = windows({ [`${PNPM}\\qwen.cmd`]: pnpmShim }, { PATH: PNPM });
    expect(resolveCommand('qwen', ['--safe-mode'], machine)).toEqual({
      file: process.execPath,
      args: [`${PNPM}\\global\\5\\node_modules\\@qwen-code\\qwen-code\\cli.js`, '--safe-mode'],
    });
  });

  test('a program on PATH wins over a batch file of the same name, as Windows orders them', () => {
    const machine = windows({
      [`${NPM}\\claude.cmd`]: npmScriptShim('node_modules\\@anthropic-ai\\claude-code\\cli.js'),
      'C:\\Users\\sam\\.local\\bin\\claude.exe': '',
    }, { Path: `C:\\Users\\sam\\.local\\bin;${NPM}` });
    expect(resolveCommand('claude', [], machine).file).toBe('C:\\Users\\sam\\.local\\bin\\claude.exe');
  });

  test('a bin set to an absolute path with no extension finds the shim beside it', () => {
    const machine = windows({ [`${NPM}\\opencode.cmd`]: npmScriptShim('node_modules\\opencode-ai\\bin\\opencode') });
    expect(resolveCommand(`${NPM}\\opencode`, ['run'], machine)).toEqual({
      file: process.execPath,
      args: [`${NPM}\\node_modules\\opencode-ai\\bin\\opencode`, 'run'],
    });
  });

  test('a bin set to the .cmd itself is seen through too, rather than refused by Node', () => {
    const machine = windows({ [`${NPM}\\codex.cmd`]: npmScriptShim('node_modules\\@openai\\codex\\bin\\codex.js') });
    expect(resolveCommand(`${NPM}\\codex.cmd`, [], machine).file).toBe(process.execPath);
  });

  test('PATH is found however the environment spells it, and a quoted entry is unquoted', () => {
    const shim = { [`${NPM}\\codex.cmd`]: npmScriptShim('node_modules\\@openai\\codex\\bin\\codex.js') };
    expect(resolveCommand('codex', [], windows(shim, { path: NPM })).file).toBe(process.execPath);
    expect(resolveCommand('codex', [], windows(shim, { PATH: `"${NPM}"` })).file).toBe(process.execPath);
  });

  test('a command Windows cannot find is left as written, so the spawn says it is not installed', () => {
    expect(resolveCommand('grok', ['-p'], windows({}))).toEqual({ file: 'grok', args: ['-p'] });
  });

  test('a batch file with no Node script or program in it is refused, naming the setting to change', () => {
    const machine = windows({ [`${NPM}\\agy.bat`]: '@echo off\r\ncall "%~dp0\\launch.bat" %*\r\n' });
    const refused = refusal(() => resolveCommand('agy', [], machine)) as { code: string; message: string };
    expect(refused.code).toBe('AGENT_UNUSABLE');
    expect(refused.message).toContain(`${NPM}\\agy.bat`);
    expect(refused.message).toContain('"bin"');
  });

  test('a shim for a script another interpreter runs is refused, not handed to Node', () => {
    const machine = windows({ [`${NPM}\\tool.cmd`]: npmShellShim });
    expect(refusal(() => resolveCommand('tool', [], machine))).toMatchObject({ code: 'AGENT_UNUSABLE' });
  });
});

describe('a command line Windows could not start', () => {
  test('each argument is counted as Windows quotes it', () => {
    expect(commandLineLength({ file: 'claude', args: ['-p'] })).toBe('"claude" "-p" '.length);
    expect(commandLineLength({ file: 'x', args: ['say "hi"'] })).toBe('"x" '.length + '"say \\"hi\\"" '.length);
  });

  test('a turn past the limit fails before anything is started, saying what to leave out', () => {
    const prompt = 'x'.repeat(WINDOWS_COMMAND_LINE_MAX);
    const refused = refusal(() => spawnCli('no-such-agent-cli', ['--rules', prompt], {}, 'win32')) as { code: string; message: string };
    expect(refused.code).toBe('AGENT_FAILED');
    expect(refused.message).toContain('site notes');
  });

  test.skipIf(process.platform === 'win32')('macOS and Linux are not held to it', async () => {
    const child = spawnCli(process.execPath, ['-e', 'process.stdout.write(String(process.argv[1].length))', 'x'.repeat(WINDOWS_COMMAND_LINE_MAX)]);
    let said = '';
    child.stdout.on('data', (chunk: Buffer) => (said += chunk.toString()));
    await once(child, 'close');
    expect(said).toBe(String(WINDOWS_COMMAND_LINE_MAX));
  });
});

describe('starting and stopping an agent CLI', () => {
  test('stdin is closed unless it is asked for, and then what is written reaches the CLI', async () => {
    const echo = "let t='';process.stdin.on('data',c=>t+=c).on('end',()=>process.stdout.write('got:'+t))";
    const closed = spawnCli(process.execPath, ['-e', echo]);
    expect(closed.stdin).toBeNull();

    const held = spawnCli(process.execPath, ['-e', echo], { stdin: 'pipe' });
    let said = '';
    held.stdout.on('data', (chunk: Buffer) => (said += chunk.toString()));
    held.stdin?.end('hello');
    await once(held, 'close');
    expect(said).toBe('got:hello');
  });

  test('a spawn Node refuses outright fails as a CLI that cannot be started', () => {
    expect(refusal(() => spawnCli(process.execPath, ['bad\0argument']))).toMatchObject({ code: 'AGENT_UNUSABLE' });
  });

  test('stopping one ends it', async () => {
    const child = spawnCli(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const closed = once(child, 'close');
    stopTree(child, 'SIGTERM');
    await closed;
    expect(child.exitCode === 0).toBe(false);
  });
});
