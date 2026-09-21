import { describe, expect, test } from 'vitest';
import { hostAllowed, hostBearingUrl, scopeFor, targetUrl, urlPayloadBytes } from './scope';

describe('hostAllowed', () => {
  const HOSTS: [host: string, hosts: string[], want: boolean][] = [
    ['example.com', ['example.com'], true],
    ['www.example.com', ['example.com'], true],
    ['app.example.com', ['example.com'], true],
    ['EXAMPLE.com.', ['example.com'], true],
    ['example.com.evil.com', ['example.com'], false],
    ['notexample.com', ['example.com'], false],
    ['evil.com', ['example.com'], false],
    ['evil.com', ['*'], true],
    ['evil.com', [], false],
    ['', ['example.com'], false],
  ];
  for (const [host, hosts, want] of HOSTS) {
    test(`hostAllowed(${host || '""'}, [${hosts}])`, () => {
      expect(hostAllowed(host, hosts)).toBe(want);
    });
  }
});

describe('scopeFor', () => {
  test('scope from the starting tab', () => {
    expect(scopeFor({ url: 'https://www.example.com/a' }).hosts).toEqual(['example.com']);
  });

  test('scope picks up hosts the user named', () => {
    expect(scopeFor({ url: 'https://a.com/', instruction: 'compare with docs.b.com please' }).hosts).toEqual(['a.com', 'docs.b.com']);
  });

  test('scope ignores filenames in prose', () => {
    expect(scopeFor({ url: 'https://a.com/', instruction: 'read notes.txt and report.pdf' }).hosts).toEqual(['a.com']);
  });

  test('scope with no starting point is unconfined', () => {
    expect(scopeFor({ instruction: 'search for kettles' }).hosts).toEqual(['*']);
  });

  test('config "*" disables confinement', () => {
    expect(scopeFor({ url: 'https://a.com/', extraHosts: ['*'] }).hosts).toEqual(['*']);
  });

  test('pinTab off leaves the run roaming', () => {
    expect(scopeFor({ url: 'https://a.com/', tabId: 7 }).tabId).toBeUndefined();
  });

  test('pinTab on pins the tab', () => {
    expect(scopeFor({ url: 'https://a.com/', tabId: 7, pinTab: true }).tabId).toBe(7);
  });
});

test('url payload counts query and fragment', () => {
  expect(urlPayloadBytes(new URL('https://a.com/p?q=12345#ab'))).toBe(11);
});

// Whether a url string brings its own host or borrows the page's. The probes are two constants
// carrying the whole classification, so this table is what catches an edit that makes them
// agree — `//one.probe.invalid/x` in particular, which proves that naming a probe buys a
// reference nothing.
describe('targetUrl', () => {
  const TARGET_KINDS: [url: string, kind: string][] = [
    ['https://evil.com/x', 'absolute'],
    ['javascript:alert(1)', 'absolute'],
    ['https:evil.com/x', 'absolute'],
    ['//evil.com/x', 'authority'],
    ['\\\\evil.com/x', 'authority'],
    ['/\\evil.com/x', 'authority'],
    ['\t//evil.com/x', 'authority'],
    ['/\t/evil.com', 'authority'],
    ['//example.com@evil.com/', 'authority'],
    ['//0x7f000001/x', 'authority'],
    ['//one.probe.invalid/x', 'authority'],
    ['/pricing', 'path'],
    ['\\evil.com/x', 'path'],
    ['#//evil.com', 'path'],
    ['/%2f/evil.com/x', 'path'],
    ['//', 'opaque'],
    ['//evil.com%09/x', 'opaque'],
  ];
  for (const [url, kind] of TARGET_KINDS) {
    test(`targetUrl reads ${JSON.stringify(url)} as ${kind}`, () => {
      expect(targetUrl('page.navigate', { url })?.kind).toBe(kind);
    });
  }

  test('a non-navigation has no target', () => {
    expect(targetUrl('page.clickElement', { url: '//evil.com/x' })).toBeNull();
  });

  test('nor does a history move', () => {
    expect(targetUrl('page.navigate', { action: 'back' })).toBeNull();
  });

  test('only a host the caller supplied is judged', () => {
    expect([hostBearingUrl('page.navigate', { url: '//evil.com/x' })?.hostname, hostBearingUrl('page.navigate', { url: '/pricing' })]).toEqual(['evil.com', null]);
  });
});
