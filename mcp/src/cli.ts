import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { describeActions } from '@/lib/actions/registry';
import { AGENTS, AGENT_KINDS, isAgentKind } from '@/lib/agents/catalog';
import { RESERVED_ACTIONS } from '@/lib/actions/reserved';
import { assertToolNamesRoundTrip, toolNameFor } from '@/lib/actions/tool-names';
import { basename, join } from 'node:path';
import { agentSkills } from './agent/agent-skills';
import { forgetGrants, listGrants } from './agent/approvals';
import { readAgentConfig } from './agent/config';
import { loadSkills, skillDirNames, uploadedSkillsDir } from './agent/skills';
import { ensureDaemon, probeExisting } from './ensure-daemon';
import { install, InstallError, readStamp } from './install';
import { clearLockfile, isRunning, logPath, readLockfile } from './lockfile';
import { log } from './log';
import { extensionDir } from './paths';
import { RemoteBridge } from './remote-bridge';
import { createMcpServer } from './server';
import pkg from '../package.json';

const USAGE = `browsentic ${pkg.version} — hand your real browser to the agent you already run

  browsentic setup            install the extension, start the daemon, print a pairing code
  browsentic update           refresh the installed extension and restart the daemon
  browsentic pair             issue a one-time code to type into the extension
  browsentic status           daemon, extension and agent state
  browsentic sessions         list paired browsers
  browsentic revoke [origin]  unpair one browser, or all of them

  browsentic agent            show which agent runs the side panel, and which are installed
  browsentic agent <name>     switch to claude, codex or antigravity
  browsentic agent fix <name> let Browsentic fix what that agent still needs

  browsentic skills           list the skills the agent can route to, and where they came from
  browsentic approvals        list the “always on this site” approvals you have granted
  browsentic approvals clear [host]   forget them, all of them or one site's
  browsentic tools            print the bundled tool manifest (no browser needed)
  browsentic logs             print the daemon log
  browsentic stop             stop the background daemon
  browsentic restart          stop the daemon and bring up a fresh one
  browsentic token            print the control token (for MCP clients, not the browser)
  browsentic --version        print the version

Getting started:  browsentic setup

For MCP clients
  browsentic mcp              serve MCP over stdio — what a client runs, not what you type
      claude mcp add browsentic -- browsentic mcp
`;

// `browsentic mcp` is the MCP server. The legacy `browsentic-mcp` bin keeps serving on bare
// invocation, because an MCP client config is literally {"command": "browsentic-mcp"} with no
// arguments, and those must keep working. The extension strip matters on Windows, where npm
// writes browsentic-mcp.cmd.
const invokedAs = basename(process.argv[1] ?? '').replace(/\.(?:js|cjs|mjs|exe|cmd|ps1)$/i, '');
const servesBare = invokedAs === 'browsentic-mcp' || !!process.env.BROWSENTIC_AGENT_RUN;

const [command] = process.argv.slice(2);

