/**
 * The host process a browser launches: one framed message in, one framed reply out, then exit.
 * Stdout carries only that reply and stderr carries nothing, because a browser reads a stray byte
 * as a broken host, and Firefox up to 157 on macOS can hang on a host's stderr (bug 1981177).
 *
 * The browser launches it only for the extension IDs its registration lists, so a request that
 * arrives here comes from our own extension, in a browser running as this user. That is what lets
 * `pair` hand out a grant with no code typed.
 */

import { isInstallId } from '@/lib/actions/protocol';
import {
  FIREFOX_CALLER,
  HOST_OPS,
  MAX_PAIR_WAIT_MS,
  isPairReason,
  type GrantOutcome,
  type HostHello,
  type HostPairReply,
  type HostPairRequest,
  type PairingMode,
} from '@/lib/pairing';
import { FIREFOX_ADDON_ID } from '@/lib/stores';
import type { BridgeStatus } from './control';
import { log } from './log';

export function encodeNativeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

export function decodeNativeMessage(buffer: Buffer): unknown | undefined {
  if (buffer.length < 4) return undefined;
  const length = buffer.readUInt32LE(0);
  if (buffer.length < 4 + length) return undefined;
  try {
    return JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
  } catch {
    return null;
  }
}

function readNativeMessage(input: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve) => {
    let held = Buffer.alloc(0);
    const done = (value: unknown) => {
      input.removeAllListeners('data');
      resolve(value);
    };
    input.on('data', (chunk: Buffer) => {
      held = Buffer.concat([held, chunk]);
      const message = decodeNativeMessage(held);
      if (message !== undefined) done(message);
    });
    input.on('end', () => done(null));
  });
}

/** Who launched this host, from the arguments the browser passes: an origin from Chromium, the add-on id from Firefox. */
export type Caller = { family: 'chromium'; origin: string } | { family: 'firefox'; addonId: string };

const CHROMIUM_CALLER = /^chrome-extension:\/\/[a-p]{32}\/?$/;

export function callerOf(argv: readonly string[]): Caller | null {
  const origin = argv.find((arg) => CHROMIUM_CALLER.test(arg));
  if (origin) return { family: 'chromium', origin: origin.endsWith('/') ? origin : `${origin}/` };
  return argv.includes(FIREFOX_ADDON_ID) ? { family: 'firefox', addonId: FIREFOX_ADDON_ID } : null;
}

/** What a grant is bound to: the exact origin for Chromium, the scheme for Firefox. */
export const callerKey = (caller: Caller): string => (caller.family === 'chromium' ? caller.origin : FIREFOX_CALLER);

export const STOPPED_REPLY = { ok: false, error: 'Stopped with "browsentic stop"; "browsentic start" lets the browser start it again.' };

const UNKNOWN_OP = { ok: false, error: 'Expected {"op":"ensure"}.' };

/** The slice of a control connection the host uses. */
export interface HostBridge {
  status(timeoutMs: number): Promise<BridgeStatus>;
  grant(request: { installId: string; caller: string; browser?: string; extensionVersion: string; gesture?: boolean; waitMs?: number }, timeoutMs: number): Promise<GrantOutcome | null>;
  pair(): Promise<{ code: string; expiresAt: number }>;
  close(): Promise<void>;
}

export interface HostContext {
  /** Starts the Bridge if it is down, and says where it listens. */
  ensure: (caller: Caller | null) => Promise<{ port: number; token: string }>;
  /** True while `browsentic stop` holds the Bridge down. */
  held: () => boolean;
  /** Read from config.json, so a host answers even while the Bridge is down. */
  mode: () => PairingMode;
  version: string;
  app: () => HostHello['app'];
  connect: (lock: { port: number; token: string }) => Promise<HostBridge>;
}

const STATUS_TIMEOUT_MS = 3_000;
const GRANT_TIMEOUT_MS = 5_000;
/** The longest a host takes to answer, past any wait it was asked to hold; the extension waits a little longer. */
export const HOST_DEADLINE_MS = 12_000;

const OFF = 'Automatic pairing is off on this computer. Pair with a code from "browsentic pair" or the app.';
const RESTART =
  'Browsentic Bridge was updated but the old one is still running. Restart it ("browsentic restart", or Restart in the app) to pair this browser.';

export async function serveNativeHost(context: HostContext, argv: readonly string[] = process.argv.slice(3)): Promise<void> {
  silenceStderr();
  const caller = callerOf(argv);
  const message = (await readNativeMessage(process.stdin)) as { op?: unknown; waitMs?: unknown } | null;
  const waited = message?.op === 'pair' ? waitFor(message.waitMs) : 0;
  const reply = await Promise.race([
    answerNativeMessage(message, context, caller),
    new Promise<HostPairReply>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: 'Browsentic Bridge took too long to answer.' }), HOST_DEADLINE_MS + waited).unref(),
    ),
  ]);
  logReply(message?.op, reply, caller);
  await new Promise<void>((resolve) => process.stdout.write(encodeNativeMessage(reply), () => resolve()));
}

