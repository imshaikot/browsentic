import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { describeActions } from '@/lib/actions/registry';
import { AGENTS, AGENT_KINDS, AGENT_LIST, isAgentKind } from '@/lib/agents/catalog';
import { RESERVED_ACTIONS } from '@/lib/actions/reserved';
import { assertToolNamesRoundTrip, toolNameFor } from '@/lib/actions/tool-names';
import { basename, join } from 'node:path';
import { agentSkills } from './agent/agent-skills';
import { forgetGrants, listGrants } from './agent/approvals';
import { clearDownloads, downloadDir, storedDownloads } from './downloads';
import { readAgentConfig, rememberExtensionDir, writeAgentModel } from './agent/config';
import { loadSkills, skillDirNames, uploadedSkillsDir } from './agent/skills';
import { ensureDaemon, probeExisting, runningDaemons, stopDaemons } from './ensure-daemon';
import { install, InstallError, readStamp } from './install';
import { logPath, readLockfile } from './lockfile';
import { log } from './log';
import { installKind } from './npx';
import { extensionDir } from './paths';
import { RemoteBridge } from './remote-bridge';
import { upgradeCli } from './self-update';
import { createMcpServer } from './server';
import { planUninstall, purgeNpxCache, removeAll } from './uninstall';
import pkg from './package.json';

