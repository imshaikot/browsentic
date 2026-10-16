const FLOOR_CHARS_PER_SECOND = 300;
const CATCH_UP_SECONDS = 0.9;

export function paced(text: string, progress: number, seconds: number): number {
  const backlog = text.length - progress;
  if (backlog <= 0) return text.length;
  const rate = Math.max(FLOOR_CHARS_PER_SECOND, backlog / CATCH_UP_SECONDS);
  return Math.min(text.length, progress + rate * seconds);
}

export function wordEnd(text: string, at: number): number {
  const from = Math.ceil(at);
  if (from >= text.length) return text.length;
  const gap = text.slice(from).search(/\s/);
  return gap < 0 ? text.length : from + gap;
}
