import { describe, expect, it, vi } from 'vitest';
import type { GrantOutcome, PairingMode } from '@/lib/pairing';
import type { BridgeStatus } from './control';
import {
  STOPPED_REPLY,
  answerNativeMessage,
  callerOf,
  decodeNativeMessage,
  encodeNativeMessage,
  parsePairRequest,
  type Caller,
  type HostBridge,
  type HostContext,
} from './native-messaging';

const STORE = 'chrome-extension://npmocgldfflonjjmdadmdefpnfagnjmp/';
const chrome: Caller = { family: 'chromium', origin: STORE };
const firefox: Caller = { family: 'firefox', addonId: 'browsentic@browsentic.com' };
const request = { op: 'pair', installId: 'install-host-test-01', browser: 'Google Chrome', extensionVersion: '0.9.0', protocolVersion: 23, reason: 'install' };

describe('the message frame', () => {
  it('round-trips a message and waits for a whole one', () => {
    const frame = encodeNativeMessage({ op: 'ensure' });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    expect(decodeNativeMessage(frame)).toEqual({ op: 'ensure' });
    expect(decodeNativeMessage(frame.subarray(0, frame.length - 1))).toBeUndefined();
  });
});

describe('callerOf', () => {
  it('reads the origin Chromium passes, wherever it sits, past --parent-window on Windows', () => {
    expect(callerOf([STORE])).toEqual(chrome);
    expect(callerOf(['--parent-window=0', STORE])).toEqual(chrome);
    expect(callerOf([STORE.slice(0, -1)])).toEqual(chrome);
  });

  it('reads the add-on id Firefox passes after the manifest path', () => {
    expect(callerOf(['/Users/me/Library/Application Support/Mozilla/NativeMessagingHosts/x.json', 'browsentic@browsentic.com'])).toEqual(firefox);
  });

  it('names nobody it cannot recognise', () => {
    expect(callerOf([])).toBeNull();
    expect(callerOf(['chrome-extension://not-an-id/'])).toBeNull();
    expect(callerOf(['someone@else.com'])).toBeNull();
  });
});

function bridgeWith(status: Partial<BridgeStatus> | null, outcome: GrantOutcome | null = null) {
  const calls: string[] = [];
  const grants: Parameters<HostBridge['grant']>[0][] = [];
  const bridge: HostBridge = {
    status: async () => {
      calls.push('status');
      if (!status) throw new Error('no answer');
      return status as BridgeStatus;
    },
    grant: async (asked) => {
      calls.push('grant');
      grants.push(asked);
      return outcome;
    },
    pair: async () => {
      calls.push('pair');
      return { code: 'LEGACY23', expiresAt: 1 };
    },
    close: async () => void calls.push('close'),
  };
  return { bridge, calls, grants };
}

function contextWith(options: { mode?: PairingMode; held?: boolean; bridge?: HostBridge; ensure?: HostContext['ensure'] } = {}) {
  const ensure = vi.fn(options.ensure ?? (async () => ({ port: 8766, token: 't' })));
  const context: HostContext = {
    ensure,
    held: () => options.held ?? false,
    mode: () => options.mode ?? 'auto',
    version: '0.9.0',
    app: () => ({ kind: 'mac', present: true }),
    connect: async () => options.bridge ?? bridgeWith({ pairing: { mode: 'auto', approver: 'app' } }).bridge,
  };
  return { context, ensure };
}

