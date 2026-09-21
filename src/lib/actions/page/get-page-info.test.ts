import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getPageInfo } from './get-page-info';

const PAGE = `
  <header><nav aria-label="Primary"><a href="/pricing">Pricing</a></nav></header>
  <main>
    <h1>Sign in</h1>
    <form id="login">
      <input id="email" type="email" aria-label="Email" />
      <button type="submit">Continue</button>
      <div role="button">More options</div>
    </form>
  </main>`;

const snapshot = (input: { geometry?: boolean } = {}) =>
  getPageInfo.execute(getPageInfo.input.parse(input)) as {
    layout: Record<string, unknown> & { diagram: string };
    interactive: Record<'links' | 'buttons' | 'fields', Record<string, unknown>[]>;
  };

beforeEach(() => {
  document.body.innerHTML = PAGE;
  // happy-dom lays nothing out, and an element with no box counts as hidden.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 300, 40));
});

describe('the layout', () => {
  test('is the diagram alone, with each region ending in its selector', () => {
    const { layout } = snapshot();
    expect(Object.keys(layout)).toEqual(['diagram']);
    expect(layout.diagram.split('\n').slice(1)).toEqual([
      '├ banner · 300×40 @ (10,20) · 1 links · selector: body > header',
      '│ └ navigation “Primary” · 300×40 @ (10,20) · 1 links · selector: body > header > nav',
      '└ main “Sign in” · 300×40 @ (10,20) · 2 buttons · 1 fields · selector: body > main',
      '  └ form · 300×40 @ (10,20) · 2 buttons · 1 fields · selector: #login',
    ]);
  });
});

describe('the inventory', () => {
  test('leaves out the tag and role its list already implies, and keeps the ones it does not', () => {
    const { links, buttons, fields } = snapshot().interactive;
    expect([links, buttons, fields]).toEqual([
      [{ selector: 'body > header > nav > a', text: 'Pricing', href: expect.stringContaining('/pricing'), region: 'navigation “Primary”' }],
      [
        { selector: '#login > button', text: 'Continue', region: 'form' },
        { tag: 'div', role: 'button', selector: '#login > div', text: 'More options', region: 'form' },
      ],
      [expect.objectContaining({ tag: 'input', role: 'textbox', selector: '#email', kind: 'email' })],
    ]);
  });

  test('carries bounds only when geometry is asked for', () => {
    const bounds = (input: { geometry?: boolean }) => snapshot(input).interactive.buttons.map((button) => button.bounds);
    expect([bounds({}), bounds({ geometry: true })]).toEqual([
      [undefined, undefined],
      [
        { x: 10, y: 20, width: 300, height: 40 },
        { x: 10, y: 20, width: 300, height: 40 },
      ],
    ]);
  });
});
