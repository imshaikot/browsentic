import { describe, expect, test } from 'vitest';
import {
  clientProof,
  newNonce,
  openSessionKey,
  pairingSecret,
  sameProof,
  sealSessionKey,
  serverProof,
  type Transcript,
  type Welcome,
} from './handshake';

const transcript: Transcript = {
  protocolVersion: 9,
  extensionVersion: '0.1.7',
  manifestHash: 'deadbeef',
  clientNonce: newNonce(),
  serverNonce: newNonce(),
};
const elsewhere: Transcript = { ...transcript, serverNonce: newNonce() };
const KEY = 'session-key-under-test';
const WELCOME: Welcome = { daemonVersion: '0.1.7', manifestHash: 'deadbeef', manifestInSync: true };

describe('the client proof', () => {
  test('a proof verifies against the same secret', async () => {
    expect(sameProof(await clientProof(KEY, transcript), await clientProof(KEY, transcript))).toBe(true);
  });

  test('a proof fails against another secret', async () => {
    expect(sameProof(await clientProof(KEY, transcript), await clientProof('other', transcript))).toBe(false);
  });

  test('a proof is bound to its transcript', async () => {
    expect(sameProof(await clientProof(KEY, transcript), await clientProof(KEY, elsewhere))).toBe(false);
  });

  test('a proof is bound to the protocol version', async () => {
    expect(sameProof(await clientProof(KEY, transcript), await clientProof(KEY, { ...transcript, protocolVersion: 8 }))).toBe(false);
  });

  test('a proof is bound to the manifest hash', async () => {
    expect(sameProof(await clientProof(KEY, transcript), await clientProof(KEY, { ...transcript, manifestHash: 'cafe' }))).toBe(false);
  });

  test('nonces are not reused', () => {
    expect(newNonce()).not.toBe(newNonce());
  });
});

// An impostor that cannot derive the server proof cannot pose as the daemon, and reflecting the
// extension's own proof back at it does not work either.
describe('the server proof', () => {
  test('the server proof is not the client proof', async () => {
    expect(sameProof(await serverProof(KEY, transcript, WELCOME), await clientProof(KEY, transcript))).toBe(false);
  });

  test('the server proof verifies', async () => {
    expect(sameProof(await serverProof(KEY, transcript, WELCOME), await serverProof(KEY, transcript, WELCOME))).toBe(true);
  });

  test('the server proof needs the secret', async () => {
    expect(sameProof(await serverProof(KEY, transcript, WELCOME), await serverProof('other', transcript, WELCOME))).toBe(false);
  });

  test('the server proof covers the welcome', async () => {
    const renamed = await serverProof(KEY, transcript, { ...WELCOME, daemonVersion: '9.9.9' });
    expect(sameProof(await serverProof(KEY, transcript, WELCOME), renamed)).toBe(false);
  });

  test('the server proof covers the manifest verdict', async () => {
    const outOfSync = await serverProof(KEY, transcript, { ...WELCOME, manifestInSync: false });
    expect(sameProof(await serverProof(KEY, transcript, WELCOME), outOfSync)).toBe(false);
  });

  test('a truncated proof is refused', async () => {
    const theirs = await serverProof(KEY, transcript, WELCOME);
    expect(sameProof(theirs.slice(0, -1), theirs)).toBe(false);
  });

  test('a missing proof is refused', async () => {
    expect(sameProof(undefined, await serverProof(KEY, transcript, WELCOME))).toBe(false);
  });
});

describe('the sealed session key', () => {
  test('a sealed key does not carry the plaintext', async () => {
    expect(await sealSessionKey(KEY, transcript, 'the-issued-session-key')).not.toContain('the-issued-session-key');
  });

  test('a sealed key opens with the same secret', async () => {
    const sealed = await sealSessionKey(KEY, transcript, 'the-issued-session-key');
    expect(await openSessionKey(KEY, transcript, sealed)).toBe('the-issued-session-key');
  });

  test('a sealed key stays shut without the secret', async () => {
    const sealed = await sealSessionKey(KEY, transcript, 'the-issued-session-key');
    expect(await openSessionKey('other', transcript, sealed)).not.toBe('the-issued-session-key');
  });

  test('the sealed key is covered by the proof', async () => {
    const sealed = await sealSessionKey(KEY, transcript, 'the-issued-session-key');
    const covering = await serverProof(KEY, transcript, { ...WELCOME, sealedSessionKey: sealed });
    expect(sameProof(covering, await serverProof(KEY, transcript, WELCOME))).toBe(false);
  });
});

describe('the pairing secret', () => {
  const code = 'ABCD2345';

  test('a pairing secret is deterministic', async () => {
    expect(await pairingSecret(code, transcript)).toBe(await pairingSecret(code, transcript));
  });

  test('a pairing secret is salted by the nonces', async () => {
    expect(await pairingSecret(code, elsewhere)).not.toBe(await pairingSecret(code, transcript));
  });

  test('a pairing secret is not the code', async () => {
    expect(await pairingSecret(code, transcript)).not.toBe(code);
  });
});
