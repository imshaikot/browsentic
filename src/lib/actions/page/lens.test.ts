import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_ATTRIBUTE } from '@/lib/overlay';
import { pickWithLens, steerLens, type LensOutcome } from './lens';

function stage() {
  const button = document.createElement('button');
  button.textContent = 'Sign in';
  document.body.append(button);
  const orb = document.createElement('div');
  orb.setAttribute(OVERLAY_ATTRIBUTE, '');
  document.documentElement.append(orb);
  return { button, orb };
}

function pointAt(target: Element) {
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10 }));
}

function clickAt(target: Element) {
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
  window.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10, bubbles: true, cancelable: true }));
}

function settled(pick: Promise<LensOutcome>) {
  let outcome: LensOutcome | null = null;
  void pick.then((value) => (outcome = value));
  return () => outcome;
}

describe('pickWithLens', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    for (const host of document.querySelectorAll(`[${OVERLAY_ATTRIBUTE}]`)) host.remove();
  });

  it('picks the page element under the click', async () => {
    const { button } = stage();
    const pick = pickWithLens({ timeoutMs: 5_000 });
    pointAt(button);
    clickAt(button);
    await expect(pick).resolves.toEqual({ picked: button });
  });

  it('never picks an overlay the extension drew, even right after hovering the page', async () => {
    const { button, orb } = stage();
    const pick = pickWithLens({ timeoutMs: 5_000 });
    const outcome = settled(pick);

    pointAt(button);
    pointAt(orb);
    clickAt(orb);
    await Promise.resolve();
    expect(outcome()).toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(pick).resolves.toEqual({ cancelled: true });
  });

  it('is steered without a single page event, so a control the page never lets click is picked all the same', async () => {
    const { button } = stage();
    button.disabled = true;
    const heard = vi.fn();
    button.addEventListener('click', heard);
    const pick = pickWithLens({ timeoutMs: 5_000 });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
    expect(steerLens({ op: 'aim', x: 10, y: 10 })).toBe(true);
    expect(steerLens({ op: 'pick', x: 10, y: 10 })).toBe(true);
    await expect(pick).resolves.toEqual({ picked: button });
    expect(heard).not.toHaveBeenCalled();
    expect(steerLens({ op: 'cancel' })).toBe(false);
  });

  it('a steered pick after ↑ takes the wider element, and one aimed elsewhere takes what it landed on', async () => {
    const { button } = stage();
    const other = document.createElement('a');
    document.body.append(other);
    const wider = pickWithLens({ timeoutMs: 5_000 });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(button);
    steerLens({ op: 'aim', x: 10, y: 10 });
    steerLens({ op: 'wider' });
    steerLens({ op: 'pick', x: 10, y: 10 });
    await expect(wider).resolves.toEqual({ picked: document.body });

    const elsewhere = pickWithLens({ timeoutMs: 5_000 });
    steerLens({ op: 'aim', x: 10, y: 10 });
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(other);
    steerLens({ op: 'pick', x: 90, y: 90 });
    await expect(elsewhere).resolves.toEqual({ picked: other });
  });

  it('keeps a finger’s touches from the page, whose handlers could otherwise cancel the tap', async () => {
    const { button } = stage();
    const heard = vi.fn();
    document.addEventListener('touchstart', heard, { capture: true });
    document.addEventListener('touchend', heard, { capture: true });
    const pick = pickWithLens({ timeoutMs: 5_000 });
    button.dispatchEvent(new Event('touchstart', { bubbles: true }));
    button.dispatchEvent(new Event('touchend', { bubbles: true }));
    expect(heard).not.toHaveBeenCalled();
    steerLens({ op: 'cancel' });
    await expect(pick).resolves.toEqual({ cancelled: true });
    document.removeEventListener('touchstart', heard, { capture: true });
    document.removeEventListener('touchend', heard, { capture: true });
  });
});
