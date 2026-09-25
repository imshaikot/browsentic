import { afterEach, expect, test, vi } from 'vitest';
import { formatWhen } from './format-when';

afterEach(() => {
  vi.useRealTimers();
});

test('a time reads as how long ago it was, up to a week, then as its date', () => {
  vi.useFakeTimers({ now: new Date(2026, 8, 25, 12, 0) });
  const before = (ms: number) => formatWhen(Date.now() - ms);
  expect([before(30_000), before(5 * 60_000), before(3 * 3_600_000), before(2 * 86_400_000), before(8 * 86_400_000)]).toEqual([
    'just now',
    '5m ago',
    '3h ago',
    '2d ago',
    new Date(2026, 8, 17, 12, 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  ]);
});
