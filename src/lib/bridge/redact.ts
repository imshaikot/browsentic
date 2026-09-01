import { isSensitiveField } from '@/lib/recordings/events';
import { handlesIn } from '@/lib/secrets';

const REDACTED = '[redacted]';
const MAX_STRING = 200;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    if (isSensitiveField({ name: key, id: key, value })) return REDACTED;
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => redactValue(key, item, depth + 1));
    return value.length > MAX_ITEMS ? [...items, '…'] : items;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [name, nested] of Object.entries(value as Record<string, unknown>)) {
      out[name] = isSensitiveField({ name, id: name }) ? REDACTED : redactValue(name, nested, depth + 1);
    }
    return out;
  }
  return null;
}

const TYPED_FIELD: Record<string, string> = {
  'page.fillInput': 'value',
  'page.typeText': 'text',
};

/**
 * Fields the panel has to show whole. An approval that asks someone to read code cannot
 * hand them the first two hundred characters of it, so these skip the length cap — which
 * is also why the code must never carry a secret: this is the field that is shown.
 */
const VERBATIM_FIELDS: Record<string, readonly string[]> = {
  'page.injectCode': ['purpose', 'code'],
};

/**
 * A sealed handle is safe to show and worth showing: it names the kind of credential and
 * the site it was read on, which is exactly what someone answering a `secret-release`
 * prompt needs. Anything around it is not, so the field collapses to its handles alone.
 */
export function redactInput(action: string, input: unknown): unknown {
  if (!input || typeof input !== 'object') return redactValue('', input, 0);
  const redacted = redactValue('', input, 0) as Record<string, unknown>;
  for (const field of VERBATIM_FIELDS[action] ?? []) {
    const original = (input as Record<string, unknown>)[field];
    if (typeof original === 'string') redacted[field] = original;
  }
  const typed = TYPED_FIELD[action];
  if (typed && typed in redacted) {
    const typedValue = (input as Record<string, unknown>)[typed];
    const sealed = typeof typedValue === 'string' ? handlesIn(typedValue) : [];
    redacted[typed] = sealed.length ? sealed.map((handle) => handle.text).join(' ') : REDACTED;
  }
  return redacted;
}
