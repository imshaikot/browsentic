import { describe, expect, it } from 'vitest';
import { MAX_HIDDEN_SITES, asNewTabChoice, browserNewTabPage, hideSite } from './new-tab';

describe('asNewTabChoice', () => {
  it('opens Home with frequent sites until the user says otherwise', () => {
    expect(asNewTabChoice(undefined)).toEqual({ home: true, sites: true, hidden: [] });
    expect(asNewTabChoice('on')).toEqual({ home: true, sites: true, hidden: [] });
  });

  it('keeps what the user switched off', () => {
    expect(asNewTabChoice({ home: false, sites: false, hidden: ['example.com'] })).toEqual({
      home: false,
      sites: false,
      hidden: ['example.com'],
    });
  });

  it('drops anything in the hidden list that is not a host', () => {
    expect(asNewTabChoice({ hidden: ['a.com', 7, null, 'b.com'] }).hidden).toEqual(['a.com', 'b.com']);
    expect(asNewTabChoice({ hidden: 'a.com' }).hidden).toEqual([]);
  });

  it('keeps only the newest hidden hosts', () => {
    const hidden = Array.from({ length: MAX_HIDDEN_SITES + 5 }, (_, index) => `site${index}.com`);
    const kept = asNewTabChoice({ hidden }).hidden;
    expect(kept).toHaveLength(MAX_HIDDEN_SITES);
    expect(kept.at(-1)).toBe(`site${MAX_HIDDEN_SITES + 4}.com`);
  });
});

describe('hideSite', () => {
  it('adds a host once, as the newest', () => {
    const choice = asNewTabChoice({ hidden: ['a.com', 'b.com'] });
    expect(hideSite(choice, 'a.com').hidden).toEqual(['b.com', 'a.com']);
    expect(hideSite(choice, 'c.com').hidden).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('leaves the other switches as they were', () => {
    expect(hideSite(asNewTabChoice({ sites: false }), 'a.com')).toMatchObject({ home: true, sites: false });
  });
});

describe('browserNewTabPage', () => {
  it('hands Google Chrome back its own page', () => {
    expect(browserNewTabPage('Google Chrome')).toBe('chrome://new-tab-page/');
  });

  it('has no page to hand back anywhere else', () => {
    for (const brand of ['Microsoft Edge', 'Brave', 'Opera', 'Chromium', undefined]) expect(browserNewTabPage(brand)).toBeNull();
  });
});
