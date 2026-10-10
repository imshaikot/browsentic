// Every browsentic command, run the way a person runs it: from what `npm i -g` installs out of the
// packed tarball, in a scratch home whose name is not ASCII and has a space in it. On Windows that
// means a .cmd shim started through cmd.exe, a wake-up launcher cmd.exe reads in its own code page,
// a registry key the browser finds that launcher by, and an MCP client starting a .cmd. The same
// checks run on Linux, so a command that behaves differently on Windows fails here.
//
//   node src/daemon/scripts/cli-smoke.ts src/daemon/browsentic-<version>.tgz
//
// The scratch Bridge answers only on its own ports. On Windows the keys Chrome reads live in the
// one registry the whole account shares, so it runs there in CI only.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const windows = process.platform === 'win32';
const [tarball] = process.argv.slice(2);
if (!tarball || !existsSync(tarball)) die('Name the tarball `npm pack` wrote in src/daemon.');
if (windows && !process.env.CI) die('On Windows this rewrites the registry keys Chrome reads, so it runs in CI only.');

const HOST = 'com.browsentic.daemon';
const PORTS = [47811, 47812];
const CHROME_WEB_STORE = 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/';
const COMMANDS = 'setup update uninstall browsers pair status sessions revoke agent skills approvals tasks downloads tools logs start stop restart token mcp'.split(' ');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

const scratch = mkdtempSync(join(tmpdir(), 'browsentic-smoke-'));
const home = join(scratch, 'hömé José');
const local = join(home, 'AppData', 'Local');
const prefix = join(home, 'npm');
const state = join(home, '.browsentic');
const files = join(home, 'browsentic');
const chromeProfiles: Partial<Record<NodeJS.Platform, string>> = {
  win32: join(local, 'Google', 'Chrome', 'User Data'),
  darwin: join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
};
const chromeProfile = chromeProfiles[process.platform] ?? join(home, '.config', 'google-chrome');

const env: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  LOCALAPPDATA: local,
  APPDATA: join(home, 'AppData', 'Roaming'),
  BROWSENTIC_HOME: state,
  BROWSENTIC_PORTS: PORTS.join(','),
  npm_config_cache: join(scratch, 'npm-cache'),
  PATH: `${windows ? prefix : join(prefix, 'bin')}${delimiter}${process.env.PATH}`,
};
for (const name of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'BROWSENTIC_AGENT_RUN', 'BROWSENTIC_DEBUG']) delete env[name];

interface Ran {
  code: number;
  out: string;
  err: string;
}

/** A command as a terminal runs it: on Windows through cmd.exe, which is what finds a .cmd on PATH. */
function sh(command: string, args: string[]): Ran {
  const result = windows
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${[command, ...args].map(quoted).join(' ')}"`], {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: true,
      })
    : spawnSync(command, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: result.status ?? 1, out: result.stdout ?? '', err: `${result.stderr ?? ''}${result.error ?? ''}` };
}

function quoted(arg: string): string {
  return /^[\w@.:/\\=,+-]+$/.test(arg) ? arg : `"${arg}"`;
}

const browsentic = (...args: string[]) => sh('browsentic', args);

function json<T = Record<string, unknown>>(ran: Ran): T {
  must(ran.code === 0, `exited ${ran.code}`, ran);
  return JSON.parse(ran.out.slice(ran.out.indexOf('{'))) as T;
}

function must(condition: unknown, problem: string, ran?: Ran): asserts condition {
  if (!condition) throw new Error(ran ? `${problem} (exit ${ran.code})\n${`${ran.out}${ran.err}`.trimEnd()}` : problem);
}

const says = (ran: Ran, text: string) => must(ran.code === 0 && ran.out.includes(text), `expected "${text}"`, ran);

const failures: string[] = [];

