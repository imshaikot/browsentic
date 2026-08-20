import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { describeActions } from '@/lib/actions/registry';
import { AGENTS, AGENT_KINDS, isAgentKind } from '@/lib/agents/catalog';
import { RESERVED_ACTIONS } from '@/lib/actions/reserved';
import { assertToolNamesRoundTrip, toolNameFor } from '@/lib/actions/tool-names';
import { join } from 'node:path';
import { forgetGrants, listGrants } from './agent/approvals';
import { loadSkills, skillDirNames, uploadedSkillsDir } from './agent/skills';
import { ensureDaemon, probeExisting } from './ensure-daemon';
import { clearLockfile, isRunning, logPath, readLockfile } from './lockfile';
import { log } from './log';
import { RemoteBridge } from './remote-bridge';
import { createMcpServer } from './server';
import pkg from '../package.json';

const USAGE = `browsentic-mcp ${pkg.version} — MCP access to your browser via the Browsentic extension

  browsentic-mcp              serve MCP over stdio (what an MCP client runs)
  browsentic-mcp pair         issue a one-time code to type into the extension
  browsentic-mcp sessions     list paired browsers
  browsentic-mcp revoke [origin]   unpair one browser, or all of them
  browsentic-mcp agent        show which agent runs the side panel, and which are installed
  browsentic-mcp agent <name> switch to claude, codex or antigravity
  browsentic-mcp agent setup <name>   let Browsentic fix what that agent still needs
  browsentic-mcp tools        print the bundled tool manifest (no browser needed)
  browsentic-mcp skills       list the skills the agent can route to, and where they came from
  browsentic-mcp approvals    list the “always on this site” approvals you have granted
  browsentic-mcp approvals clear [host]   forget them, all of them or one site's
  browsentic-mcp status       show daemon and extension connection state
  browsentic-mcp stop         stop the background daemon
  browsentic-mcp restart      stop the daemon and bring up a fresh one
  browsentic-mcp logs         print the daemon log
  browsentic-mcp token        print the control token (for MCP clients, not the browser)
  browsentic-mcp --version    print the version

The extension connects to nothing until you pair it:
  1. run "browsentic-mcp pair"
  2. open the Browsentic popup, paste the code, press Connect

Register with Claude Code:  claude mcp add browsentic -- npx -y @browsentic/mcp
`;

const [command] = process.argv.slice(2);

switch (command) {
  case undefined:
    await serve();
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
  console.log(`extension: ${status.connected ? `connected (v${status.extensionVersion})` : 'not connected'}`);
  console.log(
    `agent:     ${AGENTS[agents.active].label} — ${active?.ready ? active.version ?? 'ready' : active?.problem?.message ?? 'unavailable'}`,
  );
  console.log(`manifest:  ${status.manifestInSync ? 'in sync' : 'DRIFTED — extension and CLI were built from different registries'}`);
  console.log(
    `paired:    ${status.pairedBrowsers || 'none'}${status.pairingPending ? ' (a pairing code is outstanding)' : ''}`,
  );
  if (!status.pairedBrowsers) console.log('\nRun "browsentic-mcp pair" to connect your browser.');
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
  const grouped = `${code.slice(0, 4)}-${code.slice(4)}`;
  console.log(`\n  Pairing code:  ${grouped}\n`);
  console.log(`  Open the Browsentic popup, paste it, and press Connect.`);
  console.log(`  Expires in ${minutes} minutes and works once.\n`);
}

async function showSessions(): Promise<void> {
  const bridge = await connect();
  const sessions = await bridge.sessions();
  await bridge.close();
  if (!sessions.length) {
    return console.log('No paired browsers. Run "browsentic-mcp pair" to add one.');
  }
  for (const session of sessions) {
    console.log(`${session.connected ? '●' : '○'} ${session.origin}`);
    console.log(`    extension v${session.extensionVersion}, paired ${session.pairedAt}, last seen ${session.lastSeenAt}`);
  }
}

async function chooseAgent(first?: string, second?: string): Promise<void> {
  const setup = first === 'setup';
  const named = setup ? second : first;
  if (named !== undefined && !isAgentKind(named)) {
    console.error(`Unknown agent "${named}". Pick one of: ${AGENT_KINDS.join(', ')}`);
    process.exit(1);
  }
  const kind = isAgentKind(named) ? named : undefined;

  const bridge = await connect();
  const state = await bridge.agent(kind && (setup ? { grant: kind } : { set: kind }));
  await bridge.close();

  for (const runner of state.runners) {
    const agent = AGENTS[runner.kind];
    const mark = runner.kind === state.active ? '●' : '○';
    const version = runner.version ? ` — ${runner.version}` : '';
    console.log(`${mark} ${agent.label.padEnd(12)} ${runner.ready ? 'ready' : 'unavailable'}${version}`);
    if (runner.problem) {
      console.log(`    ${runner.problem.message}`);
      if (runner.problem.fix) console.log(`    ${runner.problem.fix}`);
      if (runner.problem.grantable) console.log(`    Fix it with "browsentic-mcp agent setup ${runner.kind}".`);
    }
  }
  console.log(`\nThe side panel runs on ${AGENTS[state.active].label}.`);
}

async function revoke(origin?: string): Promise<void> {
  const bridge = await connect();
  const revoked = await bridge.revoke(origin);
  await bridge.close();
  if (!revoked) return console.log(origin ? `No session for ${origin}.` : 'Nothing to revoke.');
  console.log(`Revoked ${revoked} session(s). Pair again with "browsentic-mcp pair".`);
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
  console.log('\nRemove one site with "browsentic-mcp approvals clear <host>", or all with "approvals clear".');
}
