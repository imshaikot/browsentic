import { describe, expect, test } from 'vitest';
import { failure, success } from '@/lib/actions/protocol';
import { SAVE_SITE_MAP_ACTION } from '@/lib/actions/reserved';
import { gateMappingInvoke, noteMappingResult, type MapRun } from './mapping';

const mapRun = (settings: Partial<MapRun['settings']> = {}, visited: string[] = []): MapRun => ({
  target: { host: 'www.example.com', origin: 'https://www.example.com', domain: 'example.com', name: 'example-com' },
  staging: { id: 'staging-1', dir: '/staging', screenshots: '/staging/screenshots', evidence: '/staging/evidence', pages: '/staging/pages' },
  index: { source: 'none', documents: 0, urlCount: 0, truncated: false, paths: [], patterns: [], raw: '' },
  settings: { research: true, allowClicks: false, maxPages: 3, maxScreenshots: 2, timeoutMs: 60_000, ...settings },
  shots: 0,
  pagesVisited: new Set(visited),
  offSite: null,
  submitted: false,
});

const verdict = (run: MapRun, action: string, input: unknown = {}) => {
  const gate = gateMappingInvoke(run, action, input);
  return gate.allow ? 'allowed' : gate.result.ok ? 'allowed' : gate.result.error.code;
};

describe('what a mapping run may do', () => {
  test('looking at a page is allowed', () => {
    expect(['page.getPageInfo', 'page.extractText', 'page.scrollTo', 'page.hoverElement', 'page.findSearch'].map((action) => verdict(mapRun(), action))).toEqual(
      Array(5).fill('allowed'),
    );
  });

  test('changing a page is not', () => {
    expect(['page.fillInput', 'page.submitForm', 'page.typeText', 'page.runScript'].map((action) => verdict(mapRun(), action))).toEqual(
      Array(4).fill('MAPPING_READ_ONLY'),
    );
  });

  test('clicking is refused unless the settings allow it', () => {
    expect([verdict(mapRun(), 'page.clickElement'), verdict(mapRun({ allowClicks: true }), 'page.clickElement')]).toEqual(['MAPPING_READ_ONLY', 'allowed']);
  });

  test('handing in the report is always allowed, and no other reserved action is', () => {
    expect([verdict(mapRun(), SAVE_SITE_MAP_ACTION), verdict(mapRun(), 'browsentic.focusShot')]).toEqual(['allowed', 'UNKNOWN_ACTION']);
  });
});

describe('navigating while mapping', () => {
  test('any page on the site being mapped is allowed', () => {
    expect(verdict(mapRun(), 'page.navigate', { url: 'https://www.example.com/pricing' })).toBe('allowed');
  });

  test('another origin is off the site, subdomain or not', () => {
    expect(
      ['https://evil.example/', 'https://docs.example.com/', 'http://www.example.com/'].map((url) => verdict(mapRun(), 'page.navigate', { url })),
    ).toEqual(Array(3).fill('MAPPING_OFF_SITE'));
  });

  test('a relative address is refused with an example of an absolute one', () => {
    const gate = gateMappingInvoke(mapRun(), 'page.navigate', { url: '/pricing' });
    expect(gate).toEqual({
      allow: false,
      result: failure('MAPPING_OFF_SITE', 'While mapping, page_navigate needs an absolute URL like https://www.example.com/pricing — not "/pricing".'),
    });
  });

  test('going back or forward is refused, because history can lead anywhere, but reloading is fine', () => {
    expect(['back', 'forward', 'reload'].map((action) => verdict(mapRun(), 'page.navigate', { action }))).toEqual([
      'MAPPING_OFF_SITE',
      'MAPPING_OFF_SITE',
      'allowed',
    ]);
  });

  test('navigating nowhere is invalid', () => {
    expect([verdict(mapRun(), 'page.navigate', {}), verdict(mapRun(), 'page.navigate', { url: '  ' })]).toEqual(['INVALID_INPUT', 'INVALID_INPUT']);
  });

  test('once the page budget is spent, only pages already seen may be revisited', () => {
    const run = mapRun({ maxPages: 2 }, ['/', '/pricing']);
    expect([
      verdict(run, 'page.navigate', { url: 'https://www.example.com/docs' }),
      verdict(run, 'page.navigate', { url: 'https://www.example.com/pricing?plan=pro' }),
    ]).toEqual(['MAPPING_BUDGET', 'allowed']);
  });
});

describe('drifting off the site', () => {
  test('a tab that lands elsewhere may only navigate back until it returns', () => {
    const run = mapRun();
    noteMappingResult(run, 'page.navigate', success({ navigatedTo: 'https://accounts.example.net/login' }));
    const whileAway = [verdict(run, 'page.getPageInfo'), verdict(run, 'page.navigate', { url: 'https://www.example.com/' })];
    noteMappingResult(run, 'page.getPageInfo', success({ document: { url: 'https://www.example.com/' } }));
    expect([whileAway, verdict(run, 'page.getPageInfo'), run.offSite]).toEqual([['MAPPING_OFF_SITE', 'allowed'], 'allowed', null]);
  });

  test('each page landed on is counted once, by path', () => {
    const run = mapRun();
    for (const url of ['https://www.example.com/', 'https://www.example.com/pricing', 'https://www.example.com/pricing#faq']) {
      noteMappingResult(run, 'page.navigate', success({ navigatedTo: url }));
    }
    expect([...run.pagesVisited]).toEqual(['/', '/pricing']);
  });

  test('a failed action, or one that says nothing about where the tab is, changes nothing', () => {
    const run = mapRun();
    noteMappingResult(run, 'page.navigate', failure('TIMEOUT', 'slow'));
    noteMappingResult(run, 'page.extractText', success({ content: 'https://evil.example' }));
    noteMappingResult(run, 'page.navigate', success({ navigatedTo: 'not a url' }));
    expect([run.pagesVisited.size, run.offSite]).toEqual([0, null]);
  });
});

describe('screenshots while mapping', () => {
  test('each is saved into the staged map, numbered and named after the last page seen', () => {
    const run = mapRun({}, ['/', '/Plans & Pricing']);
    expect(gateMappingInvoke(run, 'page.screenshot', {})).toEqual({
      allow: true,
      saveTo: { dir: '/staging/screenshots', filename: '01-plans-pricing.png' },
    });
  });

  test('the home page is named home', () => {
    expect(gateMappingInvoke(mapRun(), 'page.screenshot', {})).toMatchObject({ saveTo: { filename: '01-home.png' } });
  });

  test('a taken screenshot counts against the budget, and a spent budget refuses the next', () => {
    const run = mapRun({ maxScreenshots: 1 });
    noteMappingResult(run, 'page.screenshot', success({ dataUrl: 'data:image/png;base64,' }));
    expect([run.shots, verdict(run, 'page.screenshot')]).toEqual([1, 'MAPPING_BUDGET']);
  });
});
