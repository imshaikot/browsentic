const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

const BOUNDARIES = [
  { pattern: /\n{2,}/g, floor: 0.5 },
  { pattern: /(?<=[.!?…]["'’”)\]]*)\s+/g, floor: 0.25 },
  { pattern: /[。！？]["’”」』）)\]]*/g, floor: 0.25 },
  { pattern: /\n/g, floor: 0.25 },
  { pattern: /\s+/g, floor: 0 },
];

const CURSOR = /^(\d+)\.([0-9a-f]{8})$/;

export function digestOf(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function groupEnd(text: string, start: number, budget: number): number {
  if (text.length - start <= budget) return text.length;
  const window = text.slice(start, start + budget);
  for (const { pattern, floor } of BOUNDARIES) {
    const cut = lastBoundary(window, pattern, Math.floor(budget * floor));
    if (cut > 0) return start + cut;
  }
  return start + budget;
}

export function writeCursor(offset: number, delivered: string): string {
  return `${offset}.${digestOf(delivered)}`;
}

export function readCursor(cursor: string): { offset: number; digest: string } | null {
  const parsed = CURSOR.exec(cursor.trim());
  return parsed ? { offset: Number(parsed[1]), digest: parsed[2] } : null;
}

function lastBoundary(window: string, pattern: RegExp, floor: number): number {
  pattern.lastIndex = 0;
  let end = 0;
  for (let match = pattern.exec(window); match; match = pattern.exec(window)) {
    if (match.index >= floor) end = match.index + match[0].length;
  }
  return end;
}
