import type { OrbPosition } from './events';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Side = 'top' | 'bottom' | 'left' | 'right';

export const ORB_SIZE = 56;
export const ORB_INSET = 24;
export const MENU_ITEM = 38;
export const MENU_RADIUS = 80;
/* A corner leaves a quarter turn, plus the slack of the orb's inset on either side: 110° at
   96 px keeps five items apart and every one of them on screen. */
const CORNER_RADIUS = 96;
const EDGE_SPAN = 150;
const CORNER_SPAN = 110;
const VIEW_MARGIN = 12;

const clamp = (value: number, low: number, high: number) =>
  high < low ? (low + high) / 2 : Math.min(high, Math.max(low, value));

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** The orb's centre for a stored position, pulled back on screen; no position means bottom-middle. */
export function placeOrb(position: OrbPosition | null, viewport: Size): Point {
  const half = ORB_SIZE / 2 + ORB_INSET;
  const x = position ? position.x * viewport.width : viewport.width / 2;
  const y = position ? position.y * viewport.height : viewport.height - half;
  return { x: clamp(x, half, viewport.width - half), y: clamp(y, half, viewport.height - half) };
}

export function toPosition(center: Point, viewport: Size): OrbPosition {
  return { x: round(center.x / viewport.width), y: round(center.y / viewport.height) };
}

export interface Outward {
  /** Degrees on screen: 0 points right, 90 down, -90 up. */
  angle: number;
  cornered: boolean;
}

/**
 * The way out from whichever edges the orb is up against. An orb clear of every edge opens
 * toward the middle of the page — up from the lower half, down from the upper.
 */
export function outwardFrom(center: Point, viewport: Size): Outward {
  const room = CORNER_RADIUS + MENU_ITEM / 2 + VIEW_MARGIN;
  const dx = center.x < room ? 1 : viewport.width - center.x < room ? -1 : 0;
  const near = center.y < room ? 1 : viewport.height - center.y < room ? -1 : 0;
  const dy = dx === 0 && near === 0 ? (center.y > viewport.height / 2 ? -1 : 1) : near;
  return { angle: (Math.atan2(dy, dx) * 180) / Math.PI, cornered: dx !== 0 && dy !== 0 };
}

export interface Slot extends Point {
  angle: number;
}

/**
 * Where each menu item sits around the orb, in order. The arc is centred on the way out and
 * always swept clockwise, so against the bottom edge it runs left to right, and dragging the
 * orb to another edge turns the whole arc — and the order it deals its items out — with it.
 */
export function arcSlots(count: number, outward: Outward): Slot[] {
  const span = outward.cornered ? CORNER_SPAN : EDGE_SPAN;
  const radius = menuRadius(outward);
  return Array.from({ length: count }, (_, index) => {
    const angle = outward.angle - span / 2 + (count === 1 ? span / 2 : (span * index) / (count - 1));
    const radians = (angle * Math.PI) / 180;
    return { angle: round(angle), x: round(Math.cos(radians) * radius), y: round(Math.sin(radians) * radius) };
  });
}

export const menuRadius = (outward: Outward): number => (outward.cornered ? CORNER_RADIUS : MENU_RADIUS);

/** How far from the orb's edge something must sit to clear the open menu. */
export const clearOfMenu = (outward: Outward) => menuRadius(outward) + MENU_ITEM / 2 + 6 - ORB_SIZE / 2;

const SIDE_ANGLES: Record<Side, number> = { top: -90, bottom: 90, left: 180, right: 0 };

/** Sides of the orb, best first: the one facing the way out, then its neighbours, never back into the edge. */
export function sidesFacing(outward: Outward): Side[] {
  const score = (side: Side) => Math.round(Math.cos(((outward.angle - SIDE_ANGLES[side]) * Math.PI) / 180) * 1e6);
  return (['top', 'bottom', 'left', 'right'] as const)
    .map((side, order) => ({ side, order, score: score(side) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ side }) => side);
}

export interface Placement {
  side: Side;
  left: number;
  top: number;
  /** Along the box's edge nearest the orb, how far in the orb's centre falls — where an arrow points from. */
  arrow: number;
}

/** Puts a box beside the orb on the first side it fits, sliding it along that side to stay on screen. */
export function placeBeside(box: Size, orb: Point, gap: number, viewport: Size, sides: Side[]): Placement {
  const reach = ORB_SIZE / 2 + gap;
  const across = (side: Side): Placement => {
    if (side === 'top' || side === 'bottom') {
      const left = clamp(orb.x - box.width / 2, VIEW_MARGIN, viewport.width - VIEW_MARGIN - box.width);
      const top = side === 'top' ? orb.y - reach - box.height : orb.y + reach;
      return { side, left, top, arrow: orb.x - left };
    }
    const top = clamp(orb.y - box.height / 2, VIEW_MARGIN, viewport.height - VIEW_MARGIN - box.height);
    const left = side === 'left' ? orb.x - reach - box.width : orb.x + reach;
    return { side, left, top, arrow: orb.y - top };
  };
  const fits = ({ left, top }: Placement) =>
    left >= VIEW_MARGIN &&
    top >= VIEW_MARGIN &&
    left + box.width <= viewport.width - VIEW_MARGIN &&
    top + box.height <= viewport.height - VIEW_MARGIN;

  const options = sides.map(across);
  return options.find(fits) ?? options[0];
}
