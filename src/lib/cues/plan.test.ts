import { describe, expect, it } from 'vitest';
import { actions } from '@/lib/actions/registry';
import { cueFor, hasCueRule } from './plan';

describe('cueFor', () => {
  it('has a rule for every action, so a new one has to choose its cue', () => {
    const missing = [...actions.keys()].filter((name) => !hasCueRule(name));
    expect(missing).toEqual([]);
  });

  it('copies where an action lands and nothing it types', () => {
    const secret = 'hunter2';
    const plans = [
      cueFor('page.fillInput', { target: { selector: '#pw' }, value: secret }),
      cueFor('page.typeText', { target: { selector: '#pw' }, text: secret }),
      cueFor('page.typeText', { text: secret }),
      cueFor('page.searchSite', { query: secret }),
      cueFor('page.pressKey', { key: 'h' }),
      cueFor('page.selectOption', { target: { selector: 'select' }, value: secret, label: secret }),
      cueFor('page.attachFile', { target: { selector: 'input' }, content: secret, name: secret }),
    ];
    for (const plan of plans) expect(JSON.stringify(plan)).not.toContain(secret);
    expect(JSON.stringify(cueFor('page.pressKey', { key: 'h' }))).not.toContain('"h"');
  });

  it('rings the element an action names, with nothing beyond the target fields', () => {
    expect(cueFor('page.clickElement', { target: { selector: '#go', text: 'Go', extra: 'x' } })).toEqual({
      kind: 'element',
      verb: 'Click',
      anchors: [{ target: { selector: '#go', text: 'Go', role: undefined, nth: 0 } }],
    });
  });

  it('falls back to the focused element for typing, and to the page for the rest', () => {
    expect(cueFor('page.typeText', { text: 'hi' })).toMatchObject({ kind: 'element', anchors: [{ focused: true }] });
    expect(cueFor('page.pressKey', { key: 'Enter' })).toMatchObject({ kind: 'element', detail: 'Enter' });
    expect(cueFor('page.scrollTo', { direction: 'down' })).toMatchObject({ kind: 'page', verb: 'Scroll' });
    expect(cueFor('page.extractText', {})).toMatchObject({ kind: 'page', verb: 'Read' });
  });

  it('marks both ends of a drag, by element or by point', () => {
    expect(cueFor('page.dragElement', { from: { selector: '#card' }, toPoint: { x: 10, y: 20 } }).anchors).toEqual([
      { target: { selector: '#card', text: undefined, role: undefined, nth: 0 } },
      { point: { x: 10, y: 20 } },
    ]);
  });

  it('names only the host a navigation goes to', () => {
    expect(cueFor('page.navigate', { url: 'https://example.com/account?token=abc' })).toEqual({
      kind: 'page',
      verb: 'Go to',
      detail: 'example.com',
      anchors: [],
    });
    expect(cueFor('page.navigate', { action: 'back' })).toMatchObject({ verb: 'Go back' });
  });

  it('clears the page before anything that reads its pixels', () => {
    for (const name of ['page.screenshot', 'page.solveCaptcha', 'page.findCaptcha', 'page.pickElement']) {
      expect(cueFor(name, {})).toMatchObject({ kind: 'none', quench: true });
    }
  });

  it('draws nothing for an action it does not know', () => {
    expect(cueFor('page.somethingNew', { target: { selector: 'a' } })).toMatchObject({ kind: 'none' });
  });
});
