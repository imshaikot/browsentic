export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const TRANSPARENT: Rgb = { r: 0, g: 0, b: 0, a: 0 };
export const WHITE: Rgb = { r: 255, g: 255, b: 255, a: 1 };
export const DARK_CANVAS: Rgb = { r: 18, g: 18, b: 18, a: 1 };

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FUNCTION = /^rgba?\(([^)]+)\)$/i;
const NUMBER = /-?\d*\.?\d+(?:e-?\d+)?%?/gi;

const parsed = new Map<string, Rgb | null>();

export function parseColor(value: string | null | undefined): Rgb | null {
  const text = value?.trim();
  if (!text) return null;
  if (!parsed.has(text)) parsed.set(text, computeColor(text));
  return parsed.get(text) ?? null;
}

function computeColor(text: string): Rgb | null {
  if (text === 'transparent') return TRANSPARENT;
  return fromHex(text) ?? fromRgbFunction(text) ?? fromEngine(text);
}

function fromHex(text: string): Rgb | null {
  if (!HEX.test(text)) return null;
  const digits = text.slice(1);
  const wide = digits.length > 4;
  const step = wide ? 2 : 1;
  const channel = (index: number) => {
    const part = digits.slice(index * step, index * step + step);
    return parseInt(wide ? part : part + part, 16);
  };
  const alpha = digits.length === 4 || digits.length === 8 ? channel(3) / 255 : 1;
  return { r: channel(0), g: channel(1), b: channel(2), a: alpha };
}

function fromRgbFunction(text: string): Rgb | null {
  const body = RGB_FUNCTION.exec(text)?.[1];
  const parts = body?.match(NUMBER);
  if (!parts || parts.length < 3) return null;
  const scaled = (part: string, full: number) =>
    part.endsWith('%') ? (parseFloat(part) / 100) * full : parseFloat(part);
  return {
    r: clampByte(scaled(parts[0], 255)),
    g: clampByte(scaled(parts[1], 255)),
    b: clampByte(scaled(parts[2], 255)),
    a: parts[3] === undefined ? 1 : clamp01(scaled(parts[3], 1)),
  };
}

let probe: CanvasRenderingContext2D | null | undefined;

function probeContext(): CanvasRenderingContext2D | null {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  return probe;
}

function fromEngine(text: string): Rgb | null {
  const context = probeContext();
  if (!context) return null;
  context.fillStyle = '#000000';
  context.fillStyle = text;
  const darkGuess = context.fillStyle;
  context.fillStyle = '#ffffff';
  context.fillStyle = text;
  if (darkGuess !== context.fillStyle) return null;
  return fromHex(context.fillStyle) ?? fromRgbFunction(context.fillStyle) ?? fromPixel(context, text);
}

function fromPixel(context: CanvasRenderingContext2D, text: string): Rgb | null {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = text;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: alpha / 255 };
}

export function toHex({ r, g, b, a }: Rgb): string {
  const pair = (channel: number) => clampByte(channel).toString(16).padStart(2, '0');
  const opacity = a >= 1 ? '' : pair(Math.round(a * 255));
  return `#${pair(r)}${pair(g)}${pair(b)}${opacity}`;
}

export function invertColor({ r, g, b, a }: Rgb): Rgb {
  return { r: 255 - r, g: 255 - g, b: 255 - b, a };
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function linear(channel: number): number {
  const scaled = clampByte(channel) / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(one: Rgb, other: Rgb): number {
  const first = relativeLuminance(one);
  const second = relativeLuminance(other);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function blend(over: Rgb, under: Rgb): Rgb {
  const alpha = over.a + under.a * (1 - over.a);
  if (alpha === 0) return TRANSPARENT;
  const mix = (top: number, bottom: number) =>
    Math.round((top * over.a + bottom * under.a * (1 - over.a)) / alpha);
  return { r: mix(over.r, under.r), g: mix(over.g, under.g), b: mix(over.b, under.b), a: alpha };
}

export function resolvedScheme(): 'light' | 'dark' {
  const declared = getComputedStyle(document.documentElement).colorScheme || 'normal';
  if (!declared.includes('dark')) return 'light';
  if (!declared.includes('light')) return 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function canvasBackdrop(): Rgb {
  return resolvedScheme() === 'dark' ? DARK_CANVAS : WHITE;
}

export function effectiveBackground(el: Element): Rgb {
  let stacked = TRANSPARENT;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const layer = parseColor(getComputedStyle(node).backgroundColor);
    if (!layer || layer.a === 0) continue;
    stacked = blend(stacked, layer);
    if (stacked.a >= 1) return stacked;
  }
  return blend(stacked, canvasBackdrop());
}

export function effectiveForeground(el: Element, background: Rgb): Rgb {
  const own = parseColor(getComputedStyle(el).color) ?? TRANSPARENT;
  return own.a >= 1 ? own : blend(own, background);
}

export function isLargeText(fontSizePx: number, weight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && weight >= 700);
}

export function requiredRatio(large: boolean, level: 'AA' | 'AAA'): number {
  if (level === 'AAA') return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}

export function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export interface FilterChain {
  invert: boolean;
  brightness: number;
  saturate?: number;
  contrast?: number;
}

const INVERTED_HUE = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

export function applyFilters(color: Rgb, chain: FilterChain): Rgb {
  let channels = [color.r, color.g, color.b];
  if (chain.invert) channels = matrix(channels.map((value) => 255 - value), INVERTED_HUE);
  channels = channels.map((value) => value * chain.brightness);
  if (chain.saturate !== undefined) channels = matrix(channels, saturateMatrix(chain.saturate));
  if (chain.contrast !== undefined) {
    channels = channels.map((value) => (value - 127.5) * chain.contrast! + 127.5);
  }
  const [r, g, b] = channels.map(clampByte);
  return { r, g, b, a: color.a };
}

function matrix(channels: number[], rows: number[][]): number[] {
  return rows.map((row) => row[0] * channels[0] + row[1] * channels[1] + row[2] * channels[2]);
}

/**
 * The brightness multiplier that lands `color` on `target` luminance. Solved by bisection
 * rather than by inverting a gamma, because the sRGB curve has a linear toe that a plain
 * power misses by up to 0.025 — enough to overshoot a luminance the caller asked for.
 */
export function brightnessFor(color: Rgb, target: number, min = 0.05, max = 4): number {
  let low = min;
  let high = max;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (relativeLuminance(applyFilters(color, { invert: false, brightness: middle })) < target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return round((low + high) / 2, 3);
}

function saturateMatrix(amount: number): number[][] {
  return [
    [0.213 + 0.787 * amount, 0.715 - 0.715 * amount, 0.072 - 0.072 * amount],
    [0.213 - 0.213 * amount, 0.715 + 0.285 * amount, 0.072 - 0.072 * amount],
    [0.213 - 0.213 * amount, 0.715 - 0.715 * amount, 0.072 + 0.928 * amount],
  ];
}