switch (command) {
  case undefined:
    if (servesBare) await serve();
    else console.log(USAGE);
    break;
  case 'mcp':
    await serve();
    break;
  case 'setup':
    await setup(process.argv.slice(3));
    break;
  case 'update':
    await setup(['--no-pair', '--restart', ...process.argv.slice(3)]);
    break;
  case 'pair':
    await pair();
    break;
  case 'sessions':
    await showSessions();
    break;
  case 'revoke':
    await revoke(process.argv[3]);
    break;
  case 'agent':
    await chooseAgent(process.argv[3], process.argv[4]);
    break;
  case 'tools':
    printTools();
    break;
  case 'status':
    await showStatus();
    break;
  case 'stop':
    stop();
    break;
  case 'restart':
    await restart();
    break;
  case 'skills':
    printSkills();
    break;
  case 'approvals':
    manageApprovals(process.argv[3], process.argv[4]);
    break;
  case 'logs':
    showLogs();
    break;
  case 'token':
    printToken();
    break;
  case '--version':
  case '-v':
    console.log(pkg.version);
    break;
  case 'help':
  case '--help':
  case '-h':
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command "${command}"\n\n${USAGE}`);
    process.exit(1);
}

async function serve(): Promise<void> {
  const lock = await ensureDaemon();
  const bridge = await RemoteBridge.connect(lock.port, lock.token, process.env.BROWSENTIC_AGENT_RUN);
  const server = createMcpServer(bridge, pkg.version, { agentRun: !!process.env.BROWSENTIC_AGENT_RUN });
  await server.connect(new StdioServerTransport());
  log(`stdio MCP server attached to daemon on port ${lock.port}`);

  const shutdown = async () => {
    await bridge.close();
    await server.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
}

function printTools(): void {
  const actions = describeActions();
  assertToolNamesRoundTrip([...actions.map((action) => action.name), ...RESERVED_ACTIONS]);
  console.log(
    JSON.stringify(
      actions.map((action) => ({ ...action, name: toolNameFor(action.name), action: action.name })),
      null,
      2,
    ),
  );
}

function printSkills(): void {
  const skills = loadSkills();
  if (!skills.length) {
    console.log(`No skills found. Looked in:\n  ${skillDirNames().join('\n  ')}`);
    return;
  }
  for (const skill of skills) {
    const scope = skill.category === 'site-exploration' ? skill.domains.join(', ') || 'no domains — @name only' : '';
    const tags = [
      skill.source,
      skill.provenance === 'generated' ? 'mapped' : skill.category,
      scope,
      skill.isDefault ? 'default' : '',
    ].filter(Boolean);
    console.log(`${skill.name}  (${tags.join(' · ')})`);
    if (skill.description) console.log(`  ${skill.description}`);
    if (skill.provenance === 'generated') console.log(`  ${join(uploadedSkillsDir(), skill.name)}/`);
  }
  console.log(`\nRead in order: ${skillDirNames().join(' → ')} (a later one shadows an earlier one by name)`);

  const config = readAgentConfig();
  const own = agentSkills(config);
  if (own.length) {
    console.log(`\n${AGENTS[config.agent].label}'s own skills (attachable from the panel's / picker):`);
    for (const skill of own) {
      console.log(`${skill.name}`);
      if (skill.description) console.log(`  ${skill.description}`);
    }
  }
}

async function showStatus(): Promise<void> {
  const lock = await probeExisting();
  if (!lock) {
    console.log('daemon:    not running');
    console.log('extension: unknown (start an MCP client, or run a tool, to launch the daemon)');
    return;
  }
  const bridge = await RemoteBridge.connect(lock.port, lock.token);
  const status = await bridge.status();
  const agents = await bridge.agent();
  await bridge.close();
  const active = agents.runners.find((runner) => runner.kind === agents.active);
  console.log(`daemon:    running on 127.0.0.1:${status.port} (pid ${lock.pid}, v${status.daemonVersion})`);

  // "Updated the CLI, never reloaded the extension" is the failure this reports. Without it
  // the only symptom is a drifted manifest, which names no cause the user can act on.
  const stamp = readStamp(extensionDir());
  if (stamp) {
    const stale = status.connected && status.extensionVersion !== stamp.version;
    console.log(
      `installed: v${stamp.version} at ${extensionDir()}` +
        (stale ? ' — press ↻ at chrome://extensions to load it' : ''),
    );
  }
  console.log(`extension: ${status.connected ? `connected (v${status.extensionVersion})` : 'not connected'}`);
  console.log(
    `agent:     ${AGENTS[agents.active].label} — ${active?.ready ? active.version ?? 'ready' : active?.problem?.message ?? 'unavailable'}`,
  );
  console.log(`manifest:  ${status.manifestInSync ? 'in sync' : 'DRIFTED — extension and CLI were built from different registries'}`);
  console.log(
    `paired:    ${status.pairedBrowsers || 'none'}${status.pairingPending ? ' (a pairing code is outstanding)' : ''}`,
  );
  if (!status.pairedBrowsers) console.log('\nRun "browsentic setup" to install the extension, or "browsentic pair" if it is already loaded.');
}

function stop(): void {
  const lock = readLockfile();
  if (!lock) return console.log('No daemon lockfile; nothing to stop.');
  try {
    process.kill(lock.pid, 'SIGTERM');
    console.log(`Stopped daemon (pid ${lock.pid}).`);
  } catch {
    console.log(`Daemon (pid ${lock.pid}) was not running; clearing the lockfile.`);
    clearLockfile();
  }
}

async function restart(): Promise<void> {
  const lock = readLockfile();
  stop();
  const deadline = Date.now() + 5_000;
  while (lock && isRunning(lock.pid)) {
    if (Date.now() > deadline) {
      console.error(`Daemon (pid ${lock.pid}) is still exiting — try again in a moment.`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const fresh = await ensureDaemon();
  console.log(`Daemon running on 127.0.0.1:${fresh.port} (pid ${fresh.pid}, v${fresh.daemonVersion}).`);
}

function showLogs(): void {
  try {
    process.stdout.write(readFileSync(logPath, 'utf8'));
  } catch {
    console.log(`No log at ${logPath} yet.`);
  }
}

function printToken(): void {
  const lock = readLockfile();
  if (!lock) return console.error('No daemon lockfile yet — start the daemon first.');
  console.log(lock.token);
}

async function pair(): Promise<void> {
  const bridge = await connect();
  const { code, expiresAt } = await bridge.pair();
  await bridge.close();
  const minutes = Math.round((expiresAt - Date.now()) / 60_000);
  console.log(`\n  Pairing code:  ${groupCode(code)}\n`);
  console.log(`  Open the Browsentic popup, paste it, and press Connect.`);
  console.log(`  Expires in ${minutes} minutes and works once.\n`);
}

/**
 * The extension strips the dash back out; it is there to make the code readable aloud.
 *
 * A function declaration, not a const arrow: the switch at the top of this file invokes
 * commands before execution reaches the bottom, so anything they call has to be hoisted.
 */
function groupCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Install the extension, bring up the daemon, and hand back a pairing code. The two steps
 * left after this happen inside the browser, so only the user can do them.
 */
async function setup(argv: string[]): Promise<void> {
  const flag = (name: string) => argv.includes(`--${name}`);
  const valueOf = (name: string) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };

  const browser = valueOf('browser') ?? 'chrome';
  if (browser === 'firefox') {
    console.log(`
  Firefox is not supported by this command yet.

  Release Firefox refuses unsigned extensions, and an add-on loaded through
  about:debugging is discarded when the browser restarts, so there is nothing
  useful to install. A signed build distributed through addons.mozilla.org is
  the fix, and it is not ready.

  Developer Edition and Nightly can load dist/firefox-mv2 from the source
  repository with xpinstall.signatures.required set to false.
