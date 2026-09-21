import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { stateDir } from '../lockfile';
import { forgetGrants, isGranted, listGrants, rememberGrant } from './approvals';

const approvalsPath = join(stateDir, 'approvals.json');
const at = '2026-09-21T10:00:00.000Z';

beforeEach(() => {
  mkdirSync(stateDir, { recursive: true });
  rmSync(approvalsPath, { force: true });
});

describe('standing approvals', () => {
  test('nothing is granted until the user says "always on this site"', () => {
    expect(isGranted('page.submitForm', 'example.com')).toBe(false);
  });

  test('a grant covers that one action on that one host', () => {
    rememberGrant('page.submitForm', 'example.com', at);
    expect([
      isGranted('page.submitForm', 'example.com'),
      isGranted('page.submitForm', 'evil.example'),
      isGranted('page.attachFile', 'example.com'),
    ]).toEqual([true, false, false]);
  });

  test('granting the same pair again moves it to the front instead of adding a second', () => {
    rememberGrant('page.submitForm', 'example.com', at);
    rememberGrant('page.attachFile', 'example.com', at);
    rememberGrant('page.submitForm', 'example.com', '2026-09-22T10:00:00.000Z');
    expect(listGrants().map((grant) => [grant.action, grant.at])).toEqual([
      ['page.submitForm', '2026-09-22T10:00:00.000Z'],
      ['page.attachFile', at],
    ]);
  });

  test('only the newest two hundred are kept', () => {
    for (let i = 0; i < 205; i++) rememberGrant('page.submitForm', `site-${i}.example`, at);
    expect([listGrants().length, isGranted('page.submitForm', 'site-204.example'), isGranted('page.submitForm', 'site-4.example')]).toEqual([200, true, false]);
  });

  test('the file is readable only by the user', () => {
    rememberGrant('page.submitForm', 'example.com', at);
    expect(statSync(approvalsPath).mode & 0o777).toBe(0o600);
  });
});

describe('forgetting', () => {
  beforeEach(() => {
    rememberGrant('page.submitForm', 'example.com', at);
    rememberGrant('page.attachFile', 'example.com', at);
    rememberGrant('page.submitForm', 'shop.example', at);
  });

  test("one host's grants can be forgotten, and the count comes back", () => {
    expect([forgetGrants('example.com'), listGrants().map((grant) => grant.host)]).toEqual([2, ['shop.example']]);
  });

  test('forgetting with no host forgets everything', () => {
    expect([forgetGrants(), listGrants()]).toEqual([3, []]);
  });
});

describe('a damaged file', () => {
  test('entries that are not grants are ignored', () => {
    writeFileSync(approvalsPath, JSON.stringify({ grants: [{ action: 'page.submitForm', host: 'example.com', at }, { action: 'page.submitForm' }, null, 'x'] }));
    expect(listGrants()).toEqual([{ action: 'page.submitForm', host: 'example.com', at }]);
  });

  test('a file that is not JSON grants nothing', () => {
    writeFileSync(approvalsPath, '{"grants": [');
    expect(listGrants()).toEqual([]);
  });

  test('a file without a list grants nothing', () => {
    writeFileSync(approvalsPath, JSON.stringify({ grants: { 'example.com': true } }));
    expect(listGrants()).toEqual([]);
  });
});
