import { describe, expect, test } from 'vitest';
import {
  BLOCKED_SITES_LIMITS,
  blockedBy,
  compileBlockedSites,
  describePattern,
  parseBlockedPattern,
  subjectOf,
} from './blocked-sites';

const blocks = (pattern: string, url: string) => blockedBy(url, compileBlockedSites([pattern])!) !== null;

function normalized(entry: string): string {
  const parsed = parseBlockedPattern(entry);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.pattern;
}

describe('what an entry is stored as', () => {
  test.each([
    ['example.com', 'example.com'],
    ['  Example.COM  ', 'example.com'],
    ['https://www.example.com/', 'example.com'],
    ['http://example.com', 'example.com'],
    ['*://example.com/admin', 'example.com/admin'],
    ['*.example.com', 'example.com'],
    ['www.com', 'www.com'],
    ['example.com./admin/', 'example.com/admin'],
    ['example.com/%61dmin', 'example.com/admin'],
    ['example.com//admin', 'example.com/admin'],
    ['example.com?q=1', 'example.com/?q=1'],
    ['example.com/admin#section', 'example.com/admin'],
    ['localhost:3000', 'localhost:3000'],
    ['example.com:443', 'example.com'],
    ['bücher.de', 'xn--bcher-kva.de'],
    ['bank.*', 'bank.*'],
    ['[::1]:8080', '[::1]:8080'],
    ['GitHub.com/*/Settings', 'github.com/*/Settings'],
  ])('%s → %s', (entry, pattern) => {
    expect(normalized(entry)).toBe(pattern);
  });

  test.each([
    [''],
    ['   '],
    ['*'],
    ['*.*'],
    ['ftp://example.com'],
    ['chrome-extension://abc/options.html'],
    ['javascript:alert(1)'],
    ['exa mple.com'],
    ['user@example.com'],
    ['example.com:99999'],
    ['%%%'],
    ['bü*cher.de'],
    ['x'.repeat(BLOCKED_SITES_LIMITS.length + 1)],
  ])('%j is refused with a reason', (entry) => {
    const parsed = parseBlockedPattern(entry);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.reason).toBeTruthy();
  });
});

describe('which pages a pattern blocks', () => {
  test.each([
    ['example.com', 'https://example.com/', true],
    ['example.com', 'https://mail.example.com/inbox?x=1', true],
    ['example.com', 'http://example.com:8080/any/where', true],
    ['example.com', 'https://EXAMPLE.com/', true],
    ['example.com', 'https://example.com./', true],
    ['example.com', 'https://user:pass@example.com/', true],
    ['example.com', 'https://notexample.com/', false],
    ['example.com', 'https://example.com.evil.net/', false],
    ['example.com', 'https://evil.net/example.com', false],
    ['example.com', 'https://evil.net/?next=https://example.com', false],
    ['mail.example.com', 'https://mail.example.com/x', true],
    ['mail.example.com', 'https://a.mail.example.com/', true],
    ['mail.example.com', 'https://example.com/', false],
    ['example.com/admin', 'https://example.com/admin', true],
    ['example.com/admin', 'https://example.com/admin/users', true],
    ['example.com/admin', 'https://example.com/admin?tab=1', true],
    ['example.com/admin', 'https://example.com/Admin', true],
    ['example.com/admin', 'https://example.com/%61dmin', true],
    ['example.com/admin', 'https://example.com//admin', true],
    ['example.com/admin', 'https://example.com/admin;jsessionid=1', true],
    ['example.com/admin', 'https://example.com/administrator', false],
    ['example.com/admin', 'https://example.com/', false],
    ['example.com/admin/', 'https://example.com/admin', true],
    ['example.com/checkout*', 'https://example.com/checkout-step-2', true],
    ['github.com/*/settings', 'https://github.com/acme/settings/keys', true],
    ['github.com/*/settings', 'https://github.com/acme/issues', false],
    ['example.com/search?q=secret', 'https://example.com/search?q=secret&page=2', true],
    ['example.com/search?q=secret', 'https://example.com/search?q=other', false],
    ['bank.*', 'https://bank.co.uk/', true],
    ['bank.*', 'https://www.bank.com/login', true],
    ['bank.*', 'https://bank/', false],
    ['*shop*.com', 'https://myshop-eu.com/', true],
    ['*shop*.com', 'https://shop.example.org/', false],
    ['localhost:3000', 'http://localhost:3000/app', true],
    ['localhost:3000', 'http://localhost:3001/app', false],
    ['bücher.de', 'https://xn--bcher-kva.de/', true],
    ['127.0.0.1', 'http://127.0.0.1:5173/', true],
    ['example.com/a+b(c)', 'https://example.com/a+b(c)/d', true],
    ['example.com/a+b(c)', 'https://example.com/aab(c)', false],
  ])('%s on %s → %s', (pattern, url, want) => {
    expect(blocks(pattern, url)).toBe(want);
  });

  test('only web pages can be blocked', () => {
    const list = compileBlockedSites(['example.com'])!;
    expect(blockedBy('chrome://settings', list)).toBeNull();
    expect(blockedBy('file:///example.com/x', list)).toBeNull();
    expect(blockedBy(undefined, list)).toBeNull();
    expect(blockedBy('not a url', list)).toBeNull();
  });

  test('the first matching pattern is named', () => {
    const list = compileBlockedSites(['other.org', 'example.com/admin', 'example.com'])!;
    expect(blockedBy('https://example.com/admin/x', list)).toBe('example.com/admin');
    expect(blockedBy('https://example.com/home', list)).toBe('example.com');
  });
});

describe('reading the stored list', () => {
  test('nothing stored blocks nothing', () => {
    expect(compileBlockedSites(undefined)).toEqual([]);
  });

  test('a stored value that is not a list is refused, so the caller fails closed', () => {
    expect(compileBlockedSites('example.com')).toBeNull();
    expect(compileBlockedSites({ 0: 'example.com' })).toBeNull();
    expect(compileBlockedSites(null)).toBeNull();
  });

  test('entries that do not parse are skipped, the rest still apply', () => {
    expect(compileBlockedSites(['example.com', 42, '*', 'ftp://x.org'])!.map((p) => p.pattern)).toEqual(['example.com']);
  });
});

test('the subject is host, port, path and query — never the hash', () => {
  expect(subjectOf('https://Example.com:8443/a//b?c=1#frag')).toBe('example.com:8443/a/b?c=1');
  expect(subjectOf('http://example.com:80/')).toBe('example.com/');
});

test.each([
  ['example.com', 'Every page on example.com and its subdomains'],
  ['localhost:3000', 'Every page on localhost, port 3000'],
  ['127.0.0.1:8080/admin', 'Pages under /admin on 127.0.0.1, port 8080'],
  ['example.com/admin', 'Pages under /admin on example.com and its subdomains'],
  ['github.com/*/settings', 'Pages matching /*/settings on github.com and its subdomains'],
  ['bank.*', 'Every page on sites matching bank.*'],
])('%s is described as “%s”', (pattern, caption) => {
  expect(describePattern(pattern)).toBe(caption);
});
