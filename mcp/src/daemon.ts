import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DAEMON_PORTS,
  EXTERNAL_RUN_ID,
  SOCKET_PROTOCOL_VERSION,
  failure,
  parseFrame,
  success,
  type ActionResult,
  type RunEvent,
  type SocketFrame,
} from '@/lib/actions/protocol';
import type { GuardrailSettings } from '@/lib/settings/guardrails';
import { hashManifest } from '@/lib/actions/manifest';
import { describeActions } from '@/lib/actions/registry';
import { RESERVED_PREFIX } from '@/lib/actions/reserved';
import { AGENTS, isAgentKind, type AgentState } from '@/lib/agents/catalog';
import { saveScreenshot } from './screenshots';
import {
  clientProof,
  isNonce,
  newNonce,
  pairingSecret,
  sameProof,
  sealSessionKey,
  serverProof,
  type Transcript,
} from '@/lib/actions/handshake';
import {
  consumePairing,
  createPairing,
  createSession,
  hasPendingPairing,
  listSessions,
  pendingPairings,
  revokeSessions,
  sessionFor,
  touchSession,
} from './auth-store';
import { AgentSession } from './agent/service';
import { summarizeFile } from './agent/analyze';
import { analyzeRecording } from './agent/recording';
import { nameSession } from './agent/title';
import { configPath, readAgentConfig, writeActiveAgent, writeGuardrailSetting } from './agent/config';
import { agentState, grantRunner } from './agent/runners';
import { deleteSiteMap, deleteSkill, saveSkill } from './agent/skill-store';
import { commitStaging, discardStaging } from './agent/site-map-store';
import type { Bridge, BridgeStatus, ControlMessage, ControlRequest, SessionSummary } from './control';
import { ExtensionLink } from './extension-link';
import {
  ANYWHERE,
  blocked,
  decide,
  describe as describeDecision,
  guardrailSettings,
  policyFrom,
  sealSecrets,
  settingWritable,
  summary as summarizeDecision,
} from './guardrails';
import { log } from './log';
import { readLockfile, writeLockfile, clearLockfile, type Lockfile } from './lockfile';

type AgentFrame = Extract<SocketFrame, { t: 'agentState' | 'setAgent' | 'grantAgent' }>;
type GuardrailFrame = Extract<SocketFrame, { t: 'guardrails' | 'setGuardrail' }>;

