/**
 * The one place a plaintext secret is kept.
 *
 * It lives in the extension, in `storage.session`, and nowhere else. Not in a
 * transcript, not in `storage.local`, and never across the socket — so the daemon, which
 * spawns an agent CLI and serves MCP clients, has no credential to lose. Session storage
 * is the right area for exactly one reason: the browser empties it on restart, so a
 * password read on Tuesday is not still here on Wednesday.
 *
 * `tag` is minted once per browser session and is the reason a page cannot help itself
 * to what is in here. Handles are public and a page can copy one, but resolving one
 * requires the tag, which is never rendered into page text, a tool result or a
 * transcript.
 */

import { browser } from 'wxt/browser';
import {
  handleFor,
  releaseInput,
  sealValue,
  type Handle,
  type Mint,
  type Release,
  type SealedFinding,
  type SecretKind,
} from '@/lib/secrets';

const VAULT_KEY = 'browsentic/secrets';
const MAX_ENTRIES = 64;
const TTL_MS = 2 * 60 * 60_000;

interface VaultEntry {
  id: string;
  value: string;
  kind: SecretKind;
  shape: string;
  origin?: string;
  at: number;
}

interface Vault {
  tag: string;
  entries: VaultEntry[];
}

let queue: Promise<unknown> = Promise.resolve();

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export function sealForPage<T>(value: T, origin?: string): Promise<{ value: T; found: SealedFinding[] }> {
  return locked(async () => {
    const vault = await readVault();
    const now = Date.now();
    const live = vault.entries.filter((entry) => now - entry.at < TTL_MS);
    const minted: VaultEntry[] = [];

    const mint: Mint = (secret, kind, shape) => {
      const known = [...live, ...minted].find((entry) => entry.value === secret && entry.origin === origin);
      if (known) {
        known.at = now;
        return handleFor(known, vault.tag);
      }
      const entry: VaultEntry = { id: newId(), value: secret, kind, shape, origin, at: now };
      minted.push(entry);
      return handleFor(entry, vault.tag);
    };

    const sealed = sealValue(value, { mint, tag: vault.tag });
    if (minted.length || live.length !== vault.entries.length) {
      await writeVault({ tag: vault.tag, entries: [...live, ...minted].slice(-MAX_ENTRIES) });
    }
    return sealed;
  });
}

export function releaseForAction(action: string, input: unknown): Promise<Release> {
  return locked(async () => {
    const vault = await readVault();
    const now = Date.now();
    const touched: VaultEntry[] = [];

    const resolve = (handle: Handle): string | null => {
      const entry = vault.entries.find((held) => held.id === handle.id);
      if (!entry || now - entry.at >= TTL_MS) return null;
      entry.at = now;
      touched.push(entry);
      return entry.value;
    };

    const release = releaseInput(action, input, vault.tag, resolve);
    if (touched.length) await writeVault(vault);
    return release;
  });
}

export function forgetSecrets(): Promise<void> {
  return locked(() => browser.storage.session.remove(VAULT_KEY));
}

async function readVault(): Promise<Vault> {
  const stored = await browser.storage.session.get(VAULT_KEY).catch(() => ({}) as Record<string, unknown>);
  const held = stored[VAULT_KEY] as Partial<Vault> | undefined;
  if (held?.tag && Array.isArray(held.entries)) return { tag: held.tag, entries: held.entries };
  const fresh: Vault = { tag: newTag(), entries: [] };
  await writeVault(fresh);
  return fresh;
}

function writeVault(vault: Vault): Promise<void> {
  return browser.storage.session.set({ [VAULT_KEY]: vault }).catch(() => undefined);
}

const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const newTag = () => hex(8);
const newId = () => hex(4);
