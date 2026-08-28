/**
 * Where a sealed secret is allowed to become plaintext again.
 *
 * One list, and it is short on purpose: the fields that type into a page. A secret
 * released into a URL, a selector or a search box has left the browser, which is the
 * exact thing the seal exists to prevent — so a handle anywhere else is refused rather
 * than quietly passed through as a placeholder, because a form filled with `⟦…⟧` fails
 * in a way nobody can read.
 *
 * The release happens in the extension, one hop before the content script, so the
 * plaintext exists only in the message that carries it into the page. It is never in a
 * tool result, never in a transcript, and never on the daemon's side of the socket.
 */

import { handlesIn, releaseText, type Handle } from './seal';

export const RELEASE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'page.fillInput': ['value'],
  'page.typeText': ['text'],
};

export const REFUSED_MESSAGE =
  'A sealed secret can only be released into page.fillInput “value” or page.typeText “text”. ' +
  'Browsentic swaps the placeholder for the real value at the moment it reaches the page, so the secret is never ' +
  'yours to move: pass the placeholder through unchanged and let the field it belongs in do it.';

export const EXPIRED_MESSAGE =
  'That sealed secret is no longer held — it expired, or it was read in an earlier browser session. ' +
  'Read the value from the page again, or ask the user for it.';

export function releasableFields(action: string): readonly string[] {
  return RELEASE_FIELDS[action] ?? [];
}

export interface Release {
  readonly input: unknown;
  readonly released: Handle[];
  /** Handles sitting in a field that may not carry one. */
  readonly refused: Handle[];
  /** Ours by shape but not by tag, or gone from the vault. */
  readonly unresolved: Handle[];
}

export function releaseInput(
  action: string,
  input: unknown,
  tag: string,
  resolve: (handle: Handle) => string | null,
): Release {
  const allowed = releasableFields(action);
  const released: Handle[] = [];
  const refused: Handle[] = [];
  const unresolved: Handle[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { input, released, refused: handlesAnywhere(input, refused), unresolved };
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (allowed.includes(key) && typeof value === 'string') {
      const result = releaseText(value, tag, resolve);
      released.push(...result.released);
      unresolved.push(...result.unresolved);
      out[key] = result.text;
      continue;
    }
    handlesAnywhere(value, refused);
    out[key] = value;
  }
  return { input: out, released, refused, unresolved };
}

function handlesAnywhere(value: unknown, into: Handle[], depth = 0): Handle[] {
  if (typeof value === 'string') into.push(...handlesIn(value));
  else if (depth < 12 && value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) handlesAnywhere(nested, into, depth + 1);
  }
  return into;
}
