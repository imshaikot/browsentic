const PARTS_OF_DAY = [
  { from: 0, words: 'Hello' },
  { from: 5, words: 'Good morning' },
  { from: 12, words: 'Good afternoon' },
  { from: 18, words: 'Good evening' },
] as const;

export function greeting(hour: number, name?: string): string {
  const { words } = PARTS_OF_DAY.findLast(({ from }) => hour >= from) ?? PARTS_OF_DAY[0];
  const called = name?.trim();
  return called ? `${words}, ${called}` : words;
}