`);
    process.exit(1);
  }
  if (browser !== 'chrome') {
    console.error(`Unknown browser "${browser}". Supported: chrome`);
    process.exit(1);
  }

  const dir = extensionDir(valueOf('dir'));
  const json = flag('json');

  let result;
  try {
    result = install(dir, flag('force'));
  } catch (error) {
    if (error instanceof InstallError) {
      console.error(`\n  ${error.message}`);
      if (error.hint) console.error(`  ${error.hint}`);
      console.error();
      process.exit(1);
    }
    throw error;
  }

  // Restart first, then read the lockfile. A daemon that keeps running holds the previous
  // build's action registry in memory, which surfaces later as an unexplained manifest drift.
  // Reading the lock before the restart would also report the pid that just went away.
  if (flag('restart')) await restart();
  const lock = await ensureDaemon();

  let code: string | undefined;
  let alreadyPaired = false;
  if (!flag('no-pair')) {
    const bridge = await RemoteBridge.connect(lock.port, lock.token);
    const sessions = await bridge.sessions();
    alreadyPaired = sessions.some((session) => session.origin.startsWith('chrome-extension://'));
    if (!alreadyPaired) code = (await bridge.pair()).code;
    await bridge.close();
  }

  if (json) {
    console.log(
      JSON.stringify(
        { version: result.version, extensionDir: dir, daemon: { port: lock.port, pid: lock.pid }, alreadyPaired, pairingCode: code },
        null,
        2,
      ),
    );
    return;
  }

  const state = result.alreadyCurrent ? 'already current' : `${result.changed} file(s) written`;
  console.log(`\n  Browsentic ${result.version}\n`);
  console.log(`  ✓ Extension  ${dir}`);
  console.log(`               ${state}`);
  console.log(`  ✓ Daemon     127.0.0.1:${lock.port} (pid ${lock.pid})\n`);

  if (alreadyPaired) {
    console.log(`  This browser is already paired. Press ↻ on the Browsentic card at`);
    console.log(`  chrome://extensions to pick up this build, and you are done.\n`);
    return;
  }

  console.log(`  Two steps are left. Both happen inside the browser, so only you can do them.\n`);
  console.log(`  1. Open  chrome://extensions`);
  console.log(`     Turn on Developer mode, press "Load unpacked", and choose:\n`);
  console.log(`         ${dir}\n`);
  // Chrome refuses chrome:// URLs given on the command line, so there is no opening this for
  // them. The folder picker shortcut is the next best thing, and it is where people stall.
  if (process.platform === 'darwin') console.log(`     In the folder picker press ⇧⌘G and paste that path.\n`);
  if (code) {
    console.log(`  2. Open the Browsentic popup and paste this code:\n`);
    console.log(`         ${groupCode(code)}\n`);
    console.log(`     Single use, expires in 10 minutes. Need another? "browsentic pair"\n`);
  }
  console.log(`  Then open the side panel and say what you want.\n`);
}

