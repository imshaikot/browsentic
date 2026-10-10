import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { describeActions } from '@/lib/actions/registry';
import { AGENTS, AGENT_KINDS, AGENT_LIST, isAgentKind, type AgentKind, type AgentState, type ModelList } from '@/lib/agents/catalog';
import { SOURCE_LABEL } from '@/lib/stores';
import { RESERVED_ACTIONS } from '@/lib/actions/reserved';
import { assertToolNamesRoundTrip, toolNameFor } from '@/lib/actions/tool-names';
import { formatWhen } from '@/lib/format-when';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentSkills } from './agent/agent-skills';
import {
  BROWSER_IDS,
  BROWSERS,
  browserOf,
  browserRows,
  isBrowserId,
  locateBrowsers,
  openPage,
  type BrowserId,
  type BrowserRow,
} from './browsers';
import type { SessionSummary } from './control';
import { forgetGrants, listGrants } from './agent/approvals';
import { describeMoment, describeRule } from '@/lib/schedules/rule';
import { findTask, readSchedules, setEnabled, setPaused, updateSchedules } from './schedules/store';
import { clearDownloads, downloadDir, storedDownloads } from './downloads';
import { readAgentConfig, rememberExtensionDir, writeAgentModel } from './agent/config';
import { loadSkills, skillDirNames, uploadedSkillsDir } from './agent/skills';
import { ensureDaemon, probeExisting, runningDaemons, stopDaemons } from './ensure-daemon';
import { install, InstallError, readStamp } from './install';
import { logPath, readLockfile, wakeHeld } from './lockfile';
import { log } from './log';
import { installKind } from './npx';
import { installNativeHost, registeredBrowsers, removeNativeHost, serveNativeHost } from './native-host';
import { extensionDir } from './paths';
import { RELEASES_PAGE, signedAddonAttached } from './firefox-addon';
import { RemoteBridge } from './remote-bridge';
import { upgradeCli } from './self-update';
import { createMcpServer } from './server';
import { planUninstall, purgeNpxCache, removeAll } from './uninstall';
import pkg from './package.json';

const USAGE = `browsentic ${pkg.version} — Browsentic Bridge, the half of Browsentic that runs on your computer

  browsentic setup            start the Bridge, then add the extension to a browser and pair the two
                              --browser chrome|edge|brave|arc|vivaldi|opera|chromium|firefox skips the question
                              --unpacked loads it from a folder instead of a store
                              --no-open, --no-wait: print the store link, and do not wait for the browser
  browsentic update           update the Bridge, and the unpacked folder if you load one; store copies update themselves
  browsentic uninstall        stop the Bridge and remove everything Browsentic wrote
  browsentic browsers         the browsers on this computer, where each gets the extension, and which are connected
  browsentic pair             issue a one-time code to type into the extension
  browsentic status           the Bridge, each paired browser, and the agent
  browsentic sessions         list paired browsers
  browsentic revoke [id]      unpair one browser by the id "sessions" prints, or all of them

  browsentic agent            show which agent runs the side panel, and which are installed
  browsentic agent <name>     switch to claude, codex, antigravity, vibe, grok, cursor, qwen or opencode
  browsentic agent fix <name> let Browsentic fix what that agent still needs
  browsentic agent model <name> [model]   pin that agent's model, or omit it for the CLI's default
  browsentic agent models <name>          list the models that agent offers; --refresh asks its CLI again

  browsentic skills           list the skills the agent can route to, and where they came from
  browsentic approvals        list the “always on this site” approvals you have granted
  browsentic approvals clear [host]   forget them, all of them or one site's
  browsentic tasks            list the scheduled tasks, when each runs next, and how it last went
  browsentic tasks pause|resume [id]   pause or resume one task, or every task at once
  browsentic tasks delete <id>         delete a task
  browsentic downloads        list the files captured from pages, and where they were saved
  browsentic downloads clear  delete all of them
  browsentic tools            print the bundled tool manifest (no browser needed)
  browsentic logs             print the Bridge's log
  browsentic start            bring the Bridge up in the background, if it is not already
  browsentic stop             stop the Bridge
  browsentic restart          stop the Bridge and bring up a fresh one
  browsentic token            print the control token (for MCP clients, not the browser)

  setup, browsers, agent, skills, approvals, tasks and downloads take --json, which is what the apps read.
  browsentic --version        print the version

Getting started:  browsentic setup

For MCP clients
  browsentic mcp              serve MCP over stdio — what a client runs, not what you type
      claude mcp add browsentic -- browsentic mcp
`;

