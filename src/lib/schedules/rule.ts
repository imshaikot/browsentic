export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export const WORKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];

export const DAY_NAMES: Record<Weekday, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface TimeWindow {
  from: string;
  to: string;
}

export type ScheduleRule =
  | { kind: 'once'; at: number }
  | { kind: 'every'; minutes: number; window?: TimeWindow }
  | { kind: 'weekly'; days: Weekday[]; times: string[] };

interface ClockTime {
  hours: number;
  minutes: number;
}

const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseClockTime(text: string): ClockTime | null {
  const match = CLOCK_TIME.exec(text);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]) } : null;
}

export const isClockTime = (text: unknown): text is string => typeof text === 'string' && CLOCK_TIME.test(text);

export const isWeekday = (day: unknown): day is Weekday => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6;

const pad = (value: number) => String(value).padStart(2, '0');

export const clockTimeOf = (at: number): string => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function atClockTime(day: Date, offsetDays: number, time: ClockTime): number {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offsetDays, time.hours, time.minutes).getTime();
}

const minuteOfDay = (at: number): number => {
  const date = new Date(at);
  return date.getHours() * 60 + date.getMinutes();
};

const minuteOfClock = ({ hours, minutes }: ClockTime): number => hours * 60 + minutes;

export function insideWindow(at: number, window: TimeWindow): boolean {
  const from = parseClockTime(window.from);
  const to = parseClockTime(window.to);
  if (!from || !to) return true;
  const now = minuteOfDay(at);
  const [start, end] = [minuteOfClock(from), minuteOfClock(to)];
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

function nextWindowStart(after: number, window: TimeWindow): number {
  const from = parseClockTime(window.from)!;
  const day = new Date(after);
  const today = atClockTime(day, 0, from);
  return today > after ? today : atClockTime(day, 1, from);
}

function nextEvery(minutes: number, after: number, window?: TimeWindow): number {
  const candidate = after + minutes * 60_000;
  if (!window || insideWindow(candidate, window)) return candidate;
  return nextWindowStart(candidate, window);
}

function nextWeekly(days: readonly Weekday[], times: readonly string[], after: number): number | null {
  const clocks = times.map(parseClockTime).filter((time): time is ClockTime => time !== null);
  if (!days.length || !clocks.length) return null;
  const start = new Date(after);
  for (let offset = 0; offset <= 7; offset++) {
    const candidates = clocks
      .map((time) => atClockTime(start, offset, time))
      .filter((at) => at > after && days.includes(new Date(at).getDay() as Weekday))
      .sort((a, b) => a - b);
    if (candidates.length) return candidates[0];
  }
  return null;
}

export function nextAfter(rule: ScheduleRule, after: number): number | null {
  switch (rule.kind) {
    case 'once':
      return rule.at > after ? rule.at : null;
    case 'every':
      return nextEvery(rule.minutes, after, rule.window);
    case 'weekly':
      return nextWeekly(rule.days, rule.times, after);
  }
}

export function upcoming(rule: ScheduleRule, from: number, count: number): number[] {
  const runs: number[] = [];
  let cursor = from;
  while (runs.length < count) {
    const next = nextAfter(rule, cursor);
    if (next === null) break;
    runs.push(next);
    cursor = next;
  }
  return runs;
}

const sameSet = (a: readonly Weekday[], b: readonly Weekday[]) => a.length === b.length && b.every((day) => a.includes(day));

export function describeDays(days: readonly Weekday[]): string {
  if (sameSet(days, WEEKDAYS)) return 'Every day';
  if (sameSet(days, WORKDAYS)) return 'Weekdays';
  if (sameSet(days, [0, 6])) return 'Weekends';
  return WEEKDAYS.filter((day) => days.includes(day))
    .map((day) => DAY_NAMES[day])
    .join(', ');
}

export function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function describeInterval(minutes: number): string {
  if (minutes % (24 * 60) === 0) return minutes === 24 * 60 ? 'Every day' : `Every ${minutes / (24 * 60)} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'Every hour' : `Every ${minutes / 60} h`;
  return `Every ${minutes} min`;
}

export function describeMoment(at: number): string {
  const date = new Date(at);
  const day = `${DAY_NAMES[date.getDay() as Weekday]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
  return `${day} at ${clockTimeOf(at)}`;
}

export function describeRule(rule: ScheduleRule): string {
  switch (rule.kind) {
    case 'once':
      return `Once, ${describeMoment(rule.at)}`;
    case 'every':
      return rule.window
        ? `${describeInterval(rule.minutes)}, ${rule.window.from}–${rule.window.to}`
        : describeInterval(rule.minutes);
    case 'weekly':
      return `${describeDays(rule.days)} at ${joinList([...rule.times].sort())}`;
  }
}
