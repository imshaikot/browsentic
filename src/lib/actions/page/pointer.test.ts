import { afterEach, describe, expect, it } from 'vitest';
import { OVERLAY_ATTRIBUTE } from '@/lib/overlay';
import { assertUncovered, elementAt } from './pointer';

function stage() {
  const footer = document.createElement('button');
  footer.textContent = 'Accept cookies';
  document.body.append(footer);
  const orb = document.createElement('div');
  orb.setAttribute(OVERLAY_ATTRIBUTE, '');
  document.documentElement.append(orb);
  return { footer, orb };
}

/* happy-dom lays nothing out, so what stands at a point is whatever the test stacks there. */
function stacked(...elements: Element[]) {
  document.elementsFromPoint = () => elements;
}

describe('elementAt', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    for (const host of document.querySelectorAll(`[${OVERLAY_ATTRIBUTE}]`)) host.remove();
  });

  it('looks through the hands-free mic to the page beneath it', () => {
    const { footer, orb } = stage();
    stacked(orb, footer, document.body);
    expect(elementAt({ x: 400, y: 700 })).toBe(footer);
    expect(() => assertUncovered(footer, { x: 400, y: 700 })).not.toThrow();
  });

  it('still reports what the page itself put over an element', () => {
    const { footer } = stage();
    const banner = document.createElement('div');
    banner.id = 'banner';
    document.body.append(banner);
    stacked(banner, footer, document.body);
    expect(() => assertUncovered(footer, { x: 400, y: 700 })).toThrow(/covers \(400, 700\)/);
  });
});
