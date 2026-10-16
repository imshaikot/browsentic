import { describe, expect, test } from 'vitest';
import { classifyHostError, readReply } from './native-pair';

describe('classifyHostError', () => {
  test('reads each browser’s own words', () => {
    expect(classifyHostError('Specified native messaging host not found.')).toBe('missing');
    expect(classifyHostError('No such native application com.browsentic.daemon')).toBe('missing');
    expect(classifyHostError('Access to the specified native messaging host is forbidden.')).toBe('forbidden');
    expect(classifyHostError('Access to the native messaging host was disabled by the system administrator.')).toBe('policy');
  });

  test('calls anything else a failure to start, never a confident cause', () => {
    for (const message of ['Native host has exited.', 'Failed to start native messaging host.', 'Error when communicating with the native messaging host.', 'An unexpected error occurred', 'something new']) {
      expect(classifyHostError(message)).toBe('failed');
    }
  });
});

describe('readReply', () => {
  const grant = { code: 'G'.repeat(26), port: 8766, expiresAt: 1 };

  test('takes a grant, a wait or a refusal as the host gave it', () => {
    expect(readReply({ ok: true, grant, mode: 'auto', approver: 'app' })).toEqual({ kind: 'grant', grant, mode: 'auto', approver: 'app' });
    expect(readReply({ ok: false, wait: { request: 'r', approver: 'app', retryAfterMs: 3000 }, mode: 'ask' })).toEqual({ kind: 'wait', approver: 'app', mode: 'ask' });
    expect(readReply({ ok: false, refused: 'revoked', error: 'gone', mode: 'auto' })).toEqual({ kind: 'refused', refusal: 'revoked', message: 'gone', mode: 'auto' });
  });

  test('knows a host from before automatic pairing by the words it answers anything new with', () => {
    expect(readReply({ ok: false, error: 'Expected {"op":"ensure"}.' })).toMatchObject({ kind: 'unreachable', reach: 'old' });
  });

  test('never pairs on a grant it cannot trust the shape of', () => {
    for (const bad of [{ ...grant, port: 0 }, { ...grant, port: 70_000 }, { ...grant, code: 'short' }, { ...grant, port: '8766' }, null]) {
      expect(readReply({ ok: true, grant: bad, mode: 'auto' })).toMatchObject({ kind: 'unreachable', reach: 'failed' });
    }
    expect(readReply(undefined)).toMatchObject({ kind: 'unreachable', reach: 'failed' });
    expect(readReply({ ok: false, refused: 'whatever', error: 'x' })).toMatchObject({ kind: 'unreachable', reach: 'failed' });
  });
});
