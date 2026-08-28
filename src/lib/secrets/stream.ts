/**
 * Sealing text that arrives a few characters at a time.
 *
 * A model streams `sk-ant-` in one delta and the rest of the key in the next. Sealing
 * each delta on its own finds neither half, so the sealer holds back the tail of what
 * it has until enough has arrived to be sure a secret is not straddling the edge, and
 * only cuts at a boundary a secret cannot contain.
 *
 * It also refuses to cut immediately after a label: `password:` emitted alone would
 * leave the value to be scanned later with nothing to identify it.
 */

const HOLD = 256;
const MAX_HOLD = 2_048;
const LABEL_TAIL = /[\w-]{2,32}["']?\s*[:=]\s*$/;
const PEM = '-----BEGIN';

export interface StreamSealer {
  push(delta: string): string;
  flush(): string;
}

export function streamSealer(seal: (text: string) => string): StreamSealer {
  let held = '';

  return {
    push(delta) {
      held += delta;
      const cut = cutPoint(held);
      if (cut <= 0) return '';
      const out = held.slice(0, cut);
      held = held.slice(cut);
      return seal(out);
    },
    flush() {
      if (!held) return '';
      const out = held;
      held = '';
      return seal(out);
    },
  };
}

function cutPoint(held: string): number {
  const limit = held.length - HOLD;
  if (limit <= 0) return 0;

  let cut = held.lastIndexOf('\n', limit);
  if (cut < 0) {
    if (held.length <= MAX_HOLD) return 0;
    cut = lastWhitespace(held, limit);
    if (cut < 0) return limit;
  }

  const label = LABEL_TAIL.exec(held.slice(Math.max(0, cut - 48), cut));
  if (label) cut = Math.max(0, cut - 48) + label.index;

  const begin = held.lastIndexOf(PEM);
  if (begin >= 0 && begin < cut && !held.includes('-----END', begin)) cut = begin;

  return cut > 0 ? cut : 0;
}

function lastWhitespace(held: string, limit: number): number {
  for (let at = limit; at > 0; at -= 1) if (/\s/.test(held[at])) return at;
  return -1;
}
