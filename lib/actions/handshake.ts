const NONCE_BYTES = 16;
const SEPARATOR = '|';

/**
 * A pairing code carries ~39 bits, so a squatter who recorded one handshake could grind it on a GPU
 * in seconds if the proof were a plain HMAC. PBKDF2 over the two nonces makes that grind hopeless
 * and leaves nothing to precompute.
 */
const PAIRING_ITERATIONS = 250_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface Transcript {
  protocolVersion: number;
  extensionVersion: string;
  manifestHash: string;
  clientNonce: string;
  serverNonce: string;
}

export function newNonce(): string {
  return encode(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

export function isNonce(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16;
}

export async function pairingSecret(code: string, transcript: Transcript): Promise<string> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveBits']);
  const salt = encoder.encode(join('browsentic/pair', transcript.clientNonce, transcript.serverNonce));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PAIRING_ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  );
  return encode(new Uint8Array(bits));
}

export async function clientProof(secret: string, transcript: Transcript): Promise<string> {
  return encode(await tag(secret, 'browsentic/client', transcript));
}

export interface Welcome {
  daemonVersion: string;
  manifestHash: string;
  manifestInSync: boolean;
  sealedSessionKey?: string;
}

/**
 * Domain-separated from the client proof so an impostor cannot reflect the extension's own proof
 * back at it. This is what stops a process squatting on a daemon port from being believed, and it
 * covers the whole welcome so none of it can be altered on the way.
 */
export async function serverProof(secret: string, transcript: Transcript, welcome: Welcome): Promise<string> {
  const claims = join(
    welcome.daemonVersion,
    welcome.manifestHash,
    String(welcome.manifestInSync),
    welcome.sealedSessionKey ?? '',
  );
  return encode(await tag(secret, 'browsentic/server', transcript, claims));
}

export async function sealSessionKey(secret: string, transcript: Transcript, sessionKey: string): Promise<string> {
  const clear = encoder.encode(sessionKey);
  const stream = await keystream(secret, transcript, clear.length);
  return encode(clear.map((byte, index) => byte ^ stream[index]));
}

export async function openSessionKey(
  secret: string,
  transcript: Transcript,
  sealed: string,
): Promise<string | null> {
  const cipher = decode(sealed);
  if (!cipher) return null;
  const stream = await keystream(secret, transcript, cipher.length);
  return decoder.decode(cipher.map((byte, index) => byte ^ stream[index]));
}

export function sameProof(offered: unknown, expected: string): boolean {
  if (typeof offered !== 'string' || offered.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index++) {
    diff |= offered.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

async function tag(secret: string, label: string, transcript: Transcript, extra = ''): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const message = join(
    label,
    String(transcript.protocolVersion),
    transcript.extensionVersion,
    transcript.manifestHash,
    transcript.clientNonce,
    transcript.serverNonce,
    extra,
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

async function keystream(secret: string, transcript: Transcript, length: number): Promise<Uint8Array> {
  const stream = new Uint8Array(length);
  for (let offset = 0, block = 0; offset < length; offset += 32, block++) {
    const chunk = await tag(secret, 'browsentic/seal', transcript, String(block));
    stream.set(chunk.subarray(0, Math.min(32, length - offset)), offset);
  }
  return stream;
}

function join(...parts: string[]): string {
  return parts.join(SEPARATOR);
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}