function logReply(op: unknown, reply: object, caller: Caller | null): void {
  if (reply === STOPPED_REPLY) return;
  const who = caller ? callerKey(caller) : 'an unknown caller';
  if (op === 'ensure') {
    const failed = 'error' in reply ? ` — ${String(reply.error)}` : '';
    return log(`native host: ${'ok' in reply && reply.ok ? 'daemon ready' : `could not start the daemon${failed}`}`);
  }
  if (op !== 'pair') return;
  const outcome = 'grant' in reply ? 'granted' : 'wait' in reply ? 'waiting for approval' : 'refused' in reply ? `refused (${String(reply.refused)})` : `failed: ${'error' in reply ? String(reply.error) : ''}`;
  log(`native host: pair for ${who} ${outcome}`);
}

function silenceStderr(): void {
  process.stderr.write = ((chunk: string | Uint8Array) => {
    log(`native host stderr: ${String(chunk).trim()}`);
    return true;
  }) as typeof process.stderr.write;
}

const waitFor = (value: unknown) => Math.min(MAX_PAIR_WAIT_MS, Math.max(0, typeof value === 'number' ? value : 0));

export async function answerNativeMessage(
  message: Record<string, unknown> | null,
  context: HostContext,
  caller: Caller | null = null,
): Promise<object> {
  if (message?.op === 'hello') return hello(context);
  if (message?.op === 'pair') return pair(message, context, caller);
  if (message?.op !== 'ensure') return UNKNOWN_OP;
  if (context.held()) return STOPPED_REPLY;
  return context
    .ensure(caller)
    .then((lock) => ({ ok: true, port: lock.port }))
    .catch((error) => ({ ok: false, error: String(error) }));
}

function hello(context: HostContext): HostHello {
  return { ok: true, host: 2, bridge: context.version, ops: [...HOST_OPS], mode: context.mode(), held: context.held(), app: context.app() };
}

export function parsePairRequest(message: unknown): HostPairRequest | null {
  const asked = message as Partial<Record<keyof HostPairRequest, unknown>> | null;
  if (!asked || !isInstallId(asked.installId) || !isPairReason(asked.reason)) return null;
  if (typeof asked.extensionVersion !== 'string' || typeof asked.protocolVersion !== 'number') return null;
  return {
    op: 'pair',
    installId: asked.installId,
    browser: typeof asked.browser === 'string' ? asked.browser.slice(0, 64) : undefined,
    extensionVersion: asked.extensionVersion.slice(0, 32),
    protocolVersion: asked.protocolVersion,
    reason: asked.reason,
    gesture: asked.gesture === true,
    waitMs: waitFor(asked.waitMs),
  };
}

async function pair(message: unknown, context: HostContext, caller: Caller | null): Promise<HostPairReply> {
  if (!caller) return { ok: false, refused: 'origin', error: 'Browsentic Bridge pairs only with its own extension.' };
  const request = parsePairRequest(message);
  if (!request) return { ok: false, error: 'That pair request is missing what it needs.' };
  const mode = context.mode();
  if (mode === 'code') return { ok: false, refused: 'off', error: OFF, mode };
  if (context.held()) return { ok: false, refused: 'stopped', error: STOPPED_REPLY.error, mode };

  let lock: { port: number; token: string };
  try {
    lock = await context.ensure(caller);
  } catch (error) {
    return { ok: false, error: `Browsentic Bridge could not start: ${String(error)}` };
  }
  let bridge: HostBridge;
  try {
    bridge = await context.connect(lock);
  } catch (error) {
    return { ok: false, error: `Could not reach Browsentic Bridge: ${String(error)}` };
  }
  try {
    const status = await bridge.status(STATUS_TIMEOUT_MS).catch(() => null);
    if (!status) return { ok: false, error: 'Browsentic Bridge did not answer.' };
    if (!status.pairing) {
      if (mode === 'ask') return { ok: false, refused: 'restart', error: RESTART, mode };
      const legacy = await bridge.pair();
      return { ok: true, grant: { code: legacy.code, port: lock.port, expiresAt: legacy.expiresAt }, mode, approver: 'terminal' };
    }
    const outcome = await bridge.grant(
      {
        installId: request.installId,
        caller: callerKey(caller),
        browser: request.browser,
        extensionVersion: request.extensionVersion,
        gesture: request.gesture,
        waitMs: request.waitMs,
      },
      (request.waitMs ?? 0) + GRANT_TIMEOUT_MS,
    );
    const current = status.pairing.mode;
    if (!outcome) return { ok: false, error: 'Browsentic Bridge did not answer the pairing request.' };
    if ('grant' in outcome) return { ok: true, grant: outcome.grant, mode: current, approver: outcome.approver };
    if ('wait' in outcome) return { ok: false, wait: outcome.wait, mode: current };
    return { ok: false, refused: outcome.refused, error: outcome.error, mode: current };
  } catch (error) {
    return { ok: false, error: String(error) };
  } finally {
    await bridge.close().catch(() => undefined);
  }
}
