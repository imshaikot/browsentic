/**
 * The sanitizer's daemon-side half.
 *
 * The extension already seals what it reads from a page, so on a healthy path this pass
 * finds nothing — every handle it meets is one the extension minted, which it leaves
 * alone. It earns its place on the paths the extension never touches: what the agent
 * writes back to the user, the summaries the side panel renders, and anything the daemon
 * itself composed. A model that read a key before it was sealed, or was told one by the
 * user, still has to get past this to print it.
 *
 * There is no vault here, on purpose. This half only seals; it can never turn a handle
 * back into a secret, so a daemon process — which spawns an agent CLI and serves MCP
 * clients over a local socket — holds no credential that could leak. Releasing happens
 * in the extension, one hop from the page, and nowhere else.
 */

import { randomBytes } from 'node:crypto';
import { handleFor, sealText, sealValue, streamSealer, type Mint, type StreamSealer } from '@/lib/secrets';

const tag = randomBytes(8).toString('hex');
let seq = 0;

const mint: Mint = (_value, kind) => handleFor({ kind, id: (seq += 1).toString(36) }, tag);

/** Seal a string on its way to a model, a client, or the user. */
export function sealSecrets(text: string): string {
  return sealText(text, { mint }).value;
}

/** Seal every string in a JSON value, leaving structure and non-strings alone. */
export function sealSecretsIn<T>(value: T): T {
  return sealValue(value, { mint }).value;
}

/** Seal text that arrives in deltas, holding back what might be half a secret. */
export function sealingStream(): StreamSealer {
  return streamSealer(sealSecrets);
}
