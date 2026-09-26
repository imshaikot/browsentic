import { describe, expect, it } from 'vitest';
import {
  MENU_ITEM,
  ORB_INSET,
  ORB_SIZE,
  arcSlots,
  outwardFrom,
  placeBeside,
  placeOrb,
  sidesFacing,
  toPosition,
} from './geometry';

const viewport = { width: 1440, height: 900 };
const ITEMS = 5;
const half = ORB_SIZE / 2 + ORB_INSET;

describe('placeOrb', () => {
  it('starts at the bottom middle', () => {
    expect(placeOrb(null, viewport)).toEqual({ x: 720, y: 900 - half });
  });

  it('keeps a stored position whole on a smaller window', () => {
    expect(placeOrb({ x: 0.99, y: 0.01 }, { width: 400, height: 300 })).toEqual({ x: 400 - half, y: half });
  });

  it('round-trips through a stored position to within a pixel', () => {
    const back = placeOrb(toPosition({ x: 300, y: 450 }, viewport), viewport);
    expect(back.x).toBeCloseTo(300, 0);
    expect(back.y).toBeCloseTo(450, 0);
  });
});

describe('arcSlots', () => {
  it('fans upward from the bottom edge, dealt left to right', () => {
    const slots = arcSlots(ITEMS, outwardFrom(placeOrb(null, viewport), viewport));
    expect(slots.every((slot) => slot.y < 0)).toBe(true);
    expect(slots.map((slot) => slot.x)).toEqual([...slots.map((slot) => slot.x)].sort((a, b) => a - b));
  });

  it('turns the arc and its order with the edge the orb is dragged to', () => {
    const top = arcSlots(ITEMS, outwardFrom({ x: 720, y: half }, viewport));
    expect(top.every((slot) => slot.y > 0)).toBe(true);
    expect(top[0].x).toBeGreaterThan(top[ITEMS - 1].x);

    const left = arcSlots(ITEMS, outwardFrom({ x: half, y: 450 }, viewport));
    expect(left.every((slot) => slot.x > 0)).toBe(true);
    expect(left[0].y).toBeLessThan(left[ITEMS - 1].y);

    const right = arcSlots(ITEMS, outwardFrom({ x: 1440 - half, y: 450 }, viewport));
    expect(right.every((slot) => slot.x < 0)).toBe(true);
    expect(right[0].y).toBeGreaterThan(right[ITEMS - 1].y);
  });

  it('closes to a tighter arc in every corner and keeps every item on screen', () => {
    for (const corner of [
      { x: 1440 - half, y: 900 - half },
      { x: half, y: half },
      { x: half, y: 900 - half },
      { x: 1440 - half, y: half },
    ]) {
      const outward = outwardFrom(corner, viewport);
      expect(outward.cornered).toBe(true);
      for (const slot of arcSlots(ITEMS, outward)) {
        expect(corner.x + slot.x - MENU_ITEM / 2).toBeGreaterThanOrEqual(0);
        expect(corner.y + slot.y - MENU_ITEM / 2).toBeGreaterThanOrEqual(0);
        expect(corner.x + slot.x + MENU_ITEM / 2).toBeLessThanOrEqual(1440);
        expect(corner.y + slot.y + MENU_ITEM / 2).toBeLessThanOrEqual(900);
      }
    }
    expect(outwardFrom({ x: 1440 - half, y: 900 - half }, viewport).angle).toBe(-135);
  });

  it('keeps neighbouring items from overlapping', () => {
    for (const center of [placeOrb(null, viewport), { x: half, y: half }]) {
      const slots = arcSlots(ITEMS, outwardFrom(center, viewport));
      for (let i = 1; i < slots.length; i++) {
        expect(Math.hypot(slots[i].x - slots[i - 1].x, slots[i].y - slots[i - 1].y)).toBeGreaterThan(MENU_ITEM);
      }
    }
  });

  it('opens toward the middle of the page when clear of every edge', () => {
    expect(outwardFrom({ x: 720, y: 600 }, viewport).angle).toBe(-90);
    expect(outwardFrom({ x: 720, y: 300 }, viewport).angle).toBe(90);
  });
});

describe('placeBeside', () => {
  const box = { width: 300, height: 160 };

  it('puts a caption above an orb on the bottom edge, centred over it', () => {
    const orb = placeOrb(null, viewport);
    const placed = placeBeside(box, orb, 14, viewport, sidesFacing(outwardFrom(orb, viewport)));
    expect(placed.side).toBe('top');
    expect(placed.left + box.width / 2).toBe(orb.x);
    expect(placed.arrow).toBe(box.width / 2);
  });

  it('slides along the side instead of leaving the screen, and moves the arrow with it', () => {
    const orb = { x: 1440 - half, y: 900 - half };
    const placed = placeBeside(box, orb, 14, viewport, sidesFacing(outwardFrom(orb, viewport)));
    expect(placed.side).toBe('top');
    expect(placed.left + box.width).toBeLessThanOrEqual(1440 - 12);
    expect(placed.arrow).toBeGreaterThan(box.width / 2);
  });

  it('falls to the next side when the preferred one has no room', () => {
    const orb = { x: half, y: 120 };
    const placed = placeBeside(box, orb, 14, viewport, ['top', 'right', 'bottom']);
    expect(placed.side).toBe('right');
  });
});