// Above the switch, like USAGE: it runs the command before execution reaches the bottom of this
// file, and the bundle hoists a constant declared down there as an undefined var.
const AGENTS_GUIDE = 'https://browsentic.com/docs/guide/agents/';
const WAIT_MS = 5 * 60_000;
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
/** Offered when no browser is found, since detection can miss one installed somewhere unusual. */
const USUAL_BROWSERS: BrowserId[] = ['chrome', 'edge', 'brave', 'firefox'];

const APP_REMOVAL = {
  darwin: 'drag Browsentic.app from Applications to the Trash',
  win32: 'uninstall Browsentic in Settings › Apps › Installed apps',
} as const;

const FOLDER_PICKER: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'In the folder picker press ⇧⌘G and paste that path.',
  win32: 'In the folder picker paste that path into the address bar, press Enter, then Select Folder.',
  linux: 'In the folder picker press Ctrl+L and paste that path.',
};

// `browsentic mcp` is the MCP server; `browsentic-mcp` with no arguments reaches it through mcp.ts.
const servesBare = !!process.env.BROWSENTIC_AGENT_RUN;

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
  case 'native-host':
    await serveNativeHost(ensureDaemon, wakeHeld);
    break;
  case 'pair':
    await pair();
    break;
  case 'sessions':
    await showSessions();
    break;
  case 'browsers':
    await showBrowsers();
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
  case 'tasks':
    manageTasks(positional[0], positional[1]);
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
  const server = createMcpServer(bridge, pkg.version, {
    agentRun: !!process.env.BROWSENTIC_AGENT_RUN,
    resultBytes: Number(process.env.BROWSENTIC_RESULT_BYTES) || undefined,
  });
  await server.connect(new StdioServerTransport());
  log(`stdio MCP server attached to daemon on port ${lock.port}`);

  let stopping: Promise<void> | undefined;
  const shutdown = () =>
    (stopping ??= (async () => {
      await bridge.close();
      await server.close();
      process.exit(0);
    })());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
  // A client that is gone closes stdin. On Windows that is often all it does, since a CLI ended there
  // takes nothing with it, and a server that waited on would hold its socket to the daemon for good.
  for (const event of ['end', 'close'] as const) process.stdin.once(event, () => void shutdown());
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
  const waking = registeredBrowsers();
  const wake = `wake-up:   ${
    !waking.length
      ? 'not registered — run "browsentic setup"'
      : wakeHeld()
        ? `held since "browsentic stop" — "browsentic start" lets ${waking.join(', ')} start it again`
        : `${waking.join(', ')} can start the Bridge`
  }`;
  if (!lock) {
    console.log('bridge:    not running');
    console.log(wake);
    console.log('browsers:  unknown until it runs ("browsentic start", or open a browser that can start it)');
    return;
  }
  const bridge = await RemoteBridge.connect(lock.port, lock.token);
  const status = await bridge.status();
  const sessions = await bridge.sessions();
  const agents = await bridge.agent();
  await bridge.close();
  const active = agents.runners.find((runner) => runner.kind === agents.active);
  console.log(`bridge:    running on 127.0.0.1:${status.port} (pid ${lock.pid}, v${status.daemonVersion})`);
  console.log(wake);
  console.log(
    `agent:     ${AGENTS[agents.active].label} — ${active?.ready ? active.version ?? 'ready' : active?.problem?.message ?? 'unavailable'}`,
  );

  // An unpacked copy is the one thing an update cannot reach: "updated, never pressed ↻" is the
  // failure the reload hint names. A store copy updates when its browser says, so it gets none.
  const stamp = readStamp(extensionDir(readAgentConfig().extensionDir));
  if (!sessions.length) {
    console.log('browsers:  none paired — "browsentic setup" adds the extension to one');
  } else {
    console.log('browsers:');
    for (const session of sessions) {
      const page = BROWSERS[browserOf(session.browser) ?? 'chrome'].extensionsPage;
      const stale = session.source === 'unpacked' && stamp && session.extensionVersion !== stamp.version;
      console.log(
        `  ${session.connected ? '●' : '○'} ${(session.browser ?? session.origin).padEnd(16)} v${session.extensionVersion.padEnd(8)} ` +
          `${SOURCE_LABEL[session.source ?? 'unpacked'].padEnd(17)} ${session.connected ? 'connected' : 'not connected'}` +
          (stale ? `, ↻ at ${page} loads v${stamp.version}` : ''),
      );
    }
    for (const label of doubledBrowsers(sessions)) {
      console.log(`  ! Two copies of Browsentic answer in ${label}. Remove the unpacked one from its extensions page.`);
    }
  }
  console.log(
    `tools:     ${status.manifestInSync ? 'in sync' : `the extension's own list (extension v${status.extensionVersion}, Bridge v${status.daemonVersion})`}`,
  );
  if (status.pairingPending) console.log('pairing:   a code is waiting to be entered');
}

