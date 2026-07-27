import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { describeActions } from '@/lib/actions/registry';
import { assertToolNamesRoundTrip, toolNameFor } from '@/lib/actions/tool-names';
import { join } from 'node:path';
import { loadSkills, skillDirNames, uploadedSkillsDir } from './agent/skills';
import { ensureDaemon, probeExisting } from './ensure-daemon';
import { clearLockfile, logPath, readLockfile } from './lockfile';
import { log } from './log';
import { RemoteBridge } from './remote-bridge';
import { createMcpServer } from './server';
import pkg from '../package.json';

const USAGE = `voicelink-mcp ${pkg.version} — MCP access to your browser via the VoiceLink extension

  voicelink-mcp              serve MCP over stdio (what an MCP client runs)
  voicelink-mcp pair         issue a one-time code to type into the extension
  voicelink-mcp sessions     list paired browsers
  voicelink-mcp revoke [origin]   unpair one browser, or all of them
  voicelink-mcp tools        print the bundled tool manifest (no browser needed)
  voicelink-mcp skills       list the skills the agent can route to, and where they came from
  voicelink-mcp status       show daemon and extension connection state
  voicelink-mcp stop         stop the background daemon
  voicelink-mcp logs         print the daemon log
  voicelink-mcp token        print the control token (for MCP clients, not the browser)
  voicelink-mcp --version    print the version

The extension connects to nothing until you pair it:
  1. run "voicelink-mcp pair"
  2. open the VoiceLink popup, paste the code, press Connect

Register with Claude Code:  claude mcp add voicelink -- npx -y @voicelink/mcp
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
  case 'tools':
    printTools();
    break;
  case 'status':
    await showStatus();
    break;
  case 'stop':
    stop();
    break;
  case 'skills':
    printSkills();
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

/** Serve MCP on stdio. Nothing may write to stdout past this point — it is the JSON-RPC stream. */
async function serve(): Promise<void> {
  const lock = await ensureDaemon();
  // Present when the daemon spawned a Claude Code run and that run spawned us: tagging the
  // invocations is what routes them through the run's approval gate and timeline.
  const bridge = await RemoteBridge.connect(lock.port, lock.token, process.env.VOICELINK_AGENT_RUN);
  // Only a spawned agent run gets the map-writing tool; an ordinary MCP client never sees it.
  const server = createMcpServer(bridge, pkg.version, { agentRun: !!process.env.VOICELINK_AGENT_RUN });
  await server.connect(new StdioServerTransport());
  log(`stdio MCP server attached to daemon on port ${lock.port}`);

  const shutdown = async () => {
    await bridge.close();
    await server.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
}

/**
 * Print the tool manifest straight from the bundled registry — no daemon, no browser.
 * Also the standing check that no action grew a top-level DOM reference: this bundle is
 * loaded in plain Node, where `document` at module scope would throw on import.
 */
function printTools(): void {
  const actions = describeActions();
  assertToolNamesRoundTrip(actions.map((action) => action.name));
  console.log(
    JSON.stringify(
      actions.map((action) => ({ ...action, name: toolNameFor(action.name), action: action.name })),
      null,
      2,
    ),
  );
}

/**
 * Every skill the router can reach, in precedence order — the answer to "did my upload land,
 * and is it shadowing something?". Reads the same directories a run does, so it needs no daemon.
 *
 * It also puts the skill loader in this bundle's import graph, which is what makes
 * `yarn mcp:manifest` catch a browser-only import creeping into `lib/skills/`.
 */
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
  await bridge.close();
  console.log(`daemon:    running on 127.0.0.1:${status.port} (pid ${lock.pid}, v${status.daemonVersion})`);
  console.log(`extension: ${status.connected ? `connected (v${status.extensionVersion})` : 'not connected'}`);
  console.log(`manifest:  ${status.manifestInSync ? 'in sync' : 'DRIFTED — extension and CLI were built from different registries'}`);
  console.log(
    `paired:    ${status.pairedBrowsers || 'none'}${status.pairingPending ? ' (a pairing code is outstanding)' : ''}`,
  );
  if (!status.pairedBrowsers) console.log('\nRun "voicelink-mcp pair" to connect your browser.');
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

/** Issue a one-time code. The daemon must be running to hold it, so start it if needed. */
async function pair(): Promise<void> {
  const bridge = await connect();
  const { code, expiresAt } = await bridge.pair();
  await bridge.close();
  const minutes = Math.round((expiresAt - Date.now()) / 60_000);
  const grouped = `${code.slice(0, 4)}-${code.slice(4)}`;
  console.log(`\n  Pairing code:  ${grouped}\n`);
  console.log(`  Open the VoiceLink popup, paste it, and press Connect.`);
  console.log(`  Expires in ${minutes} minutes and works once.\n`);
}

async function showSessions(): Promise<void> {
  const bridge = await connect();
  const sessions = await bridge.sessions();
  await bridge.close();
  if (!sessions.length) {
    return console.log('No paired browsers. Run "voicelink-mcp pair" to add one.');
  }
  for (const session of sessions) {
    console.log(`${session.connected ? '●' : '○'} ${session.origin}`);
    console.log(`    extension v${session.extensionVersion}, paired ${session.pairedAt}, last seen ${session.lastSeenAt}`);
  }
}

async function revoke(origin?: string): Promise<void> {
  const bridge = await connect();
  const revoked = await bridge.revoke(origin);
  await bridge.close();
  if (!revoked) return console.log(origin ? `No session for ${origin}.` : 'Nothing to revoke.');
  console.log(`Revoked ${revoked} session(s). Pair again with "voicelink-mcp pair".`);
}

/** Every command that talks to the daemon needs it running; start it if it is not. */
async function connect(): Promise<RemoteBridge> {
  const lock = await ensureDaemon();
  return RemoteBridge.connect(lock.port, lock.token);
}
