import { existsSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { logPath } from './lockfile';
import { log } from './log';

beforeEach(() => {
  rmSync(logPath, { force: true });
  rmSync(`${logPath}.1`, { force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the daemon log', () => {
  test('each line is stamped, with any detail after the message', () => {
    log('probe finished', { ready: true });
    expect(readFileSync(logPath, 'utf8')).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z probe finished {"ready":true}\n$/);
  });

  test('an error is written as its name and message, not its stack', () => {
    log('spawn failed', new TypeError('bin is not a string'));
    expect(readFileSync(logPath, 'utf8')).toContain('spawn failed TypeError: bin is not a string\n');
  });

  test('past 2 MB it moves aside and starts again', () => {
    writeFileSync(logPath, '');
    truncateSync(logPath, 2 * 1024 * 1024 + 1);
    log('fresh start');
    expect([existsSync(`${logPath}.1`), readFileSync(logPath, 'utf8').includes('fresh start')]).toEqual([true, true]);
  });

  test('with BROWSENTIC_DEBUG set, each line also goes to stderr', () => {
    vi.stubEnv('BROWSENTIC_DEBUG', '1');
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    log('debugging', 'detail');
    expect(String(stderr.mock.calls[0][0])).toMatch(/ debugging detail\n$/);
  });
});
