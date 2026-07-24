import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { DAEMON_PORTS, SOCKET_PROTOCOL_VERSION, failure, parseFrame, type ActionResult } from '@/lib/actions/protocol';
import { hashManifest } from '@/lib/actions/manifest';
import { describeActions } from '@/lib/actions/registry';
import { saveScreenshot } from './screenshots';
import {
  consumePairing,
  createPairing,
  createSession,
  hasPendingPairing,
  listSessions,
  revokeSessions,
  validateSession,
} from './auth-store';
import { AgentSession } from './agent/service';
import { summarizeFile } from './agent/analyze';
import { readAgentConfig } from './agent/config';
import type { Bridge, BridgeStatus, ControlMessage, ControlRequest, SessionSummary } from './control';
import { ExtensionLink } from './extension-link';
import { log } from './log';
import { readLockfile, writeLockfile, clearLockfile, type Lockfile } from './lockfile';

const IDLE_EXIT_MS = 30 * 60 * 1000;
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//;

export interface DaemonOptions {
  version: string;
  idleExit?: boolean;
}

export interface Daemon extends Bridge {
  port: number;
  stop(): Promise<void>;
}

/**
 * When a `page.screenshot { save: true }` succeeds, write the captured image to disk and note the
 * path (or the write error) on the result. A failed save never fails the capture — the caller
 * still gets the image to look at.
 */
