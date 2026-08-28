/**
 * The deterministic sanitizer, shared by both sides of the socket.
 *
 *   shapes.ts    what a secret looks like — patterns, labels, what may be revealed
 *   detect.ts    finding them in a string, including the entropy gate
 *   seal.ts      the handle grammar, sealing a value, releasing one back
 *   release.ts   the two fields a secret may become plaintext in
 *   stream.ts    sealing text that arrives in deltas
 *
 * Nothing here holds a secret. The vault that does lives in the extension
 * (`lib/bridge/secret-vault.ts`) and only there, so the daemon — which spawns an agent
 * CLI and talks to MCP clients — never has a plaintext credential to leak.
 */

export { caseFlips, entropy, findSecrets, type Range, type Span } from './detect';
export { EXPIRED_MESSAGE, REFUSED_MESSAGE, RELEASE_FIELDS, releasableFields, releaseInput, type Release } from './release';
export {
  CLOSE,
  OPEN,
  handleFor,
  handlesIn,
  releaseText,
  sealText,
  sealValue,
  sealedHandles,
  type Handle,
  type Mint,
  type SealOptions,
  type Sealed,
  type SealedFinding,
} from './seal';
export { NOTHING, SECRET_WORDS, SHAPES, kindForKey, looksLikeCredential, notAPlaceholder, type Reveal, type SecretKind, type Shape } from './shapes';
export { streamSealer, type StreamSealer } from './stream';