/** A browser where a store copy and an unpacked one are both connected: both inject, both answer. */
function doubledBrowsers(sessions: SessionSummary[]): string[] {
  const connected = sessions.filter((session) => session.connected && session.browser);
  return [...new Set(connected.map((session) => session.browser!))].filter(
    (browser) => new Set(connected.filter((session) => session.browser === browser).map((session) => session.source)).size > 1,
  );
}

async function showBrowsers(): Promise<void> {
  const lock = await probeExisting();
  let sessions: SessionSummary[] = [];
  if (lock) {
    const bridge = await RemoteBridge.connect(lock.port, lock.token);
    sessions = await bridge.sessions();
    await bridge.close();
  }
  const rows = browserRows(sessions, locateBrowsers(), pkg.version);
  if (wantsJson) {
    const dir = extensionDir(readAgentConfig().extensionDir);
    console.log(JSON.stringify({ running: !!lock, browsers: rows, unpacked: { dir, version: readStamp(dir)?.version ?? null } }, null, 2));
    return;
  }
  const shown = rows.filter((row) => row.installed || row.sessions.length);
  if (!shown.length) console.log('No supported browser found. Chrome, Edge, Brave, Arc, Vivaldi, Opera and Firefox all work.');
  for (const row of shown) {
    const state = row.connected ? 'connected' : row.sessions.length ? 'paired, not connected' : 'not added';
    console.log(`${row.connected ? '●' : '○'} ${row.label.padEnd(9)} ${row.store.padEnd(17)} ${state}`);
  }
  if (!lock) console.log('\nThe Bridge is not running, so which are connected is unknown.');
  console.log('\nAdd the extension to one with "browsentic setup --browser <name>".');
}

// Stops what is *answering*, not what the lockfile claims. A daemon outlives a deleted
// ~/.browsentic and goes on holding its port, and that orphan is the one people hit.
async function stop(): Promise<void> {
  const { stopped, stubborn } = await stopDaemons();
  for (const daemon of stopped) console.log(`Stopped the Bridge (pid ${daemon.pid}) on 127.0.0.1:${daemon.port}.`);
  for (const daemon of stubborn) {
    console.error(`The Bridge (pid ${daemon.pid}) on 127.0.0.1:${daemon.port} would not exit — kill it by hand.`);
  }
  if (!stopped.length && !stubborn.length) console.log('The Bridge is not answering; nothing to stop.');
  console.log('A paired browser leaves it stopped until "browsentic start", or an MCP client, starts it again.');
  if (stubborn.length) process.exitCode = 1;
}

async function start(): Promise<void> {
  const lock = await ensureDaemon();
  console.log(`Browsentic Bridge running on 127.0.0.1:${lock.port} (pid ${lock.pid}, v${lock.daemonVersion}).`);
}

