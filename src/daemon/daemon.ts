import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  EXTERNAL_RUN_ID,
  SOCKET_PROTOCOL_VERSION,
  failure,
  isInstallId,
  parseFrame,
  success,
  type ActionResult,
  type RunEvent,
  type SkillCatalog,
  type SocketFrame,
} from '@/lib/actions/protocol';
import type { GuardrailSettings } from '@/lib/settings/guardrails';
import { hashManifest, type ToolDescriptor } from '@/lib/actions/manifest';
import { solveCaptcha } from '@/lib/actions/page/solve-captcha';
import { describeActions } from '@/lib/actions/registry';
import { RESERVED_PREFIX } from '@/lib/actions/reserved';
import { AGENTS, isAgentKind, type AgentState } from '@/lib/agents/catalog';
import { saveScreenshot } from './screenshots';
import { adoptDownload, listDownloads, resolveAttachment, sweepDownloads, type CapturedItem } from './downloads';
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
  claimSession,
  consumePairing,
  createPairing,
  createSession,
  hasPendingPairing,
  listSessions,
  pendingPairings,
  revokeSessions,
  sessionCandidates,
  sessionId,
  type Install,
  type Session,
} from './auth-store';
import { AgentSession } from './agent/service';
import { solveCaptchaWithAnalyst } from './agent/captcha-solver';
import { FileAnalyses } from './agent/file-analyst';
import { analyzeRecording } from './agent/recording';
import { nameSession } from './agent/title';
import { configPath, readAgentConfig, writeActiveAgent, writeAgentModel, writeGuardrailSetting } from './agent/config';
import { agentSkills } from './agent/agent-skills';
import { agentState, grantRunner, refreshModelLists } from './agent/runners';
import { deleteSiteMap, deleteSkill, saveSkill } from './agent/skill-store';
import { loadSkills } from './agent/skills';
import { commitStaging, discardStaging } from './agent/site-map-store';
import type { Bridge, BridgeStatus, ControlMessage, ControlRequest, Described, SessionSummary } from './control';
import { ExtensionLink } from './extension-link';
import {
  ANYWHERE,
  INJECT_ACTION,
  RUN_CODE_ACTION,
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
import { daemonPorts } from './ports';

type AgentFrame = Extract<SocketFrame, { t: 'agentState' | 'setAgent' | 'setAgentModel' | 'grantAgent' }>;
type GuardrailFrame = Extract<SocketFrame, { t: 'guardrails' | 'setGuardrail' }>;

const IDLE_EXIT_MS = 30 * 60 * 1000;
const BINDING_IDLE_MS = 2 * 60 * 1000;
const BROWSER_LABEL_MAX = 40;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//;
const LOOPBACK_HOST = /^(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/i;

interface Binding {
  id?: string;
  usedAt: number;
}

function browserLabel(claimed: unknown): string | undefined {
  if (typeof claimed !== 'string') return undefined;
  return claimed.replace(/[^\x20-\x7E]/g, '').trim().slice(0, BROWSER_LABEL_MAX) || undefined;
}

export interface DaemonOptions {
  version: string;
  idleExit?: boolean;
}

export interface Daemon extends Bridge {
  port: number;
  stop(): Promise<void>;
}

export function persistScreenshot(
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

/**
 * The capture's other half. The extension can point at the file the browser just wrote but
 * cannot move it, judge it, or see the run's scope, so everything that decides whether a
 * download is kept happens here — and a refusal deletes what the browser already wrote.
 */
function persistDownload(action: string, result: ActionResult, hosts?: readonly string[]): ActionResult {
  if (action !== 'page.captureDownload' || !result.ok) return result;
  const item = (result.data as { item?: CapturedItem } | null)?.item;
  if (!item) return result;
  const adopted = adoptDownload(item, hosts);
  if (!adopted.ok) {
    log(`download refused: ${adopted.error.code}: ${adopted.error.message}`);
    return adopted;
  }
  const { id, name, mime, size, host, notes, savedTo } = adopted.data;
  return { ok: true, data: { downloadId: id, name, mime, size, host, notes, savedTo } };
}

export async function startDaemon({ version, idleExit = true }: DaemonOptions): Promise<Daemon> {
  const swept = sweepDownloads();
  if (swept) log(`swept ${swept} expired download${swept === 1 ? '' : 's'}`);

  const bundled = describeActions('chromium');
  const bundledHash = hashManifest(bundled);
  const bundledByHash = new Map(
    (['chromium', 'firefox'] as const).map((target) => {
      const list = describeActions(target);
      return [hashManifest(list), list] as const;
    }),
  );

  let offered = bundled;
  const links = new Map<string, ExtensionLink>();
  const agents = new Map<ExtensionLink, AgentSession>();
  const analyses = new FileAnalyses();
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
      res.end(JSON.stringify({ ok: true, pid: process.pid, version, connected: openLinks().length > 0 }));
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
    if (!isInstallId(hello.installId)) {
      log('extension hello carried no install id; closing');
      ws.close(1002, 'expected an install id');
      return;
    }
    const install: Install = {
      installId: hello.installId,
      origin: req.headers.origin!,
      extensionVersion: hello.extensionVersion,
      browser: browserLabel(hello.browser),
    };

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

    let secret: string;
    let sealedSessionKey: string | undefined;
    if (hello.auth?.kind === 'pair') {
      const matched = await matchPairing(proven.proof, transcript);
      if (!matched) {
        return reject('That pairing code is wrong or expired. Run "browsentic-mcp pair" for a new one.', true);
      }
      consumePairing(matched.code);
      secret = matched.secret;
      const session = createSession(install);
      sealedSessionKey = await sealSessionKey(secret, transcript, session.key);
      log(`paired ${install.browser ?? install.origin} (extension ${hello.extensionVersion})`);
    } else if (hello.auth?.kind === 'session') {
      const session = await matchSession(proven.proof, transcript, install);
      if (!session) {
        return reject('This browser is no longer paired. Run "browsentic-mcp pair" to pair again.', false);
      }
      claimSession(session.key, install);
      secret = session.key;
    } else {
      return reject('That hello named no credential to prove.', false);
    }

    await settle(ws, hello, install, transcript, secret, sealedSessionKey);
  }

  async function matchSession(proof: unknown, transcript: Transcript, install: Install): Promise<Session | null> {
    for (const session of sessionCandidates(install)) {
      if (sameProof(proof, await clientProof(session.key, transcript))) return session;
    }
    return null;
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
    install: Install,
    transcript: Transcript,
    secret: string,
    sealedSessionKey?: string,
  ): Promise<void> {
    // Only the same browser profile is superseded: its worker restarted and the old socket lingers.
    links.get(install.installId)?.close('superseded by a newer connection');
    const known = bundledByHash.get(hello.manifestHash);
    const manifestInSync = known !== undefined;
    const accepted = new ExtensionLink(
      ws,
      { ...hello, ...install },
      (closing) => {
        agents.get(closing)?.dispose();
        agents.delete(closing);
        analyses.cancelOwnedBy(closing);
        if (links.get(closing.id) === closing) links.delete(closing.id);
        log(`${closing.label} disconnected`);
        scheduleIdleExit();
        settleOffer();
      },
      (request, source) => {
        if (request.t === 'analyzeFile') {
          void analyses
            .start(request, readAgentConfig(), source)
            .then((report) => source.send({ t: 'fileReport', id: request.id, result: success(report) }))
            .catch((error) =>
              source.send({ t: 'fileReport', id: request.id, result: failure('AGENT_FAILED', String(error)) }),
            );
          return;
        }
        if (request.t === 'cancelAnalysis') {
          analyses.cancel(request.fileId);
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
        if (
          request.t === 'agentState' ||
          request.t === 'setAgent' ||
          request.t === 'setAgentModel' ||
          request.t === 'grantAgent'
        ) {
          void settleAgent(request).then((state) => {
            source.send({ t: 'agentInfo', id: request.id, result: state });
            // The catalog's agent-skill half belongs to the agent that just took over.
            if (request.t === 'setAgent') pushSkillCatalog(source);
            if (request.t !== 'agentState') announceAgent(source);
          });
          return;
        }
        if (request.t === 'listSkills') {
          return source.send({ t: 'skillCatalog', id: request.id, result: skillCatalogNow(request.refresh === true) });
        }
        if (request.t === 'guardrails' || request.t === 'setGuardrail') {
          return source.send({ t: 'guardrailInfo', id: request.id, result: settleGuardrail(request) });
        }
        if (request.t === 'saveSkill') {
          source.send({ t: 'skillResult', id: request.id, result: saveSkill(request.skill) });
          return shareSkillCatalog();
        }
        if (request.t === 'deleteSkill') {
          source.send({ t: 'skillResult', id: request.id, result: deleteSkill(request.name) });
          return shareSkillCatalog();
        }
        if (request.t === 'deleteSiteMap') {
          source.send({ t: 'skillResult', id: request.id, result: deleteSiteMap(request.name) });
          return shareSkillCatalog();
        }
        if (request.t === 'activateSiteMap') {
          const result = commitStaging(request.stagingId, request.exactHost === true);
          source.send({
            t: 'skillResult',
            id: request.id,
            result: result.ok ? { ok: true, data: { name: result.data.name, path: result.data.path } } : result,
          });
          return shareSkillCatalog();
        }
        if (request.t === 'discardSiteMap') {
          return source.send({ t: 'skillResult', id: request.id, result: discardStaging(request.stagingId) });
        }
        session(source).handle(request);
      },
    );
    links.set(accepted.id, accepted);
    accepted.tools = known ?? bundled;
    settleOffer();
    log(`extension ${hello.extensionVersion} connected from ${accepted.label} (manifest ${manifestInSync ? 'in sync' : 'DRIFTED'})`);
    const welcome = {
      daemonVersion: version,
      manifestHash: known ? hello.manifestHash : bundledHash,
      manifestInSync,
      sealedSessionKey,
    };
    accepted.send({ t: 'welcome', ...welcome, proof: await serverProof(secret, transcript, welcome) });
    scheduleIdleExit();
    void pushAgentState(accepted);
    watchModels();
    pushSkillCatalog(accepted);
    if (!known) await adoptExtensionManifest(accepted);
  }

  function openLinks(): ExtensionLink[] {
    return [...links.values()].filter((link) => link.isOpen);
  }

  function inSync(link: ExtensionLink): boolean {
    return bundledByHash.has(link.manifestHash);
  }

  /** The browser the user was last in, for a caller that has no run to say which one it means. */
  function activeLink(): ExtensionLink | null {
    return openLinks().reduce<ExtensionLink | null>(
      (latest, link) => (latest && latest.lastActive >= link.lastActive ? latest : link),
      null,
    );
  }

  function resetConversations(): void {
    for (const agent of agents.values()) agent.handle({ t: 'reset' });
  }

  function announceAgent(except?: ExtensionLink): void {
    for (const link of openLinks()) {
      if (link === except) continue;
      void pushAgentState(link);
      pushSkillCatalog(link);
    }
  }

  function shareSkillCatalog(): void {
    for (const link of openLinks()) pushSkillCatalog(link);
  }

  async function settleAgent(request: AgentFrame): Promise<ActionResult<AgentState>> {
    if (request.t !== 'agentState' && !isAgentKind(request.agent)) {
      return failure('INVALID_INPUT', `"${String(request.agent)}" is not an agent Browsentic knows.`);
    }
    if (request.t === 'setAgent') {
      writeActiveAgent(request.agent);
      // The held conversation belongs to the agent that just left; the next turn starts fresh.
      resetConversations();
      log(`agent set to ${AGENTS[request.agent].label}`);
    }
    if (request.t === 'setAgentModel') {
      // A model change keeps held conversations — every CLI resumes a session under a new model.
      const model = typeof request.model === 'string' ? request.model : null;
      if (!writeAgentModel(request.agent, model)) {
        return failure('INVALID_INPUT', `"${String(model)}" is not a model id: it has to start with a letter or digit and hold no spaces.`);
      }
      log(`${AGENTS[request.agent].label} model set to ${model?.trim() || 'the default'}`);
    }
    if (request.t === 'grantAgent') await grantRunner(request.agent);
    const recheck = request.t === 'agentState' && request.refresh === true;
    const state = await agentState(readAgentConfig(), { refresh: request.t !== 'agentState' || recheck });
    watchModels({ force: recheck });
    return success(state);
  }

  /**
   * Reads each agent's own model list after the state has gone out, and sends the state again
   * when one changed. A forced read sends it regardless, so the list's age is current.
   */
  function watchModels({ force = false } = {}): void {
    void refreshModelLists(readAgentConfig(), { force })
      .then((changed) => {
        if (changed || force) for (const link of openLinks()) void pushAgentState(link);
      })
      .catch((error: unknown) => log(`could not refresh the model lists: ${String(error)}`));
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

  function skillCatalogNow(refresh = false): ActionResult<SkillCatalog> {
    try {
      const config = readAgentConfig();
      const skills = loadSkills().map((skill) => ({
        name: skill.name,
        description: skill.description,
        category: skill.category,
        domains: skill.domains,
        source: skill.source,
      }));
      return success({ agent: config.agent, skills, agentSkills: agentSkills(config, { refresh }) });
    } catch (error) {
      return failure('AGENT_FAILED', String(error));
    }
  }

  function pushSkillCatalog(target: ExtensionLink): void {
    if (target.isOpen) target.send({ t: 'skillCatalog', id: '', result: skillCatalogNow() });
  }

  function session(source: ExtensionLink): AgentSession {
    const held = agents.get(source);
    if (held) return held;
    const created = new AgentSession({
      invoke: (action, input, opts) => invokeOn(source, action, input, opts),
      emit: (id, event) => source.send({ t: 'run', id, event }),
      draft: (id, draft) => source.send({ t: 'siteMapDraft', id, draft }),
      running: () => [...agents.values()].reduce((total, agent) => total + agent.running, 0),
      actionNames: () => source.tools.map((tool) => tool.name),
      awaitAnalysis: (fileId, signal) => analyses.wait(fileId, signal),
    });
    agents.set(source, created);
    return created;
  }

  function sessionRunning(runId: string): AgentSession | undefined {
    return [...agents.values()].find((agent) => agent.owns(runId));
  }

  // A drifted build is served its own list, and only its own: the adopted list lives on the
  // link and leaves with it, so a browser that agrees with us again is back on a bundled list
  // the moment it reconnects — the recovery direction of "the newer side wins".
  async function adoptExtensionManifest(source: ExtensionLink): Promise<void> {
    const reported = await source.describe();
    if (!reported?.length) {
      log(`${source.label} drifted but its manifest could not be fetched; serving it the bundled tool list`);
      return;
    }
    source.tools = reported;
    log(`adopted ${reported.length} tools from ${source.label} (bundled list was ${bundled.length})`);
    settleOffer();
  }

  /** What a caller with no run of its own is offered: the list of the browser the user was last in. */
  function offeredTools(): ToolDescriptor[] {
    return activeLink()?.tools ?? bundled;
  }

  // A browser's worker restarting closes one link and opens another in the same tick, so the
  // comparison waits for the tick to end rather than announcing a change that has already undone itself.
  function settleOffer(): void {
    setImmediate(() => {
      const now = offeredTools();
      if (now === offered) return;
      offered = now;
      for (const listener of manifestListeners) listener();
      broadcast({ event: 'manifest-changed' });
    });
  }

  /**
   * A caller's tab ids only mean something in the browser that issued them, so a burst of calls
   * stays with one browser. Once the caller goes quiet, its next call follows the user instead.
   */
  function routeFor(binding: Binding): ExtensionLink | null {
    const held = binding.id ? links.get(binding.id) : undefined;
    const target = held?.isOpen && Date.now() - binding.usedAt < BINDING_IDLE_MS ? held : activeLink();
    binding.id = target?.id;
    binding.usedAt = Date.now();
    return target;
  }

  // A tool list belongs to a browser. A run is offered the list of the browser it runs in; a
  // caller with no run is offered the browser its next call would reach, so list and calls agree.
  function describeFor(runId: string | undefined, binding: Binding): Described {
    const running = runId ? [...agents].find(([, agent]) => agent.owns(runId)) : undefined;
    const offer = running && runId ? running[1].offerFor(runId) : null;
    if (offer && running) {
      return { tools: running[0].tools.filter(({ name }) => !offer.withheld.includes(name)), reserved: offer.reserved };
    }

    const tools = routeFor(binding)?.tools ?? bundled;
    const config = readAgentConfig();
    const policy = policyFrom(config.guardrails, config.requireApproval);
    const denied = (action: string) =>
      decide({ action, input: {}, caller: 'external', scope: ANYWHERE }, policy).effect === 'deny';
    return {
      tools: tools.filter(({ name }) => !((name === INJECT_ACTION || name === RUN_CODE_ACTION) && denied(name))),
      reserved: [],
    };
  }

  function acceptControl(ws: WebSocket): void {
    const client = `c${++controlSeq}`;
    const binding: Binding = { usedAt: 0 };
    controls.add(ws);
    scheduleIdleExit();
    ws.on('message', async (raw) => {
      let request: ControlRequest;
      try {
        request = JSON.parse(String(raw)) as ControlRequest;
      } catch {
        return log('dropped unparseable control frame');
      }
      if (request.op === 'describe') {
        return send(ws, { id: request.id, op: 'describe', ...describeFor(request.runId, binding) });
      }
      if (request.op === 'status') {
        return send(ws, { id: request.id, op: 'status', status: statusNow(routeFor(binding)) });
      }
      if (request.op === 'invoke') {
        let result: ActionResult;
        if (request.runId) {
          result =
            (await sessionRunning(request.runId)?.invokeForRun(request.runId, request.action, request.input)) ??
            failure('RUN_INACTIVE', 'This agent run is no longer active');
          if (!result.ok && result.error.code === 'RUN_INACTIVE') {
            log(`control ${client} invoked ${request.action} for inactive run ${request.runId}`);
          }
        } else {
          result = await invokeExternal(routeFor(binding), request.action, request.input, client);
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
          resetConversations();
          log(`control ${client} set the agent to ${AGENTS[request.set].label}`);
        }
        if (request.grant) await grantRunner(request.grant);
        const listed = isAgentKind(request.models);
        if (listed) await refreshModelLists(readAgentConfig(), { force: true, only: request.models });
        const state = await agentState(readAgentConfig(), { refresh: !!changed || listed });
        if (changed || listed) announceAgent();
        else watchModels();
        return send(ws, { id: request.id, op: 'agent', state });
      }
      if (request.op === 'revoke') {
        const { session: id, origin } = request;
        const revoked = revokeSessions((session) => (id ? sessionId(session) === id : !origin || session.origin === origin));
        for (const link of openLinks()) {
          if (id ? link.id === id : !origin || link.origin === origin) link.close('pairing revoked');
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
    return listSessions().map(({ key: _key, installId: _installId, ...session }) => {
      const id = sessionId({ installId: _installId, origin: session.origin });
      return { id, ...session, connected: links.get(id)?.isOpen === true };
    });
  }

  function statusNow(target: ExtensionLink | null): BridgeStatus {
    return {
      connected: !!target,
      daemonVersion: version,
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      port,
      manifestInSync: !target || inSync(target),
      extensionVersion: target?.extensionVersion,
      browser: target?.browser,
      connectedBrowsers: openLinks().length,
      pairedBrowsers: listSessions().length,
      pairingPending: hasPendingPairing(),
    };
  }

  async function invokeOn(
    link: ExtensionLink | null,
    action: string,
    input?: unknown,
    opts?: { saveTo?: { dir: string; filename: string }; tabId?: number; runId?: string; hosts?: readonly string[] },
  ) {
    if (action.startsWith(RESERVED_PREFIX)) {
      return failure('UNKNOWN_ACTION', `Unknown action "${action}".`);
    }
    if (action === 'page.listDownloads') return listDownloads(input);
    const resolved = resolveAttachment(action, input);
    if (!resolved.ok) return resolved;
    if (!link?.isOpen) {
      return failure(
        'EXTENSION_OFFLINE',
        'The Browsentic extension is not connected — open your browser with the extension loaded, then retry',
      );
    }
    const route = { tabId: opts?.tabId, runId: opts?.runId };
    const result =
      action === solveCaptcha.name
        ? await solveCaptchaWithAnalyst((next) => link.invoke(action, next, route), resolved.data, readAgentConfig())
        : await link.invoke(action, resolved.data, route);
    return persistDownload(action, persistScreenshot(action, input, result, opts?.saveTo), opts?.hosts);
  }

  async function invokeExternal(
    target: ExtensionLink | null,
    action: string,
    input: unknown,
    client: string,
  ): Promise<ActionResult> {
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

    const result = await invokeOn(target, action, input);
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
    if (openLinks().length || controls.size > 0) return;
    idleTimer = setTimeout(() => {
      if (openLinks().length || controls.size > 0) return scheduleIdleExit();
      log('idle with no clients; exiting');
      void stop().then(() => process.exit(0));
    }, IDLE_EXIT_MS);
    idleTimer.unref();
  }

  async function stop(): Promise<void> {
    if (idleTimer) clearTimeout(idleTimer);
    for (const link of [...links.values()]) link.close('daemon shutting down');
    for (const ws of controls) ws.close(1001, 'daemon shutting down');
    wss.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    if (readLockfile()?.pid === process.pid) clearLockfile();
    log('daemon stopped');
  }

  const local: Binding = { usedAt: 0 };
  return {
    port,
    describe: async () => describeFor(undefined, local),
    invoke: (action, input) => invokeOn(routeFor(local), action, input),
    status: async () => statusNow(routeFor(local)),
    onManifestChanged: (listener) => manifestListeners.add(listener),
    close: stop,
    stop,
  };
}

function listen(http: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const remaining = [...daemonPorts];
    const attempt = () => {
      const port = remaining.shift();
      if (port === undefined) {
        reject(new Error(`No free port in ${daemonPorts.join(', ')} — another process is using them all`));
        return;
      }
      const onListening = () => {
        http.removeListener('error', onError);
        resolve((http.address() as AddressInfo).port);
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
