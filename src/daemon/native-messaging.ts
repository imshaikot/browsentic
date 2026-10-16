/**
 * The host process a browser launches: one framed message in, one framed reply out, then exit.
 * Stdout carries only that reply and stderr carries nothing, because a browser reads a stray byte
 * as a broken host, and Firefox up to 157 on macOS can hang on a host's stderr (bug 1981177).
 */

import { FIREFOX_ADDON_ID } from '@/lib/stores';
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

export const STOPPED_REPLY = { ok: false, error: 'Stopped with "browsentic stop"; "browsentic start" lets the browser start it again.' };

export interface HostContext {
  /** Starts the Bridge if it is down, and says where it listens. */
  ensure: (caller: Caller | null) => Promise<{ port: number }>;
  /** True while `browsentic stop` holds the Bridge down. */
  held: () => boolean;
}

export async function serveNativeHost(context: HostContext, argv: readonly string[] = process.argv.slice(3)): Promise<void> {
  silenceStderr();
  const caller = callerOf(argv);
  const message = (await readNativeMessage(process.stdin)) as { op?: unknown } | null;
  const reply = await answerNativeMessage(message, context, caller);
  if (reply !== STOPPED_REPLY) {
    log(`native host: ${reply.ok ? 'daemon ready' : `could not start the daemon — ${'error' in reply ? reply.error : ''}`}`);
  }
  await new Promise<void>((resolve) => process.stdout.write(encodeNativeMessage(reply), () => resolve()));
}

function silenceStderr(): void {
  process.stderr.write = ((chunk: string | Uint8Array) => {
    log(`native host stderr: ${String(chunk).trim()}`);
    return true;
  }) as typeof process.stderr.write;
}

export async function answerNativeMessage(
  message: { op?: unknown } | null,
  { ensure, held }: HostContext,
  caller: Caller | null = null,
): Promise<{ ok: boolean; port?: number; error?: string }> {
  if (message?.op !== 'ensure') return { ok: false, error: 'Expected {"op":"ensure"}.' };
  if (held()) return STOPPED_REPLY;
  return ensure(caller)
    .then((lock) => ({ ok: true, port: lock.port }))
    .catch((error) => ({ ok: false, error: String(error) }));
}