describe('answering ensure', () => {
  it('starts the daemon when asked, saying who asked', async () => {
    const { context, ensure } = contextWith();
    expect(await answerNativeMessage({ op: 'ensure' }, context, firefox)).toEqual({ ok: true, port: 8766 });
    expect(ensure).toHaveBeenCalledWith(firefox);
  });

  it('leaves a daemon stopped on purpose down', async () => {
    const { context, ensure } = contextWith({ held: true });
    expect(await answerNativeMessage({ op: 'ensure' }, context)).toBe(STOPPED_REPLY);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('refuses anything it does not know, in the words shipped extensions read', async () => {
    const { context, ensure } = contextWith();
    expect(await answerNativeMessage({ op: 'spawn' }, context)).toEqual({ ok: false, error: 'Expected {"op":"ensure"}.' });
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe('answering hello', () => {
  it('says what it can do without starting the Bridge', async () => {
    const { context, ensure } = contextWith({ mode: 'ask' });
    expect(await answerNativeMessage({ op: 'hello' }, context)).toEqual({
      ok: true,
      host: 2,
      bridge: '0.9.0',
      ops: ['ensure', 'hello', 'pair'],
      mode: 'ask',
      held: false,
      app: { kind: 'mac', present: true },
    });
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe('answering pair', () => {
  it('hands over the grant the Bridge gives, bound to the origin the browser vouched for', async () => {
    const fake = bridgeWith({ pairing: { mode: 'auto', approver: 'app' } }, { grant: { code: 'G'.repeat(26), port: 8766, expiresAt: 9 }, approver: 'app' });
    const { context } = contextWith({ bridge: fake.bridge });

    expect(await answerNativeMessage(request, context, chrome)).toEqual({ ok: true, grant: { code: 'G'.repeat(26), port: 8766, expiresAt: 9 }, mode: 'auto', approver: 'app' });
    expect(fake.grants).toEqual([expect.objectContaining({ installId: request.installId, caller: STORE, gesture: false, waitMs: 0 })]);
    expect(fake.calls.at(-1)).toBe('close');
  });

  it('binds a Firefox grant to the scheme, since its origin is random per install', async () => {
    const fake = bridgeWith({ pairing: { mode: 'auto', approver: 'app' } }, { grant: { code: 'G', port: 1, expiresAt: 1 }, approver: 'app' });
    await answerNativeMessage(request, contextWith({ bridge: fake.bridge }).context, firefox);
    expect(fake.grants[0].caller).toBe('moz-extension://');
  });

  it('passes on a wait and a refusal as they are', async () => {
    const waiting = bridgeWith({ pairing: { mode: 'ask', approver: 'terminal' } }, { wait: { request: 'r1', approver: 'terminal', retryAfterMs: 3000 } });
    expect(await answerNativeMessage({ ...request, waitMs: 99_000 }, contextWith({ mode: 'ask', bridge: waiting.bridge }).context, chrome)).toEqual({
      ok: false,
      wait: { request: 'r1', approver: 'terminal', retryAfterMs: 3000 },
      mode: 'ask',
    });
    expect(waiting.grants[0].waitMs).toBe(25_000);

    const refused = bridgeWith({ pairing: { mode: 'auto', approver: 'app' } }, { refused: 'revoked', error: 'gone' });
    expect(await answerNativeMessage(request, contextWith({ bridge: refused.bridge }).context, chrome)).toEqual({ ok: false, refused: 'revoked', error: 'gone', mode: 'auto' });
  });

  it('pairs nobody whose caller it cannot name', async () => {
    const { context, ensure } = contextWith();
    expect(await answerNativeMessage(request, context, null)).toMatchObject({ ok: false, refused: 'origin' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('pairs nothing in code mode, and leaves the Bridge alone', async () => {
    const { context, ensure } = contextWith({ mode: 'code' });
    expect(await answerNativeMessage(request, context, chrome)).toMatchObject({ ok: false, refused: 'off', mode: 'code' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('leaves a Bridge stopped on purpose down', async () => {
    const { context, ensure } = contextWith({ held: true });
    expect(await answerNativeMessage(request, context, chrome)).toMatchObject({ ok: false, refused: 'stopped' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('falls back to a plain code from a running Bridge older than grants, in auto mode', async () => {
    const old = bridgeWith({});
    expect(await answerNativeMessage(request, contextWith({ bridge: old.bridge }).context, chrome)).toEqual({
      ok: true,
      grant: { code: 'LEGACY23', port: 8766, expiresAt: 1 },
      mode: 'auto',
      approver: 'terminal',
    });
    expect(old.calls).not.toContain('grant');
  });

  it('asks for a restart instead in ask mode, since an old Bridge cannot ask anyone', async () => {
    const old = bridgeWith({});
    expect(await answerNativeMessage(request, contextWith({ mode: 'ask', bridge: old.bridge }).context, chrome)).toMatchObject({ ok: false, refused: 'restart' });
    expect(old.calls).not.toContain('pair');
  });

  it('fails without pairing when the Bridge will not start, answer, or decide', async () => {
    const broken = contextWith({ ensure: async () => Promise.reject(new Error('ports busy')) }).context;
    expect(await answerNativeMessage(request, broken, chrome)).toMatchObject({ ok: false, error: expect.stringContaining('ports busy') });

    const silent = bridgeWith(null);
    expect(await answerNativeMessage(request, contextWith({ bridge: silent.bridge }).context, chrome)).toEqual({ ok: false, error: 'Browsentic Bridge did not answer.' });

    const undecided = bridgeWith({ pairing: { mode: 'auto', approver: 'app' } }, null);
    expect(await answerNativeMessage(request, contextWith({ bridge: undecided.bridge }).context, chrome)).toEqual({
      ok: false,
      error: 'Browsentic Bridge did not answer the pairing request.',
    });
  });
});

describe('parsePairRequest', () => {
  it('takes only a request that names the browser, why it asks and what it runs', () => {
    expect(parsePairRequest(request)).toMatchObject({ installId: request.installId, reason: 'install', gesture: false, waitMs: 0 });
    expect(parsePairRequest({ ...request, installId: 'short' })).toBeNull();
    expect(parsePairRequest({ ...request, reason: 'because' })).toBeNull();
    expect(parsePairRequest({ ...request, extensionVersion: 3 })).toBeNull();
    expect(parsePairRequest(null)).toBeNull();
  });

  it('counts only a real true as a click', () => {
    expect(parsePairRequest({ ...request, gesture: 'yes' })?.gesture).toBe(false);
    expect(parsePairRequest({ ...request, gesture: true })?.gesture).toBe(true);
  });
});