const IDLE_EXIT_MS = 30 * 60 * 1000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//;
const LOOPBACK_HOST = /^(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/i;

export interface DaemonOptions {
  version: string;
  idleExit?: boolean;
}

export interface Daemon extends Bridge {
  port: number;
  stop(): Promise<void>;
}

function persistScreenshot(
  action: string,
  input: unknown,
  result: ActionResult,
  saveTo?: { dir: string; filename: string },
): ActionResult {
  if (action !== 'page.screenshot' || !result.ok) return result;
  const args = (input ?? {}) as { save?: unknown; filename?: unknown };
  const data = result.data as { dataUrl?: unknown } | null;
  if ((args.save !== true && !saveTo) || typeof data?.dataUrl !== 'string') return result;
  try {
    const savedTo = saveScreenshot(data.dataUrl, {
      dir: saveTo?.dir,
      filename: saveTo?.filename ?? (typeof args.filename === 'string' ? args.filename : undefined),
    });
    log(`screenshot saved to ${savedTo}`);
    return { ok: true, data: { ...(result.data as object), savedTo } };
  } catch (error) {
    const saveError = error instanceof Error ? error.message : String(error);
    log(`screenshot save failed: ${saveError}`);
    return { ok: true, data: { ...(result.data as object), saveError } };
  }
}

export async function startDaemon({ version, idleExit = true }: DaemonOptions): Promise<Daemon> {
  const bundled = describeActions();
  const bundledHash = hashManifest(bundled);

  let tools = bundled;
  let manifestInSync = true;
  let link: ExtensionLink | null = null;
  let agent: AgentSession | null = null;
  const controls = new Set<WebSocket>();
  let controlSeq = 0;
  const manifestListeners = new Set<() => void>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const lock: Lockfile = {
    pid: process.pid,
    port: 0,
    // Fresh per daemon, so a token that leaked once does not stay valid for every future daemon.
    token: randomBytes(24).toString('base64url'),
    protocolVersion: SOCKET_PROTOCOL_VERSION,
    daemonVersion: version,
  };

  const http = createServer((req, res) => {
    if (!fromLoopback(req)) {
      res.writeHead(403).end();
      return;
    }
    if (req.url?.startsWith('/health')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid: process.pid, version, connected: !!link?.isOpen }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    const role = authorize(req);
    if (!role) return refuseUpgrade(socket, 'unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (role === 'extension') acceptExtension(ws, req);
      else acceptControl(ws);
    });
  });

  const port = await listen(http);
  lock.port = port;
  writeLockfile(lock);
  log(`daemon ${version} listening on 127.0.0.1:${port} (pid ${process.pid})`);
  scheduleIdleExit();

  function authorize(req: IncomingMessage): 'extension' | 'control' | null {
    if (!fromLoopback(req)) {
      log(`rejected host ${req.headers.host}`);
      return null;
    }
    const origin = req.headers.origin;
    if (origin && EXTENSION_ORIGIN.test(origin)) return 'extension';
    if (origin) {
      log(`rejected web origin ${origin}`);
      return null;
    }
    if (!hasValidToken(req)) {
      log('rejected control client: missing or invalid token');
      return null;
    }
    return 'control';
  }

  function hasValidToken(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const offered = Buffer.from(header.replace(/^Bearer\s+/i, ''));
    const expected = Buffer.from(lock.token);
    return offered.length === expected.length && timingSafeEqual(offered, expected);
  }

  function acceptExtension(ws: WebSocket, req: IncomingMessage): void {
    void greet(ws, req).catch((error) => {
      log('extension handshake failed', error);
      ws.close(1011, 'handshake failed');
    });
  }

  async function greet(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const reject = (reason: string, retryable: boolean) => {
      log(`rejected extension: ${reason}`);
      try {
        ws.send(JSON.stringify({ t: 'unauthorized', reason, retryable }));
      } catch {
      }
      ws.close(4401, 'unauthorized');
    };

    const hello = await nextFrame(ws);
    if (hello?.t !== 'hello') {
      log('extension sent no hello frame; closing');
      ws.close(1002, 'expected hello');
      return;
    }
    if (hello.protocolVersion !== SOCKET_PROTOCOL_VERSION) {
      log(`extension protocol v${hello.protocolVersion} != daemon v${SOCKET_PROTOCOL_VERSION}; closing`);
      ws.close(1002, `protocol version mismatch: daemon speaks v${SOCKET_PROTOCOL_VERSION}`);
      return;
    }
    if (!isNonce(hello.nonce)) {
      log('extension hello carried no nonce; closing');
      ws.close(1002, 'expected a nonce');
      return;
    }

    const transcript: Transcript = {
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      extensionVersion: hello.extensionVersion,
      manifestHash: hello.manifestHash,
      clientNonce: hello.nonce,
      serverNonce: newNonce(),
    };
    ws.send(JSON.stringify({ t: 'challenge', nonce: transcript.serverNonce }));

    const proven = await nextFrame(ws);
    if (proven?.t !== 'prove') {
      log('extension sent no proof; closing');
      ws.close(1002, 'expected a proof');
      return;
    }

    const origin = req.headers.origin!;
    let secret: string;
    let sealedSessionKey: string | undefined;
    if (hello.auth?.kind === 'pair') {
      const matched = await matchPairing(proven.proof, transcript);
      if (!matched) {
        return reject('That pairing code is wrong or expired. Run "browsentic-mcp pair" for a new one.', true);
      }
      consumePairing(matched.code);
      secret = matched.secret;
      const session = createSession(origin, hello.extensionVersion);
      sealedSessionKey = await sealSessionKey(secret, transcript, session.key);
      log(`paired ${origin} (extension ${hello.extensionVersion})`);
    } else if (hello.auth?.kind === 'session') {
      const session = sessionFor(origin);
      if (!session || !sameProof(proven.proof, await clientProof(session.key, transcript))) {
        return reject('This browser is no longer paired. Run "browsentic-mcp pair" to pair again.', false);
      }
      touchSession(origin);
      secret = session.key;
    } else {
      return reject('That hello named no credential to prove.', false);
    }

    await settle(ws, hello, origin, transcript, secret, sealedSessionKey);
  }

  async function matchPairing(
    proof: unknown,
    transcript: Transcript,
  ): Promise<{ code: string; secret: string } | null> {
    for (const code of pendingPairings()) {
      const secret = await pairingSecret(code, transcript);
      if (sameProof(proof, await clientProof(secret, transcript))) return { code, secret };
    }
    return null;
  }

  async function settle(
    ws: WebSocket,
    hello: Extract<SocketFrame, { t: 'hello' }>,
    origin: string,
    transcript: Transcript,
    secret: string,
    sealedSessionKey?: string,
  ): Promise<void> {
    link?.close('superseded by a newer connection');
    agent?.dispose();
    manifestInSync = hello.manifestHash === bundledHash;
    const accepted = new ExtensionLink(
      ws,
      { ...hello, origin },
      (closing) => {
        if (link !== closing) return;
        link = null;
        agent?.dispose();
        agent = null;
        log('extension disconnected');
        scheduleIdleExit();
      },
      (request, source) => {
        if (request.t === 'analyzeFile') {
          void summarizeFile(request, readAgentConfig())
            .then((result) => source.send({ t: 'fileSummary', id: request.id, result }))
            .catch((error) =>
              source.send({ t: 'fileSummary', id: request.id, result: failure('AGENT_FAILED', String(error)) }),
            );
          return;
        }
        if (request.t === 'nameSession') {
          void nameSession(request, readAgentConfig())
            .then((result) => source.send({ t: 'sessionName', id: request.id, result }))
            .catch((error) =>
              source.send({ t: 'sessionName', id: request.id, result: failure('AGENT_FAILED', String(error)) }),
            );
          return;
        }
        if (request.t === 'analyzeRecording') {
          void analyzeRecording(request, readAgentConfig())
            .then((result) => source.send({ t: 'recordingWorkflow', id: request.id, result }))
            .catch((error) =>
              source.send({
                t: 'recordingWorkflow',
                id: request.id,
                result: failure('AGENT_FAILED', String(error)),
              }),
            );
          return;
        }
        if (request.t === 'agentState' || request.t === 'setAgent' || request.t === 'grantAgent') {
          void settleAgent(request).then((state) =>
            source.send({ t: 'agentInfo', id: request.id, result: state }),
          );
          return;
        }
        if (request.t === 'guardrails' || request.t === 'setGuardrail') {
          return source.send({ t: 'guardrailInfo', id: request.id, result: settleGuardrail(request) });
        }
        if (request.t === 'saveSkill') {
          return source.send({ t: 'skillResult', id: request.id, result: saveSkill(request.skill) });
        }
        if (request.t === 'deleteSkill') {
          return source.send({ t: 'skillResult', id: request.id, result: deleteSkill(request.name) });
        }
        if (request.t === 'deleteSiteMap') {
          return source.send({ t: 'skillResult', id: request.id, result: deleteSiteMap(request.name) });
        }
        if (request.t === 'activateSiteMap') {
          const result = commitStaging(request.stagingId, request.exactHost === true);
          return source.send({
            t: 'skillResult',
            id: request.id,
            result: result.ok ? { ok: true, data: { name: result.data.name, path: result.data.path } } : result,
          });
        }
        if (request.t === 'discardSiteMap') {
          return source.send({ t: 'skillResult', id: request.id, result: discardStaging(request.stagingId) });
        }
        session(source).handle(request);
      },
    );
    link = accepted;
    log(`extension ${hello.extensionVersion} connected from ${origin} (manifest ${manifestInSync ? 'in sync' : 'DRIFTED'})`);
    const welcome = { daemonVersion: version, manifestHash: bundledHash, manifestInSync, sealedSessionKey };
    accepted.send({ t: 'welcome', ...welcome, proof: await serverProof(secret, transcript, welcome) });
    scheduleIdleExit();
    void pushAgentState(accepted);
    if (manifestInSync) restoreBundledManifest();
    else await adoptExtensionManifest(accepted);
  }

  async function settleAgent(request: AgentFrame): Promise<ActionResult<AgentState>> {
    if (request.t !== 'agentState' && !isAgentKind(request.agent)) {
      return failure('INVALID_INPUT', `"${String(request.agent)}" is not an agent Browsentic knows.`);
    }
    if (request.t === 'setAgent') {
      writeActiveAgent(request.agent);
      // The held conversation belongs to the agent that just left; the next turn starts fresh.
      agent?.handle({ t: 'reset' });
      log(`agent set to ${AGENTS[request.agent].label}`);
    }
    if (request.t === 'grantAgent') await grantRunner(request.agent);
    const refresh = request.t !== 'agentState' || request.refresh === true;
    return success(await agentState(readAgentConfig(), { refresh }));
  }

  function settleGuardrail(request: GuardrailFrame): ActionResult<GuardrailSettings> {
    if (request.t === 'setGuardrail') {
      if (!settingWritable(request.setting, request.value)) {
        return failure(
          'INVALID_INPUT',
          `"${request.setting}" is not a guardrail the panel may set. Locked rules are edited in ${configPath}.`,
        );
      }
      writeGuardrailSetting(request.setting, request.value);
      log(`guardrail ${request.setting} → ${request.value === null ? 'default' : String(request.value)}`);
    }
    const config = readAgentConfig();
    return success(guardrailSettings(config.guardrails ?? {}, config.requireApproval, configPath));
  }

  async function pushAgentState(target: ExtensionLink): Promise<void> {
    const state = await agentState(readAgentConfig());
    if (target.isOpen) target.send({ t: 'agentInfo', id: '', result: success(state) });
  }

  function session(source: ExtensionLink): AgentSession {
    return (agent ??= new AgentSession({
      invoke,
      emit: (id, event) => source.send({ t: 'run', id, event }),
      draft: (id, draft) => source.send({ t: 'siteMapDraft', id, draft }),
    }));
  }

  async function adoptExtensionManifest(source: ExtensionLink): Promise<void> {
    const reported = await source.describe();
    if (!reported?.length) {
      log('extension manifest drifted but could not be fetched; keeping the bundled tool list');
      return;
    }
    tools = reported;
    log(`adopted ${reported.length} tools from the extension (bundled list was ${bundled.length})`);
    announceManifest();
  }

  // An adopted list outlives the connection that justified it, so a reloaded extension that
  // agrees with us again would otherwise keep being served the drifted list until the daemon
  // restarts — the recovery direction of "the newer side wins".
  function restoreBundledManifest(): void {
    if (tools === bundled) return;
    tools = bundled;
    log(`extension back in sync; serving the bundled ${bundled.length} tools again`);
    announceManifest();
  }

  function announceManifest(): void {
    for (const listener of manifestListeners) listener();
    broadcast({ event: 'manifest-changed' });
  }

  function acceptControl(ws: WebSocket): void {
    const client = `c${++controlSeq}`;
    controls.add(ws);
    scheduleIdleExit();
    ws.on('message', async (raw) => {
      let request: ControlRequest;
      try {
        request = JSON.parse(String(raw)) as ControlRequest;
      } catch {
        return log('dropped unparseable control frame');
      }
      if (request.op === 'describe') return send(ws, { id: request.id, op: 'describe', tools });
      if (request.op === 'status') return send(ws, { id: request.id, op: 'status', status: statusNow() });
      if (request.op === 'invoke') {
        let result: ActionResult;
        if (request.runId) {
          result =
            (await agent?.invokeForRun(request.runId, request.action, request.input)) ??
            failure('RUN_INACTIVE', 'This agent run is no longer active');
          if (!result.ok && result.error.code === 'RUN_INACTIVE') {
            log(`control ${client} invoked ${request.action} for inactive run ${request.runId}`);
          }
        } else {
          result = await invokeExternal(request.action, request.input, client);
        }
        return send(ws, { id: request.id, op: 'invoke', result });
      }
      if (request.op === 'pair') {
        const { code, expiresAt } = createPairing();
        log('minted a pairing code');
        return send(ws, { id: request.id, op: 'pair', code, expiresAt });
      }
      if (request.op === 'sessions') {
        return send(ws, { id: request.id, op: 'sessions', sessions: sessionSummaries() });
      }
      if (request.op === 'agent') {
        const changed = request.set ?? request.grant;
        if (changed && !isAgentKind(changed)) {
          return send(ws, { id: request.id, op: 'agent', state: await agentState(readAgentConfig()) });
        }
        if (request.set) {
          writeActiveAgent(request.set);
          agent?.handle({ t: 'reset' });
          log(`control ${client} set the agent to ${AGENTS[request.set].label}`);
        }
        if (request.grant) await grantRunner(request.grant);
        const state = await agentState(readAgentConfig(), { refresh: !!changed });
        if (changed && link?.isOpen) void pushAgentState(link);
        return send(ws, { id: request.id, op: 'agent', state });
      }
      if (request.op === 'revoke') {
        const target = request.origin;
        const revoked = revokeSessions((session) => !target || session.origin === target);
        if (revoked && link?.isOpen && (!target || link.origin === target)) {
          link.close('pairing revoked');
        }
        log(`revoked ${revoked} session(s)`);
        return send(ws, { id: request.id, op: 'revoke', revoked });
      }
    });
    const drop = () => {
      controls.delete(ws);
      scheduleIdleExit();
    };
    ws.on('close', drop);
    ws.on('error', drop);
  }

  function send(ws: WebSocket, message: ControlMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  function broadcast(message: ControlMessage): void {
    for (const ws of controls) send(ws, message);
  }

  function sessionSummaries(): SessionSummary[] {
    return listSessions().map(({ key: _key, ...session }) => ({
      ...session,
      connected: link?.isOpen === true && link.origin === session.origin,
    }));
  }

  function statusNow(): BridgeStatus {
    return {
      connected: !!link?.isOpen,
      daemonVersion: version,
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      port,
      manifestInSync,
      extensionVersion: link?.extensionVersion,
      pairedBrowsers: listSessions().length,
      pairingPending: hasPendingPairing(),
    };
  }

  async function invoke(
    action: string,
    input?: unknown,
    opts?: { saveTo?: { dir: string; filename: string }; tabId?: number; runId?: string },
  ) {
    if (action.startsWith(RESERVED_PREFIX)) {
      return failure('UNKNOWN_ACTION', `Unknown action "${action}".`);
    }
    if (!link?.isOpen) {
      return failure(
        'EXTENSION_OFFLINE',
        'The Browsentic extension is not connected — open your browser with the extension loaded, then retry',
      );
    }
    const result = await link.invoke(action, input, { tabId: opts?.tabId, runId: opts?.runId });
    return persistScreenshot(action, input, result, opts?.saveTo);
  }

  async function invokeExternal(action: string, input: unknown, client: string): Promise<ActionResult> {
    const target = link;
    const toolId = randomUUID();
    const tell = (event: RunEvent) => {
      if (target?.isOpen) target.send({ t: 'run', id: EXTERNAL_RUN_ID, event });
    };
    tell({ kind: 'tool', toolId, action, input, source: 'external' });

    // An external MCP client has no run and no approval channel, so it is unscoped and
    // its confirms resolve through the policy's `unattended` setting.
    const config = readAgentConfig();
    const decision = decide(
      { action, input, caller: 'external', scope: ANYWHERE },
      policyFrom(config.guardrails, config.requireApproval),
    );
    if (decision.effect === 'deny') {
      log(`external ${client} → ${action} blocked: ${describeDecision(decision)}`);
      tell({ kind: 'toolResult', toolId, ok: false, summary: `blocked: ${summarizeDecision(decision)}` });
      return blocked(decision);
    }
    if (decision.matched.length) {
      log(`external ${client} → ${action} waived: ${describeDecision(decision)}`);
    }

    const result = await invoke(action, input);
    log(`external ${client} → ${action} ${result.ok ? 'ok' : result.error.code}`);
    tell({
      kind: 'toolResult',
      toolId,
      ok: result.ok,
      summary: result.ok ? 'ok' : sealSecrets(`${result.error.code}: ${result.error.message}`),
    });
    return result;
  }

  function scheduleIdleExit(): void {
    if (idleTimer) clearTimeout(idleTimer);
    if (!idleExit) return;
    if (link?.isOpen || controls.size > 0) return;
    idleTimer = setTimeout(() => {
      if (link?.isOpen || controls.size > 0) return scheduleIdleExit();
      log('idle with no clients; exiting');
      void stop().then(() => process.exit(0));
    }, IDLE_EXIT_MS);
    idleTimer.unref();
  }

  async function stop(): Promise<void> {
    if (idleTimer) clearTimeout(idleTimer);
    agent?.dispose();
    link?.close('daemon shutting down');
    for (const ws of controls) ws.close(1001, 'daemon shutting down');
    wss.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    if (readLockfile()?.pid === process.pid) clearLockfile();
    log('daemon stopped');
  }

  return {
    port,
    describe: async () => tools,
    invoke,
    status: async () => statusNow(),
    onManifestChanged: (listener) => manifestListeners.add(listener),
    close: stop,
    stop,
  };
}

function listen(http: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const remaining = [...DAEMON_PORTS];
    const attempt = () => {
      const port = remaining.shift();
      if (port === undefined) {
        reject(new Error(`No free port in ${DAEMON_PORTS.join(', ')} — another process is using them all`));
        return;
      }
      const onListening = () => {
        http.removeListener('error', onError);
        resolve(port);
      };
      const onError = (error: NodeJS.ErrnoException) => {
        http.removeListener('listening', onListening);
        if (error.code !== 'EADDRINUSE') return reject(error);
        http.removeListener('error', onError);
        attempt();
      };
      http.once('error', onError);
      http.once('listening', onListening);
      http.listen(port, '127.0.0.1');
    };
    attempt();
  });
}

/**
 * A page rebound to 127.0.0.1 by its own DNS still arrives with the attacker's `Host`, so this is
 * the second lock on the door the `Origin` check already guards.
 */
function fromLoopback(req: IncomingMessage): boolean {
  return LOOPBACK_HOST.test(req.headers.host ?? '');
}

function nextFrame(ws: WebSocket): Promise<SocketFrame | null> {
  return new Promise((resolve) => {
    const settle = (frame: SocketFrame | null) => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(frame);
    };
    const onMessage = (raw: unknown) => settle(parseFrame(String(raw)));
    const timer = setTimeout(() => settle(null), HANDSHAKE_TIMEOUT_MS);
    ws.once('message', onMessage);
  });
}

function refuseUpgrade(socket: Duplex, reason: string): void {
  socket.write(`HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\nX-Browsentic-Reason: ${reason}\r\n\r\n`);
  socket.destroy();
}