async function restart(): Promise<void> {
  const { stubborn } = await stopDaemons();
  if (stubborn.length) {
    console.error(`The Bridge (pid ${stubborn[0].pid}) is still exiting — try again in a moment.`);
    process.exit(1);
  }
  const fresh = await ensureDaemon();
  console.log(`Browsentic Bridge running on 127.0.0.1:${fresh.port} (pid ${fresh.pid}, v${fresh.daemonVersion}).`);
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
  if (!lock) return console.error('No lockfile yet — start the Bridge first ("browsentic start").');
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

/** What setup was asked to put where. No browser at all means print the plan and stop. */
interface Choice {
  /** Absent for "another browser", which is only ever loaded unpacked. */
  browser?: BrowserId;
  unpacked: boolean;
}

/**
 * Brings Browsentic Bridge up, then gets the extension into a browser and pairs the two. On a
 * terminal it asks which browser and waits for it to connect; told the browser, it skips the
 * question; with neither it prints the plan, so a script, the release's smoke test or an app
 * never sits on a question nobody can answer.
 */
async function setup(argv: string[]): Promise<void> {
  const flag = (name: string) => argv.includes(`--${name}`);
  const valueOf = (name: string) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };

  // A stale command installs a stale Bridge, silently, and under npx it will keep doing so for as
  // long as the cache lives — which is what makes `update` look like it does nothing. Replace the
  // command first and let the fresh one do the rest.
  if (!flag('no-self-update')) {
    const code = await upgradeCli(pkg.version, process.argv.slice(2));
    if (code !== null) process.exit(code);
  }

  const named = valueOf('browser');
  if (named !== undefined && !isBrowserId(named)) {
    console.error(`Unknown browser "${named}". Pick one of: ${BROWSER_IDS.join(', ')}`);
    process.exit(1);
  }
  const json = flag('json');
  const interactive = !json && !named && !flag('unpacked') && !flag('no-pair') && !!process.stdin.isTTY && !!process.stdout.isTTY;

  // An explicit --dir is remembered, so `update` lands in the same place rather than laying down a
  // second copy at the default path and leaving the browser pointed at the first.
  const chosenDir = valueOf('dir');
  if (chosenDir) rememberExtensionDir(chosenDir);
  const dir = extensionDir(chosenDir ?? readAgentConfig().extensionDir);

  // Restart first, then read the lockfile. A daemon that keeps running holds the previous build's
  // action registry in memory, and reading the lock before the restart reports a pid that is gone.
  if (flag('restart')) await restart();
  const lock = await ensureDaemon();
  const wake = installNativeHost(fileURLToPath(import.meta.url));
  const bridge = await RemoteBridge.connect(lock.port, lock.token);
  try {
    const since = new Date().toISOString();
    const located = locateBrowsers();
    const sessions = await bridge.sessions();
    const rows = browserRows(sessions, located, pkg.version);

    if (!json) {
      console.log(`\n  Browsentic ${pkg.version} — your browser's superpower\n`);
      console.log(`  ✓ Browsentic Bridge  running on 127.0.0.1:${lock.port} (pid ${lock.pid})`);
      console.log(`  ${wakeLine(wake.browsers)}`);
      for (const line of agentLines(await bridge.agent())) console.log(`  ${line}`);
      console.log();
    }

    const choice: Choice | null = flag('unpacked')
      ? { browser: named, unpacked: true }
      : named
        ? { browser: named, unpacked: false }
        : interactive
          ? await ask(rows)
          : null;

    // Written for whoever loads it unpacked, and kept current for whoever already does.
    const folder = choice?.unpacked || readStamp(dir) ? writeExtension(dir, flag('force')) : null;

    const row = choice?.browser ? rows.find((candidate) => candidate.id === choice.browser) : undefined;
    const settled = row?.sessions.find((session) => session.connected && (session.source === 'unpacked') === choice!.unpacked);
    const code = flag('no-pair') || settled ? undefined : await bridge.pair();
    const found = row && located.find((candidate) => candidate.id === row.id);
    const opened = !!(row && found && !choice!.unpacked && !settled && !flag('no-open'));
    if (opened) openPage(row!.storeUrl, found);

    if (json) {
      console.log(
        JSON.stringify(
          {
            version: pkg.version,
            daemon: { port: lock.port, pid: lock.pid },
            nativeHost: wake,
            extensionDir: folder ? dir : null,
            unpacked: folder && { version: folder.version, changed: folder.changed, alreadyCurrent: folder.alreadyCurrent },
            alreadyPaired: sessions.length > 0,
            chosen: row ? { id: row.id, unpacked: choice!.unpacked, opened, connected: !!settled } : null,
            pairingCode: code?.code,
            expiresAt: code?.expiresAt,
            browsers: rows,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (folder) {
      const state = folder.alreadyCurrent ? 'already current' : `${folder.changed} file(s) written`;
      console.log(`  ✓ Unpacked copy      ${dir}, ${state}\n`);
    }

    if (!choice) return printPlan(rows, sessions, folder?.version, code);
    if (settled) {
      console.log(`  ${row!.label} is already connected: Browsentic ${settled.extensionVersion} from the ${SOURCE_LABEL[settled.source ?? 'unpacked']}.`);
      console.log(choice.unpacked ? `  Press ↻ on its card at ${row!.extensionsPage} to load this build.\n` : '  Nothing to do.\n');
      return;
    }

    if (choice.unpacked) printUnpackedSteps(dir, row, code);
    else await printStoreSteps(row!, opened, code);
    if (!code || flag('no-wait')) return;

    const joined = await waitForBrowser(bridge, since, row?.label ?? 'your browser');
    if (joined) {
      const panel = browserOf(joined.browser) === 'firefox' ? 'sidebar' : 'side panel';
      console.log(`  ✓ ${joined.browser ?? 'Your browser'} is connected: Browsentic ${joined.extensionVersion} from the ${SOURCE_LABEL[joined.source ?? 'unpacked']}.`);
      console.log(`    Open the ${panel} from the toolbar and tell it what to do.\n`);
    } else {
      const until = new Date(code.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      console.log(`  · Not connected yet. Once Browsentic is in ${row?.label ?? 'your browser'}, click it in the toolbar and`);
      console.log(`    enter the code (it works until ${until}), or get a new one with "browsentic pair".\n`);
    }
  } finally {
    await bridge.close();
  }
}

function wakeLine(browsers: string[]): string {
  return browsers.length
    ? `✓ Wake-up            ${browsers.join(', ')} can start the Bridge when it is down`
    : '· Wake-up            no supported browser found, so start the Bridge yourself after a reboot';
}

function agentLines(state: AgentState): string[] {
  const ready = state.runners.filter((runner) => runner.ready).map((runner) => runner.kind);
  const active = AGENTS[state.active].label;
  if (ready.includes(state.active)) {
    const others = ready.filter((kind) => kind !== state.active).map((kind) => AGENTS[kind].label);
    return [`✓ Agent              ${active}${others.length ? ` · also ready: ${others.join(', ')}` : ''}`];
  }
  if (ready.length) {
    return [
      `· Agent              the side panel is set to ${active}, which is not ready. ${AGENTS[ready[0]].label} is:`,
      `                     switch with "browsentic agent ${ready[0]}"`,
    ];
  }
  return [
    '· Agent              none ready yet. The side panel runs an agent CLI you are signed in to:',
    `                       ${AGENTS.claude.install.padEnd(38)} then run "claude" once to sign in`,
    `                       ${AGENTS.codex.install.padEnd(38)} then run "codex" once to sign in`,
    `                     Every agent it works with: ${AGENTS_GUIDE}`,
  ];
}

async function ask(rows: BrowserRow[]): Promise<Choice | null> {
  const offered = rows.filter((row) => row.installed || row.sessions.length);
  const listed = offered.length ? offered : rows.filter((row) => USUAL_BROWSERS.includes(row.id));
  console.log('  Which browser should get the extension?\n');
  listed.forEach((row, index) => {
    const where = row.source === 'firefox' ? 'signed add-on' : row.store;
    const state = row.connected ? 'connected' : row.installed ? '' : 'not found';
    console.log(`    ${String(index + 1).padStart(2)}  ${row.label.padEnd(9)} ${where.padEnd(17)} ${state}`.trimEnd());
  });
  const another = listed.length + 1;
  console.log(`    ${String(another).padStart(2)}  Another browser: load it unpacked\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question('  › ')).trim().toLowerCase();
      const picked = Number(answer || '1');
      if (picked === another || answer === 'unpacked') return { unpacked: true };
      const row = listed[picked - 1] ?? rows.find((candidate) => candidate.id === answer);
      if (row) return { browser: row.id, unpacked: false };
      console.log(`  Type a number from 1 to ${another}.`);
    }
  } finally {
    rl.close();
    console.log();
  }
}

function writeExtension(dir: string, force: boolean) {
  try {
    return install(dir, force);
  } catch (error) {
    if (!(error instanceof InstallError)) throw error;
    console.error(`\n  ${error.message}`);
    if (error.hint) console.error(`  ${error.hint}`);
    console.error();
    process.exit(1);
  }
}

function codeLines(code: { code: string } | undefined): string[] {
  return code
    ? [`enter this code:  ${groupCode(code.code)}`, 'It works once and expires in 10 minutes. Need another? "browsentic pair"']
    : ['enter a code from "browsentic pair".'];
}

async function printStoreSteps(row: BrowserRow, opened: boolean, code?: { code: string }): Promise<void> {
  console.log(opened ? `  Opening the ${row.store} in ${row.label}:` : `  Open this page in ${row.label}:`);
  console.log(`    ${row.storeUrl}\n`);
  if (row.id === 'firefox' && (await signedAddonAttached(pkg.version)) === false) {
    console.log(`  That file is not attached to the ${pkg.version} release yet: Mozilla may still be signing it.`);
    console.log(`  Give it a few minutes, or take the newest one from ${RELEASES_PAGE}\n`);
  }
  if (row.sessions.some((session) => session.connected && session.source === 'unpacked')) {
    console.log(`  ${row.label} already runs an unpacked copy. Remove it at ${row.extensionsPage} first, or both will answer.\n`);
  }
  const [enter, ...rest] = codeLines(code);
  const steps = [...row.steps, `Click Browsentic in the toolbar (the puzzle piece lists it; pin it there) and ${enter}`];
  steps.forEach((step, index) => console.log(`    ${index + 1}. ${step}`));
  for (const line of rest) console.log(`       ${line}`);
  console.log();
}

function printUnpackedSteps(dir: string, row: BrowserRow | undefined, code?: { code: string }): void {
  const [enter, ...rest] = codeLines(code);
  console.log(`  Load it unpacked in ${row?.label ?? 'your browser'}:\n`);
  console.log(`    1. Open ${row?.extensionsPage ?? 'its extensions page (chrome://extensions)'} and turn on Developer mode.`);
  console.log(`    2. Press “Load unpacked” and choose:\n`);
  console.log(`         ${dir}\n`);
  // Browsers refuse their own pages given on the command line, so there is no opening this for
  // them. The folder picker shortcut is the next best thing, and it is where people stall.
  const picker = FOLDER_PICKER[process.platform];
  if (picker) console.log(`       ${picker}`);
  console.log(`    3. Click Browsentic in the toolbar and ${enter}`);
  for (const line of rest) console.log(`       ${line}`);
  console.log();
}

/**
 * Nobody to ask. Someone already set up hears what an update leaves them to do; anyone else, where
 * each browser gets the extension, with the choosing left to them.
 */
function printPlan(rows: BrowserRow[], sessions: SessionSummary[], folderVersion?: string, code?: { code: string }): void {
  if (sessions.length) {
    const stale = sessions.filter((session) => session.source === 'unpacked' && folderVersion && session.extensionVersion !== folderVersion);
    const pages = new Set(stale.map((session) => BROWSERS[browserOf(session.browser) ?? 'chrome'].extensionsPage));
    if (sessions.some((session) => session.source !== 'unpacked')) console.log('  Store copies update themselves.');
    for (const page of pages) console.log(`  Press ↻ on the unpacked Browsentic card at ${page} to load this build.`);
    console.log(`  Adding another browser? "browsentic setup --browser <name>"\n`);
    return;
  }
  console.log('  Next, add the extension to your browser:\n');
  const chromeWebStore = rows.filter((row) => row.source === 'chrome-web-store').map((row) => row.label);
  const store = (id: BrowserId) => rows.find((row) => row.id === id)!;
  console.log(`    ${chromeWebStore.join(', ')}`);
  console.log(`      ${store('chrome').storeUrl}`);
  console.log(`    Edge`);
  console.log(`      ${store('edge').storeUrl}`);
  console.log(`    Firefox`);
  console.log(`      ${store('firefox').storeUrl}\n`);
  const [enter, ...rest] = codeLines(code);
  console.log(`  Then click Browsentic in the toolbar and ${enter}`);
  for (const line of rest) console.log(`  ${line}`);
  console.log(`  On a terminal, "browsentic setup" asks which browser and walks you through it.\n`);
}

async function waitForBrowser(bridge: RemoteBridge, since: string, label: string): Promise<SessionSummary | null> {
  const line = `Waiting for ${label} to connect…  (Ctrl-C stops waiting; nothing is undone)`;
  const spin = !!process.stdout.isTTY;
  if (!spin) console.log(`  ${line}`);
  const deadline = Date.now() + WAIT_MS;
  for (let tick = 0; Date.now() < deadline; tick++) {
    if (tick % 8 === 0) {
      const joined = (await bridge.sessions()).find((session) => session.connected && session.pairedAt >= since);
      if (joined) {
        if (spin) process.stdout.write('\r\x1b[2K');
        return joined;
      }
    }
    if (spin) process.stdout.write(`\r  ${SPINNER[tick % SPINNER.length]} ${line}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (spin) process.stdout.write('\r\x1b[2K');
  return null;
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
  for (const daemon of daemons) console.log(`    Bridge      127.0.0.1:${daemon.port}, pid ${daemon.pid}`);
  const waking = registeredBrowsers();
  if (waking.length) console.log(`    wake-up     the native host registered with ${waking.join(', ')}`);
  for (const removal of plan.removals) {
    console.log(`    ${removal.label.padEnd(11)} ${removal.path}`);
    console.log(`                ${removal.holds}${removal.keep ? ' — keeping skills/' : ''}`);
    if (removal.inUse) console.log(`                keeping ${removal.inUse}/, which holds the Node this runs on`);
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
  console.log('    Browsentic in each browser: right-click its toolbar icon and choose Remove.');
  console.log('    That is also what clears recordings and held secrets, which live in the');
  console.log('    extension’s storage rather than on disk. Remove an unpacked copy first:');
  console.log('    take its folder away while it is loaded and the browser holds a broken one.');
  if (kind === 'global') console.log('\n    the command itself:  npm rm -g browsentic');
  if (kind === 'repo') console.log('\n    the global link:     yarn daemon:unlink');
  if (kind === 'app') console.log(`\n    the app itself:      ${APP_REMOVAL[process.platform === 'win32' ? 'win32' : 'darwin']}`);
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
      console.log('  · Unpair     skipped, the Bridge did not answer');
    }
  }

  // Before the daemon goes, or a browser that sees it go could have the host start another.
  const unregistered = removeNativeHost();
  if (unregistered.length) console.log(`  ✓ Wake-up    unregistered from ${unregistered.length} place${unregistered.length === 1 ? '' : 's'}`);

  const { stopped, stubborn } = await stopDaemons();
  if (stopped.length) console.log(`  ✓ Bridge     stopped (pid ${stopped.map((daemon) => daemon.pid).join(', ')})`);
  for (const daemon of stubborn) console.log(`  ✗ Bridge     pid ${daemon.pid} would not exit — kill it by hand`);

  for (const outcome of removeAll(plan.removals)) {
    if (!outcome.removed) console.log(`  ✗ ${outcome.removal.path} — ${outcome.error}`);
    else if (outcome.kept.length) console.log(`  ✓ Emptied    ${outcome.removal.path} — kept ${outcome.kept.map((entry) => `${entry}/`).join(', ')}`);
    else console.log(`  ✓ Removed    ${outcome.removal.path}`);
  }

  // Last, because it deletes the directory this process is running out of.
  for (const purge of purgeNpxCache(plan.npx)) {
    if (purge.removed) console.log(`  ✓ Cleared    ${purge.entry.dir}`);
    else console.log(`  ✗ ${purge.entry.dir} — ${purge.error}`);
  }

  console.log('\n  Done. Remove Browsentic from your browsers if you have not.\n');
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
    console.log(
      `    ${SOURCE_LABEL[session.source ?? 'unpacked']} (${session.origin}), extension v${session.extensionVersion}, paired ${session.pairedAt}, last seen ${session.lastSeenAt}`,
    );
  }
}

async function chooseAgent(first?: string, second?: string, third?: string): Promise<void> {
  if (first === 'model') {
    if (!isAgentKind(second)) {
      console.error(`Name the agent whose model to set. Pick one of: ${AGENT_KINDS.join(', ')}`);
      process.exit(1);
    }
    if (!writeAgentModel(second, third ?? null)) {
      console.error(`"${third}" is not a model id: it has to start with a letter or digit and hold no spaces.`);
      process.exit(1);
    }
    first = second = undefined;
  }
  if (first === 'models') return listModels(second);

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
    if (runner.ready && runner.models) console.log(`    models: ${modelSource(runner.kind, runner.models)}`);
    if (runner.problem) {
      console.log(`    ${runner.problem.message}`);
      if (runner.problem.fix) console.log(`    ${runner.problem.fix}`);
      if (runner.problem.grantable) console.log(`    Fix it with "browsentic agent fix ${runner.kind}".`);
    }
  }
  console.log(`\nThe side panel runs on ${AGENTS[state.active].label}.`);
}

async function listModels(named?: string): Promise<void> {
  if (!isAgentKind(named)) {
    console.error(`Name the agent whose models to list. Pick one of: ${AGENT_KINDS.join(', ')}`);
    process.exit(1);
  }
  const bridge = await connect();
  const state = await bridge.agent(process.argv.includes('--refresh') ? { models: named } : undefined);
  await bridge.close();

  const runner = state.runners.find((status) => status.kind === named);
  const models: ModelList = runner?.models ?? { ids: AGENTS[named].models, from: 'catalog' };
  if (wantsJson) {
    console.log(JSON.stringify({ agent: named, model: runner?.model ?? null, ...models }, null, 2));
    return;
  }
  for (const id of models.ids) console.log(`${id === runner?.model ? '●' : ' '} ${id}`);
  if (runner?.model && !models.ids.includes(runner.model)) console.log(`● ${runner.model}  (pinned, not listed)`);
  console.log(`\n${modelSource(named, models)}`);
}

function modelSource(kind: AgentKind, models: ModelList): string {
  const source =
    models.from === 'cli' && models.at !== undefined
      ? `${models.ids.length} listed by ${AGENTS[kind].bin}, ${formatWhen(models.at)}`
      : `Browsentic's built-in list of ${models.ids.length}`;
  return models.error ? `${source}. The last read failed: ${models.error}` : `${source}.`;
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

function manageTasks(sub?: string, id?: string): void {
  const now = Date.now();
  if (sub === 'pause' || sub === 'resume') {
    const enabled = sub === 'resume';
    if (!id) {
      updateSchedules((state) => setPaused(state, !enabled, now));
      console.log(enabled ? 'Scheduled tasks resumed.' : 'Every scheduled task is paused. "browsentic tasks resume" starts them again.');
      return;
    }
    const name = updateSchedules((state) => {
      const task = findTask(state, id);
      if (task) setEnabled(task, enabled, now);
      return task?.name;
    });
    if (!name) return noSuchTask(id);
    console.log(`${enabled ? 'Resumed' : 'Paused'} “${name}”.`);
    return;
  }
  if (sub === 'delete') {
    const name = id
      ? updateSchedules((state) => {
          const task = findTask(state, id);
          state.tasks = state.tasks.filter((kept) => kept !== task);
          return task?.name;
        })
      : undefined;
    if (!name) return noSuchTask(id);
    console.log(`Deleted “${name}”.`);
    return;
  }
  if (sub) {
    console.log(`Unknown command "tasks ${sub}". Use "tasks", "tasks pause|resume [id]" or "tasks delete <id>".`);
    process.exitCode = 1;
    return;
  }

  const { paused, tasks } = readSchedules();
  if (wantsJson) {
    console.log(JSON.stringify({ paused, tasks }, null, 2));
    return;
  }
  if (!tasks.length) {
    console.log('No scheduled tasks. Create one from the Schedules tab in the side panel.');
    return;
  }
  console.log(`${tasks.length} scheduled task${tasks.length === 1 ? '' : 's'}${paused ? ' — all paused' : ''}:\n`);
  for (const task of tasks) {
    const when = !task.enabled
      ? 'paused'
      : task.nextRunAt === null
        ? 'no more runs'
        : task.nextRunAt <= now && !paused
          ? `due ${describeMoment(task.nextRunAt)}, waiting for a browser`
          : `next ${describeMoment(task.nextRunAt)}`;
    console.log(`  ${task.id.slice(0, 8)}  ${task.name.slice(0, 28).padEnd(28)} ${describeRule(task.rule).padEnd(30)} ${when}`);
    const [last] = task.runs;
    if (last) console.log(`            last: ${last.outcome}${last.headline || last.reason ? ` — ${last.headline ?? last.reason}` : ''}`);
  }
  console.log('\nPause one with "browsentic tasks pause <id>", or all of them with "tasks pause". An id prefix is enough.');
}

function noSuchTask(id?: string): void {
  console.log(id ? `No task matches "${id}". "browsentic tasks" lists them with their ids.` : 'Say which task — "browsentic tasks" lists their ids.');
  process.exitCode = 1;
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