const USAGE = `browsentic ${pkg.version} — hand your real browser to the agent you already run

  browsentic setup            install the extension, start the daemon, print a pairing code
  browsentic update           pull the newest build — the command itself, then the extension
  browsentic uninstall        stop the daemon and remove everything Browsentic wrote
  browsentic pair             issue a one-time code to type into the extension
  browsentic status           daemon, extension and agent state
  browsentic sessions         list paired browsers
  browsentic revoke [id]      unpair one browser by the id "sessions" prints, or all of them

  browsentic agent            show which agent runs the side panel, and which are installed
  browsentic agent <name>     switch to claude, codex or antigravity
  browsentic agent fix <name> let Browsentic fix what that agent still needs
  browsentic agent model <name> [model]   pin that agent's model, or omit it for the CLI's default

  browsentic skills           list the skills the agent can route to, and where they came from
  browsentic approvals        list the “always on this site” approvals you have granted
  browsentic approvals clear [host]   forget them, all of them or one site's
  browsentic downloads        list the files captured from pages, and where they were saved
  browsentic downloads clear  delete all of them
  browsentic tools            print the bundled tool manifest (no browser needed)
  browsentic logs             print the daemon log
  browsentic start            bring the background daemon up, if it is not already
  browsentic stop             stop the background daemon
  browsentic restart          stop the daemon and bring up a fresh one
  browsentic token            print the control token (for MCP clients, not the browser)

  agent, skills, approvals and downloads take --json, which is what the macOS app reads.
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
const wantsJson = process.argv.includes('--json');
const positional = process.argv.slice(3).filter((arg) => !arg.startsWith('--'));

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
  case 'uninstall':
    await uninstall(process.argv.slice(3));
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
    await chooseAgent(positional[0], positional[1], positional[2]);
    break;
  case 'tools':
    printTools();
    break;
  case 'status':
    await showStatus();
    break;
  case 'start':
    await start();
    break;
  case 'stop':
    await stop();
    break;
  case 'restart':
    await restart();
    break;
  case 'skills':
    printSkills();
    break;
  case 'approvals':
    manageApprovals(positional[0], positional[1]);
    break;
  case 'downloads':
    manageDownloads(positional[0]);
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
  if (wantsJson) {
    const config = readAgentConfig();
    const listed = skills.map(({ body: _body, ...skill }) => ({
      ...skill,
      path: skill.provenance === 'generated' ? join(uploadedSkillsDir(), skill.name) : undefined,
    }));
    const own = agentSkills(config).map(({ name, description }) => ({ name, description }));
    console.log(JSON.stringify({ skills: listed, dirs: skillDirNames(), agent: config.agent, agentSkills: own }, null, 2));
    return;
  }
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
  const installedIn = extensionDir(readAgentConfig().extensionDir);
  const stamp = readStamp(installedIn);
  if (stamp) {
    const stale = status.connected && status.extensionVersion !== stamp.version;
    console.log(
      `installed: v${stamp.version} at ${installedIn}` +
        (stale ? ', press ↻ at chrome://extensions to load it' : ''),
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

// Stops what is *answering*, not what the lockfile claims. A daemon outlives a deleted
// ~/.browsentic and goes on holding its port, and that orphan is the one people hit.
async function stop(): Promise<void> {
  const { stopped, stubborn } = await stopDaemons();
  for (const daemon of stopped) console.log(`Stopped daemon (pid ${daemon.pid}) on 127.0.0.1:${daemon.port}.`);
  for (const daemon of stubborn) {
    console.error(`Daemon (pid ${daemon.pid}) on 127.0.0.1:${daemon.port} would not exit — kill it by hand.`);
  }
  if (!stopped.length && !stubborn.length) console.log('No daemon is answering; nothing to stop.');
  if (stubborn.length) process.exitCode = 1;
}

async function start(): Promise<void> {
  const lock = await ensureDaemon();
  console.log(`Daemon running on 127.0.0.1:${lock.port} (pid ${lock.pid}, v${lock.daemonVersion}).`);
}

async function restart(): Promise<void> {
  const { stubborn } = await stopDaemons();
  if (stubborn.length) {
    console.error(`Daemon (pid ${stubborn[0].pid}) is still exiting — try again in a moment.`);
    process.exit(1);
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

  // A stale command installs a stale extension, silently, and under npx it will keep doing so
  // for as long as the cache lives — which is what makes `update` look like it does nothing.
  // Replace the command first and let the fresh one do the install.
  if (!flag('no-self-update')) {
    const code = await upgradeCli(pkg.version, process.argv.slice(2));
    if (code !== null) process.exit(code);
  }

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

  // An explicit --dir is remembered, so `update` lands in the same place rather than laying
  // down a second copy at the default path and leaving the browser pointed at the first.
  const chosen = valueOf('dir');
  const dir = extensionDir(chosen ?? readAgentConfig().extensionDir);
  if (chosen) rememberExtensionDir(chosen);
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

  // --no-pair means mint no code, not learn nothing: `update` still has to know whether this
  // browser is paired, because that decides whether what is left to do is "load unpacked" or
  // the one step an update actually needs, which is pressing ↻.
  const bridge = await RemoteBridge.connect(lock.port, lock.token);
  const sessions = await bridge.sessions();
  const alreadyPaired = sessions.some((session) => session.origin.startsWith('chrome-extension://'));
  const code = alreadyPaired || flag('no-pair') ? undefined : (await bridge.pair()).code;
  await bridge.close();

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
    console.log(`  Adding another browser? Load the same folder there, then run "browsentic pair".\n`);
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
  } else {
    console.log(`  2. Run "browsentic pair" and paste the code into the Browsentic popup.\n`);
  }
  console.log(`  Then open the side panel and say what you want.\n`);
}

/**
 * Remove Browsentic in one command.
 *
 * The manual procedure this replaces could not reach two of these: an npx cache, which is
 * invisible and goes on serving the version it first resolved, and a daemon whose lockfile was
 * deleted before it was stopped, which keeps its port for as long as the machine is up. Between
 * them they made a reinstall land on the old build, which looked like the installer was broken.
 */
async function uninstall(argv: string[]): Promise<void> {
  const flag = (name: string) => argv.includes(`--${name}`);
  const plan = planUninstall({ keepSkills: flag('keep-skills') });
  const daemons = await runningDaemons();
  const kind = installKind();

  console.log(`\n  Browsentic ${pkg.version} — uninstall\n`);
  if (!daemons.length && !plan.removals.length && !plan.npx.length) {
    console.log('  Nothing to remove; this machine is already clean.\n');
    return;
  }

  console.log('  This removes:\n');
  for (const daemon of daemons) console.log(`    daemon      127.0.0.1:${daemon.port}, pid ${daemon.pid}`);
  for (const removal of plan.removals) {
    console.log(`    ${removal.label.padEnd(11)} ${removal.path}`);
    console.log(`                ${removal.holds}${removal.keep ? ' — keeping skills/' : ''}`);
  }
  for (const entry of plan.npx) {
    const running = entry.running ? ', the copy running right now' : '';
    console.log(`    npx cache   ${entry.dir}`);
    console.log(`                browsentic ${entry.version ?? 'unknown'}${running}`);
  }

  if (plan.elsewhere.length) {
    console.log('\n  Left alone — configuration put these outside the two roots:\n');
    for (const dir of plan.elsewhere) console.log(`    ${dir.label.padEnd(11)} ${dir.path}  (${dir.holds})`);
  }

  console.log('\n  You will have to remove these yourself:\n');
  console.log('    the Browsentic card at chrome://extensions. Do that first — remove the');
  console.log('    directory while the card is loaded and the browser is left holding a');
  console.log('    broken one. It is also what clears recordings and held secrets, which');
  console.log('    live in extension storage rather than on disk.');
  if (kind === 'global') console.log('\n    the command itself:  npm rm -g browsentic');
  if (kind === 'repo') console.log('\n    the global link:     yarn daemon:unlink');
  if (kind === 'app') console.log('\n    the app itself:      drag Browsentic.app from Applications to the Trash');
  console.log('\n    the entry in your MCP client, e.g.  claude mcp remove browsentic');

  if (flag('dry-run')) {
    console.log('\n  --dry-run: nothing was removed.\n');
    return;
  }

  if (!flag('yes') && !argv.includes('-y')) {
    if (!process.stdin.isTTY) {
      console.error('\n  Nothing was removed — this is not a terminal, so there is nobody to ask.');
      console.error('  Re-run it with --yes.\n');
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('\n  Remove all of it? [y/N] ');
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) return console.log('\n  Nothing was removed.\n');
  }

  console.log();

  // Ask the daemon to drop its session keys before killing it, so a browser still holding the
  // socket is told it is unpaired instead of discovering it. Never spawn one to do this.
  const lock = await probeExisting();
  if (lock) {
    try {
      const bridge = await RemoteBridge.connect(lock.port, lock.token);
      const revoked = await bridge.revoke();
      await bridge.close();
      if (revoked) console.log(`  ✓ Unpaired   ${revoked} browser${revoked === 1 ? '' : 's'}`);
    } catch {
      console.log('  · Unpair     skipped, the daemon did not answer');
    }
  }

  const { stopped, stubborn } = await stopDaemons();
  if (stopped.length) console.log(`  ✓ Daemon     stopped (pid ${stopped.map((daemon) => daemon.pid).join(', ')})`);
  for (const daemon of stubborn) console.log(`  ✗ Daemon     pid ${daemon.pid} would not exit — kill it by hand`);

  for (const outcome of removeAll(plan.removals)) {
    if (!outcome.removed) console.log(`  ✗ ${outcome.removal.path} — ${outcome.error}`);
    else if (outcome.kept.length) console.log(`  ✓ Emptied    ${outcome.removal.path} — kept ${outcome.kept.join(', ')}/`);
    else console.log(`  ✓ Removed    ${outcome.removal.path}`);
  }

  // Last, because it deletes the directory this process is running out of.
  for (const purge of purgeNpxCache(plan.npx)) {
    if (purge.removed) console.log(`  ✓ Cleared    ${purge.entry.dir}`);
    else console.log(`  ✗ ${purge.entry.dir} — ${purge.error}`);
  }

  console.log('\n  Done. Remove the card at chrome://extensions if you have not.\n');
  if (stubborn.length) process.exitCode = 1;
}

async function showSessions(): Promise<void> {
  const bridge = await connect();
  const sessions = await bridge.sessions();
  await bridge.close();
  if (!sessions.length) {
    return console.log('No paired browsers. Run "browsentic setup" to add one.');
  }
  for (const session of sessions) {
    console.log(`${session.connected ? '●' : '○'} ${session.browser ?? session.origin}  ${session.id}`);
    console.log(`    ${session.origin}, extension v${session.extensionVersion}, paired ${session.pairedAt}, last seen ${session.lastSeenAt}`);
  }
}

async function chooseAgent(first?: string, second?: string, third?: string): Promise<void> {
  if (first === 'model') {
    if (!isAgentKind(second)) {
      console.error(`Name the agent whose model to set. Pick one of: ${AGENT_KINDS.join(', ')}`);
      process.exit(1);
    }
    writeAgentModel(second, third ?? null);
    first = second = undefined;
  }

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

  if (wantsJson) {
    console.log(JSON.stringify({ ...state, catalog: AGENT_LIST }, null, 2));
    return;
  }

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

async function revoke(browser?: string): Promise<void> {
  const bridge = await connect();
  const revoked = await bridge.revoke(browser);
  await bridge.close();
  if (!revoked) return console.log(browser ? `No session for ${browser}.` : 'Nothing to revoke.');
  console.log(`Revoked ${revoked} session(s). Pair again with "browsentic pair".`);
}

async function connect(): Promise<RemoteBridge> {
  const lock = await ensureDaemon();
  return RemoteBridge.connect(lock.port, lock.token);
}

function manageDownloads(sub?: string): void {
  if (sub === 'clear') {
    const dropped = clearDownloads();
    console.log(dropped ? `Deleted ${dropped} captured download${dropped === 1 ? '' : 's'}.` : 'Nothing captured to delete.');
    return;
  }
  if (sub) {
    console.log(`Unknown command "downloads ${sub}". Use "downloads" or "downloads clear".`);
    process.exitCode = 1;
    return;
  }

  const downloads = storedDownloads();
  if (wantsJson) {
    console.log(JSON.stringify({ dir: downloadDir(), downloads }, null, 2));
    return;
  }
  if (!downloads.length) {
    console.log(`Nothing captured. Files land in ${downloadDir()} when an agent uses page.captureDownload.`);
    return;
  }
  console.log(`${downloads.length} captured download${downloads.length === 1 ? '' : 's'} in ${downloadDir()}:\n`);
  for (const download of downloads) {
    console.log(`  ${download.name.padEnd(32)} ${download.notes.padEnd(34)} ${download.capturedAt.slice(0, 10)}`);
  }
  console.log('\nDelete them all with "browsentic downloads clear".');
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
  if (wantsJson) {
    console.log(JSON.stringify({ grants }, null, 2));
    return;
  }
  if (!grants.length) {
    console.log('No standing approvals. Every gated action still asks.');
    return;
  }
  console.log(`${grants.length} standing approval${grants.length === 1 ? '' : 's'} — these no longer ask:\n`);
  for (const grant of grants) console.log(`  ${grant.action.padEnd(24)} on ${grant.host.padEnd(28)} since ${grant.at.slice(0, 10)}`);
  console.log('\nRemove one site with "browsentic approvals clear <host>", or all with "approvals clear".');
}
