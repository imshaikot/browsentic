const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatWhen(at: number): string {
  const ago = Date.now() - at;
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h ago`;
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