async function check(name: string, test: () => unknown): Promise<void> {
  try {
    await test();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL  ${name}\n${String((error as Error).message).replace(/^/gm, '      ')}`);
  }
}

function die(problem: string): never {
  console.error(`cli-smoke: ${problem}`);
  process.exit(1);
}

/** Where the browser looks for the host: the registry on Windows, its profile's manifest folder elsewhere. */
function hostManifest(): { path: string; allowed_origins: string[] } {
  if (!windows) return JSON.parse(readFileSync(join(chromeProfile, 'NativeMessagingHosts', `${HOST}.json`), 'utf8'));
  // reg query prints in the console's code page, which loses a path like hömé; an export is UTF-16.
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST}`;
  const exported = join(scratch, 'host.reg');
  must(spawnSync('reg', ['export', key, exported, '/y'], { windowsHide: true }).status === 0, `${key} is not registered`);
  const file = /^@="(.*)"\r?$/m.exec(readFileSync(exported, 'utf16le'))?.[1]?.replace(/\\(.)/g, '$1');
  must(file, `${key} has no default value`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * What the extension's wake-up gets back, started exactly as Chrome starts a host (launch_context_win.cc).
 * npm is offline, so the launcher's npx fallback cannot answer for a CLI path it failed to read.
 */
async function wake(): Promise<{ ok: boolean; port?: number; error?: string }> {
  const manifest = hostManifest();
  const offline = { ...env, npm_config_offline: 'true' };
  must(manifest.allowed_origins.includes(CHROME_WEB_STORE), 'the store copy is not allowed to start the host');
  const host = windows
    ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${manifest.path}" ${CHROME_WEB_STORE} --parent-window=0"`], {
        env: offline,
        cwd: dirname(manifest.path),
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
    : spawn(manifest.path, [CHROME_WEB_STORE], { env: offline, cwd: dirname(manifest.path) });
  const body = Buffer.from(JSON.stringify({ op: 'ensure' }));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  host.stdin.end(Buffer.concat([head, body]));

  const chunks: Buffer[] = [];
  const timer = setTimeout(() => host.kill(), 30_000);
  for await (const chunk of host.stdout) chunks.push(chunk as Buffer);
  clearTimeout(timer);
  const reply = Buffer.concat(chunks);
  must(reply.length > 4, `the host answered nothing: ${reply.toString('utf8')}`);
  return JSON.parse(reply.subarray(4, 4 + reply.readUInt32LE(0)).toString('utf8'));
}

/** An MCP client that starts its server from a JSON config, through the SDK's own spawn. */
async function mcpTools(command: string, args: string[]): Promise<number> {
  const client = new Client({ name: 'cli-smoke', version });
  await client.connect(new StdioClientTransport({ command, args, env: env as Record<string, string>, stderr: 'ignore' }));
  try {
    return (await client.listTools()).tools.length;
  } finally {
    await client.close();
  }
}

async function answering(): Promise<number[]> {
  const ports = await Promise.all(
    PORTS.map((port) =>
      fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) }).then(
        (response) => (response.ok ? port : 0),
        () => 0,
      ),
    ),
  );
  return ports.filter(Boolean);
}

try {
  mkdirSync(chromeProfile, { recursive: true });
  const installed = sh('npm', ['install', '--global', '--no-audit', '--no-fund', '--prefix', prefix, resolve(tarball)]);
  must(installed.code === 0, 'npm could not install the tarball', installed);
  console.log(`cli-smoke: browsentic ${version} installed under ${prefix}\n`);

  await check('--version is the packed version', () => must(browsentic('--version').out.trim() === version, 'wrong version'));
  await check('help names every command', () => {
    const help = browsentic('help');
    for (const command of COMMANDS) says(help, `browsentic ${command}`);
  });
  await check('an unknown command fails', () => must(browsentic('frobnicate').code === 1, 'it exited 0'));
  await check('tools prints the manifest without a Bridge', () => {
    const tools = JSON.parse(browsentic('tools').out) as unknown[];
    must(tools.length >= 40, `only ${tools.length} tools`);
  });
  await check('status before setup', () => {
    const status = browsentic('status');
    says(status, 'bridge:    not running');
    says(status, 'not registered');
  });

  await check('setup with no terminal prints the plan and writes no folder', () => {
    const plan = json<{ daemon: { port: number }; nativeHost: { browsers: string[] }; extensionDir: string | null }>(
      browsentic('setup', '--no-pair', '--json', '--no-self-update'),
    );
    must(PORTS.includes(plan.daemon.port), `the Bridge took port ${plan.daemon.port}`);
    must(plan.nativeHost.browsers.includes('Chrome'), `wake-up registered with ${plan.nativeHost.browsers.join(', ') || 'nothing'}`);
    must(plan.extensionDir === null && !existsSync(join(files, 'extension')), 'an unpacked folder appeared');
  });
  await check('setup --unpacked writes the extension', () => {
    const unpacked = json<{ extensionDir: string }>(browsentic('setup', '--unpacked', '--no-pair', '--no-wait', '--json', '--no-self-update'));
    must(unpacked.extensionDir === join(files, 'extension', 'chrome-mv3'), `written to ${unpacked.extensionDir}`);
    must(JSON.parse(readFileSync(join(unpacked.extensionDir, 'manifest.json'), 'utf8')).version === version, 'a stale extension');
  });
  await check('status with the Bridge up', () => {
    const status = browsentic('status');
    says(status, 'bridge:    running on 127.0.0.1:');
    says(status, 'Chrome can start the Bridge');
    says(status, 'browsers:  none paired');
  });
  await check('browsers --json', () => {
    const listed = json<{ running: boolean; browsers: unknown[]; unpacked: { version: string } }>(browsentic('browsers', '--json'));
    must(listed.running && listed.browsers.length === 8 && listed.unpacked.version === version, JSON.stringify(listed).slice(0, 300));
  });
  await check('setup --browser goes to that browser’s store, with a code to enter', () => {
    const named = json<{ chosen: { id: string; unpacked: boolean; opened: boolean }; pairingCode?: string }>(
      browsentic('setup', '--browser', 'edge', '--no-open', '--no-wait', '--json', '--no-self-update'),
    );
    must(named.chosen.id === 'edge' && !named.chosen.unpacked && !named.chosen.opened && named.pairingCode, JSON.stringify(named.chosen));
  });
  await check('pair issues a code', () => must(/Pairing code:\s+\S{4}-\S+/.test(browsentic('pair').out), 'no code'));
  await check('sessions', () => says(browsentic('sessions'), 'No paired browsers'));
  await check('revoke', () => says(browsentic('revoke'), 'Nothing to revoke.'));

  await check('agent --json lists every agent', () => {
    const agents = json<{ runners: unknown[]; catalog: unknown[]; active: string }>(browsentic('agent', '--json'));
    must(agents.runners.length === agents.catalog.length && agents.active, 'runners and catalog disagree');
  });
  await check('agent model pins a model, and clears it', () => {
    must(browsentic('agent', 'model', 'claude', 'claude-smoke-1').code === 0, 'could not pin');
    must(json<{ model: string | null }>(browsentic('agent', 'models', 'claude', '--json')).model === 'claude-smoke-1', 'not pinned');
    must(browsentic('agent', 'model', 'claude').code === 0, 'could not clear');
    must(json<{ model: string | null }>(browsentic('agent', 'models', 'claude', '--json')).model !== 'claude-smoke-1', 'still pinned');
  });
  await check('skills --json', () => must(json<{ skills: unknown[] }>(browsentic('skills', '--json')).skills.length > 0, 'no bundled skills'));
  await check('approvals', () => {
    must(json<{ grants: unknown[] }>(browsentic('approvals', '--json')).grants.length === 0, 'grants in a fresh home');
    says(browsentic('approvals', 'clear'), 'No approvals to forget');
  });
  await check('tasks pause and resume', () => {
    says(browsentic('tasks'), 'No scheduled tasks');
    says(browsentic('tasks', 'pause'), 'Every scheduled task is paused');
    must(json<{ paused: boolean }>(browsentic('tasks', '--json')).paused, 'not paused');
    says(browsentic('tasks', 'resume'), 'Scheduled tasks resumed.');
  });
  await check('downloads', () => {
    must(json<{ dir: string }>(browsentic('downloads', '--json')).dir === join(files, 'download'), 'downloads land elsewhere');
    says(browsentic('downloads', 'clear'), 'Nothing captured to delete.');
  });
  await check('token is the one the Bridge wrote', () => {
    const lock = JSON.parse(readFileSync(join(state, 'daemon.json'), 'utf8')) as { token: string };
    must(browsentic('token').out.trim() === lock.token, 'another token');
  });
  await check('logs', () => says(browsentic('logs'), 'daemon'));

  await check('an MCP client starts `browsentic mcp`', async () => must((await mcpTools('browsentic', ['mcp'])) >= 40, 'too few tools'));
  await check('an MCP client starts the bare `browsentic-mcp`', async () => must((await mcpTools('browsentic-mcp', [])) >= 40, 'too few tools'));

  await check('the browser finds the wake-up host and it answers', async () => {
    const reply = await wake();
    must(reply.ok && reply.port && PORTS.includes(reply.port), JSON.stringify(reply));
  });
  await check('stop', async () => {
    says(browsentic('stop'), 'Stopped the Bridge (pid');
    must((await answering()).length === 0, 'still answering');
    says(browsentic('status'), 'held since "browsentic stop"');
  });
  await check('the wake-up leaves a stopped Bridge down', async () => {
    const reply = await wake();
    must(!reply.ok && reply.error?.includes('browsentic start'), JSON.stringify(reply));
    must((await answering()).length === 0, 'the host started it anyway');
  });
  await check('start, then the wake-up finds it', async () => {
    says(browsentic('start'), 'Browsentic Bridge running on 127.0.0.1:');
    must((await wake()).ok, 'the host refused');
  });
  await check('restart', () => says(browsentic('restart'), 'Browsentic Bridge running on 127.0.0.1:'));
  await check('update keeps the unpacked copy current', () => says(browsentic('update', '--no-self-update'), 'already current'));

  await check('uninstall removes everything it wrote', async () => {
    const removed = browsentic('uninstall', '--yes');
    says(removed, 'Done.');
    must(!removed.out.includes('✗'), 'something could not be removed', removed);
    must(!existsSync(state) && !existsSync(files), 'files are left');
    must((await answering()).length === 0, 'the Bridge still answers');
    says(browsentic('status'), 'not registered');
    if (windows) must(spawnSync('reg', ['query', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST}`]).status !== 0, 'the key is left');
  });
} finally {
  if (await answering().then((ports) => ports.length)) browsentic('stop');
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
}

console.log(failures.length ? `\ncli-smoke: ${failures.length} failed: ${failures.join('; ')}` : '\ncli-smoke: every command works');
process.exit(failures.length ? 1 : 0);
