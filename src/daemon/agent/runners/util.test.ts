import { existsSync, mkdirSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { logPath, stateDir } from '../../lockfile';
import { effortOf, parseJsonBlob, parseJsonLine, sweepRunDirs } from './util';

describe('sweeping run directories', () => {
  const base = join(stateDir, 'sweep-test');
  const aged = (name: string, hoursAgo: number) => {
    const dir = join(base, name);
    mkdirSync(dir, { recursive: true });
    const at = (Date.now() - hoursAgo * 60 * 60_000) / 1000;
    utimesSync(dir, at, at);
    return dir;
  };

  test('a directory older than a day goes, and a newer one stays', () => {
    const [old, recent] = [aged('yesterday', 25), aged('this-morning', 3)];
    sweepRunDirs(base);
    expect([existsSync(old), existsSync(recent)]).toEqual([false, true]);
  });

  test('the age limit can be shortened', () => {
    const dir = aged('an-hour-ago', 1);
    sweepRunDirs(base, 30 * 60_000);
    expect(existsSync(dir)).toBe(false);
  });

  test('a base that does not exist yet is nothing to sweep', () => {
    expect(() => sweepRunDirs(join(stateDir, 'never-made'))).not.toThrow();
  });
});

describe('reasoning effort', () => {
  test('an effort the CLI accepts is passed on', () => {
    expect(effortOf({ bin: 'x', effort: 'high' }, ['low', 'high'])).toBe('high');
  });

  test('no effort chosen is no effort sent', () => {
    expect(effortOf({ bin: 'x' }, ['low', 'high'])).toBeUndefined();
  });

  test('an effort the CLI would reject is dropped, and the log says what it accepts', () => {
    expect(effortOf({ bin: 'x', effort: 'turbo' }, ['low', 'high'])).toBeUndefined();
    expect(readFileSync(logPath, 'utf8')).toContain('ignoring effort "turbo" — accepted values are low, high');
  });
});

describe('reading JSON a CLI printed', () => {
  test('a line of JSON is parsed', () => {
    expect(parseJsonLine('{"type":"result"}')).toEqual({ type: 'result' });
  });

  test('a line that is not JSON is null', () => {
    expect(parseJsonLine('Loading…')).toBeNull();
  });

  test('an object wrapped in prose is found', () => {
    expect(parseJsonBlob('Here is the summary:\n{"title":"Pricing","pages":3}\nHope that helps!')).toEqual({ title: 'Pricing', pages: 3 });
  });

  test('text with no object in it is null', () => {
    expect([parseJsonBlob('no braces here'), parseJsonBlob('} backwards {'), parseJsonBlob('{"broken": }')]).toEqual([null, null, null]);
  });
});