function persistScreenshot(action: string, input: unknown, result: ActionResult): ActionResult {
  if (action !== 'page.screenshot' || !result.ok) return result;
  const args = (input ?? {}) as { save?: unknown; filename?: unknown };
  const data = result.data as { dataUrl?: unknown } | null;
  if (args.save !== true || typeof data?.dataUrl !== 'string') return result;
  try {
    const savedTo = saveScreenshot(data.dataUrl, {
      filename: typeof args.filename === 'string' ? args.filename : undefined,
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
  const manifestListeners = new Set<() => void>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const previous = readLockfile();
  const lock: Lockfile = {
    pid: process.pid,
    port: 0,
    // Reuse the previous token so CLIs holding a stale copy keep working across restarts.
    token: previous?.token ?? randomBytes(24).toString('base64url'),
    protocolVersion: SOCKET_PROTOCOL_VERSION,
    daemonVersion: version,
  };

  const http = createServer((req, res) => {
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

  /**
   * Gate the HTTP upgrade by peer *kind*. Browsers set `Origin` themselves and pages cannot
   * forge or omit it, so the two branches are mutually exclusive: a web page can never reach
   * the control path, and a local process can never impersonate the extension.
   *
   * This only decides which door to knock on. An extension still has to authenticate with a
   * pairing token or session key in its `hello` frame before it can do anything.
   */
  function authorize(req: IncomingMessage): 'extension' | 'control' | null {
    const origin = req.headers.origin;
    if (origin && EXTENSION_ORIGIN.test(origin)) return 'extension';
    if (origin) {
      log(`rejected web origin ${origin}`);
      return null;
    }
    // No Origin header: a local process. Must prove it can read the 0600 lockfile.
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
    // Nothing is served on this socket until `hello` proves the extension was paired.
    const reject = (reason: string, retryable: boolean) => {
      log(`rejected extension: ${reason}`);
      try {
        ws.send(JSON.stringify({ t: 'unauthorized', reason, retryable }));
      } catch {
        // Closing anyway.
      }
      ws.close(4401, 'unauthorized');
    };

    ws.once('message', async (raw) => {
      const hello = parseFrame(String(raw));
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

      const origin = req.headers.origin!;
      const auth = hello.auth;
      let issuedKey: string | undefined;
      if (auth && 'pairingToken' in auth) {
        if (!consumePairing(auth.pairingToken)) {
          return reject('That pairing code is wrong or expired. Run "voicelink-mcp pair" for a new one.', true);
        }
        issuedKey = createSession(origin, hello.extensionVersion).key;
        log(`paired ${origin} (extension ${hello.extensionVersion})`);
      } else if (auth && 'sessionKey' in auth) {
        if (!validateSession(auth.sessionKey, origin)) {
          // Revoked, or the auth store was cleared: tell the extension to forget its key.
          return reject('This browser is no longer paired. Run "voicelink-mcp pair" to pair again.', false);
        }
      } else {
        return reject('No pairing token or session key supplied.', false);
      }

      link?.close('superseded by a newer connection');
      agent?.dispose();
      manifestInSync = hello.manifestHash === bundledHash;
      const accepted = new ExtensionLink(
        ws,
        { ...hello, origin },
        (closing) => {
          if (link !== closing) return;
          link = null;
          // The conversation was about a browser that is gone; nothing survives it.
          agent?.dispose();
          agent = null;
          log('extension disconnected');
          scheduleIdleExit();
        },
        // The agent harness: the extension asks the daemon to think, and the daemon answers
        // by driving the browser back down this same socket. A file to summarize is the one
        // stateless request — it runs outside the conversation and replies with `fileSummary`,
        // so it is handled here rather than in the run-gated AgentSession.
        (request, source) => {
          if (request.t === 'analyzeFile') {
            void summarizeFile(request, readAgentConfig())
              .then((result) => source.send({ t: 'fileSummary', id: request.id, result }))
              .catch((error) =>
                source.send({ t: 'fileSummary', id: request.id, result: failure('AGENT_FAILED', String(error)) }),
              );
            return;
          }
          session(source).handle(request);
        },
      );
      link = accepted;
      log(`extension ${hello.extensionVersion} connected from ${origin} (manifest ${manifestInSync ? 'in sync' : 'DRIFTED'})`);
      accepted.send({
        t: 'welcome',
        daemonVersion: version,
        manifestHash: bundledHash,
        manifestInSync,
        sessionKey: issuedKey,
      });
      scheduleIdleExit();
      if (!manifestInSync) await adoptExtensionManifest(accepted);
    });
  }

  /**
   * The agent state for the connected browser, created on its first instruction. It routes tool
   * calls through the same `invoke` MCP clients use, so the agent has no privileged path.
   */
  function session(source: ExtensionLink): AgentSession {
    return (agent ??= new AgentSession({
      invoke,
      emit: (id, event) => source.send({ t: 'run', id, event }),
    }));
  }

  /** The installed extension was built from a different registry — believe the browser, not the bundle. */
  async function adoptExtensionManifest(source: ExtensionLink): Promise<void> {
    const reported = await source.describe();
    if (!reported?.length) {
      log('extension manifest drifted but could not be fetched; keeping the bundled tool list');
      return;
    }
    tools = reported;
    log(`adopted ${reported.length} tools from the extension (bundled list was ${bundled.length})`);
    for (const listener of manifestListeners) listener();
    broadcast({ event: 'manifest-changed' });
  }

  function acceptControl(ws: WebSocket): void {
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
        // A run-tagged invocation belongs to a spawned agent: it goes through the run's
        // approval gate and shows up on the extension's timeline. Anything else is a plain
        // MCP client and takes the direct path.
        const result = request.runId
          ? ((await agent?.invokeForRun(request.runId, request.action, request.input)) ??
            failure('RUN_INACTIVE', 'This agent run is no longer active'))
          : await invoke(request.action, request.input);
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
      if (request.op === 'revoke') {
        const target = request.origin;
        const revoked = revokeSessions((session) => !target || session.origin === target);
        // A revoked browser must not keep driving the tab it is already attached to.
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

  async function invoke(action: string, input?: unknown) {
    if (!link?.isOpen) {
      return failure(
        'EXTENSION_OFFLINE',
        'The VoiceLink extension is not connected — open your browser with the extension loaded, then retry',
      );
    }
    // Every caller — direct MCP clients and spawned agent runs alike — reaches the browser
    // through here, so this is the one place to write a screenshot to disk when asked.
    return persistScreenshot(action, input, await link.invoke(action, input));
  }

  /** Nothing attached and nobody asking: don't linger in the user's process list forever. */
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
    // Only clear the lockfile if it still describes us; a successor may have replaced it.
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

/**
 * Bind the first free port in the fixed range. The bind is also the mutex against two
 * daemons racing to start: the loser sees EADDRINUSE and connects to the winner instead.
 */
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
        // Drop this attempt's success handler too: a later attempt's bind would otherwise
        // fire it as well, resolving with a port the daemon is not actually listening on.
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

function refuseUpgrade(socket: Duplex, reason: string): void {
  socket.write(`HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\nX-VoiceLink-Reason: ${reason}\r\n\r\n`);
  socket.destroy();
}