async function showSessions(): Promise<void> {
  const bridge = await connect();
  const sessions = await bridge.sessions();
  await bridge.close();
  if (!sessions.length) {
    return console.log('No paired browsers. Run "browsentic setup" to add one.');
  }
  for (const session of sessions) {
    console.log(`${session.connected ? '●' : '○'} ${session.origin}`);
    console.log(`    extension v${session.extensionVersion}, paired ${session.pairedAt}, last seen ${session.lastSeenAt}`);
  }
}

async function chooseAgent(first?: string, second?: string): Promise<void> {
  // Renamed to "fix" because `browsentic setup` now means something else entirely. The old
  // spelling stays as an undocumented alias for one release.
  const grant = first === 'fix' || first === 'setup';
  const named = grant ? second : first;
  if (named !== undefined && !isAgentKind(named)) {
    console.error(`Unknown agent "${named}". Pick one of: ${AGENT_KINDS.join(', ')}`);
    process.exit(1);
  }
  const kind = isAgentKind(named) ? named : undefined;

  const bridge = await connect();
  const state = await bridge.agent(kind && (grant ? { grant: kind } : { set: kind }));
  await bridge.close();

  for (const runner of state.runners) {
    const agent = AGENTS[runner.kind];
    const mark = runner.kind === state.active ? '●' : '○';
    const version = runner.version ? ` — ${runner.version}` : '';
    console.log(`${mark} ${agent.label.padEnd(12)} ${runner.ready ? 'ready' : 'unavailable'}${version}`);
    if (runner.problem) {
      console.log(`    ${runner.problem.message}`);
      if (runner.problem.fix) console.log(`    ${runner.problem.fix}`);
      if (runner.problem.grantable) console.log(`    Fix it with "browsentic agent fix ${runner.kind}".`);
    }
  }
  console.log(`\nThe side panel runs on ${AGENTS[state.active].label}.`);
}

async function revoke(origin?: string): Promise<void> {
  const bridge = await connect();
  const revoked = await bridge.revoke(origin);
  await bridge.close();
  if (!revoked) return console.log(origin ? `No session for ${origin}.` : 'Nothing to revoke.');
  console.log(`Revoked ${revoked} session(s). Pair again with "browsentic pair".`);
}

async function connect(): Promise<RemoteBridge> {
  const lock = await ensureDaemon();
  return RemoteBridge.connect(lock.port, lock.token);
}

function manageApprovals(sub?: string, host?: string): void {
  if (sub === 'clear') {
    const dropped = forgetGrants(host);
    console.log(
      dropped
        ? `Forgot ${dropped} approval${dropped === 1 ? '' : 's'}${host ? ` for ${host}` : ''}.`
        : `No approvals to forget${host ? ` for ${host}` : ''}.`,
    );
    return;
  }
  if (sub) {
    console.log(`Unknown command "approvals ${sub}". Use "approvals" or "approvals clear [host]".`);
    process.exitCode = 1;
    return;
  }

  const grants = listGrants();
  if (!grants.length) {
    console.log('No standing approvals. Every gated action still asks.');
    return;
  }
  console.log(`${grants.length} standing approval${grants.length === 1 ? '' : 's'} — these no longer ask:\n`);
  for (const grant of grants) console.log(`  ${grant.action.padEnd(24)} on ${grant.host.padEnd(28)} since ${grant.at.slice(0, 10)}`);
  console.log('\nRemove one site with "browsentic approvals clear <host>", or all with "approvals clear".');
}
