import { browser } from 'wxt/browser';
import { NATIVE_HOST_NAME, SOCKET_PROTOCOL_VERSION } from '@/lib/actions/protocol';
import {
  isPairingMode,
  type Approver,
  type Grant,
  type HostPairRequest,
  type PairRefusal,
  type PairReason,
  type PairingMode,
} from '@/lib/pairing';
import { identify } from './identity';

/** Whether this browser can reach Browsentic Bridge's native host, and in what shape. */
export type BridgeReach = 'ready' | 'old' | 'missing' | 'forbidden' | 'policy' | 'stopped' | 'failed' | 'off';

export type PairAttempt =
  | { kind: 'grant'; grant: Grant; mode: PairingMode; approver: Approver }
  | { kind: 'wait'; approver: Approver; mode: PairingMode }
  | { kind: 'refused'; refusal: PairRefusal; message: string; mode?: PairingMode }
  | { kind: 'unreachable'; reach: Exclude<BridgeReach, 'ready' | 'stopped' | 'off'>; message: string };

/** Past the host's own deadline, so the host's own answer wins whenever it gives one. */
const HOST_TIMEOUT_MS = 15_000;

/**
 * The browsers' own words (native_message_host.cc, message_service.cc, NativeMessaging.sys.mjs). Chromium
 * says "not found" for a missing manifest, a missing binary and a policy that turns per-user hosts off
 * alike, and Firefox says it for a host that would not let this extension in too, on purpose.
 */
const HOST_ERRORS: [RegExp, BridgeReach][] = [
  [/Specified native messaging host not found/i, 'missing'],
  [/No such native application/i, 'missing'],
  [/Access to the specified native messaging host is forbidden/i, 'forbidden'],
  [/disabled by the system administrator/i, 'policy'],
];

export function classifyHostError(message: string): Exclude<BridgeReach, 'ready' | 'stopped' | 'off'> {
  const known = HOST_ERRORS.find(([pattern]) => pattern.test(message))?.[1];
  return known === 'missing' || known === 'forbidden' || known === 'policy' ? known : 'failed';
}

const OLD_HOST = 'Expected {"op":"ensure"}.';

const APPROVERS: readonly Approver[] = ['app', 'terminal'];
const REFUSALS: readonly PairRefusal[] = ['off', 'revoked', 'denied', 'stopped', 'origin', 'restart'];

const isGrant = (value: unknown): value is Grant => {
  const grant = value as Partial<Grant> | null;
  return (
    typeof grant?.code === 'string' &&
    grant.code.length >= 8 &&
    typeof grant.port === 'number' &&
    Number.isInteger(grant.port) &&
    grant.port > 0 &&
    grant.port < 65_536 &&
    typeof grant.expiresAt === 'number'
  );
};

/** Anything a host says that is not plainly a grant, a wait or a refusal is a failure: it never pairs. */
export function readReply(reply: unknown): PairAttempt {
  const answer = (reply ?? {}) as Record<string, unknown>;
  const mode = isPairingMode(answer.mode) ? answer.mode : undefined;
  const approver = APPROVERS.includes(answer.approver as Approver) ? (answer.approver as Approver) : 'terminal';
  if (answer.ok === true && isGrant(answer.grant)) return { kind: 'grant', grant: answer.grant, mode: mode ?? 'auto', approver };
  const wait = answer.wait as { approver?: unknown } | undefined;
  if (answer.ok === false && wait && typeof wait === 'object') {
    return { kind: 'wait', approver: APPROVERS.includes(wait.approver as Approver) ? (wait.approver as Approver) : 'terminal', mode: mode ?? 'ask' };
  }
  const message = typeof answer.error === 'string' ? answer.error : 'Browsentic Bridge gave no answer it could read.';
  if (answer.ok === false && REFUSALS.includes(answer.refused as PairRefusal)) {
    return { kind: 'refused', refusal: answer.refused as PairRefusal, message, mode };
  }
  if (message === OLD_HOST) return { kind: 'unreachable', reach: 'old', message };
  return { kind: 'unreachable', reach: 'failed', message };
}

export interface AskOptions {
  gesture?: boolean;
  /** How long the host may hold the answer while ask mode waits on a person. */
  waitMs?: number;
}

export async function askHost(reason: PairReason, { gesture = false, waitMs = 0 }: AskOptions = {}): Promise<PairAttempt> {
  const { installId, browser: name } = await identify();
  const request: HostPairRequest = {
    op: 'pair',
    installId,
    browser: name,
    extensionVersion: browser.runtime.getManifest().version,
    protocolVersion: SOCKET_PROTOCOL_VERSION,
    reason,
    gesture,
    waitMs,
  };
  try {
    return readReply(await withTimeout(browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, request), HOST_TIMEOUT_MS + waitMs));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'unreachable', reach: classifyHostError(message), message };
  }
}

function withTimeout<T>(pending: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browsentic Bridge took too long to answer.')), ms);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
