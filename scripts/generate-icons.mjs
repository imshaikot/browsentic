// Generates the extension icons as raw PNGs with no image dependencies. Run: yarn icons
//
// The mark is the product in three parts: the tile itself is the *browser* (a lighter chrome
// strip across the top with tab dots), the waveform below it is *voice*, and the two
// interlocking rings threaded through the waveform are the *link*. Detail is dropped as the
// canvas shrinks — see DETAIL below — because a 16px toolbar icon cannot hold three glyphs.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixelAt) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const o = y * stride + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const VIOLET = [139, 92, 246];
const INDIGO = [79, 70, 229];

// Every measurement is a fraction of the icon's edge, so one layout drives all five sizes.
const CORNER = 0.22;
const STRIP_H = 0.26; // browser chrome: a lighter band across the top of the tile
const DOTS = { y: 0.135, r: 0.036, x: [0.135, 0.225, 0.315] };
const CENTER_Y = 0.62; // middle of the content area below the strip
// `half` is half the bar's total height, caps included.
const BARS_FULL = [
  { x: 0.215, half: 0.07 },
  { x: 0.3, half: 0.14 },
  { x: 0.7, half: 0.14 },
  { x: 0.785, half: 0.07 },
];
const BARS_PLAIN = [
  { x: 0.32, half: 0.1 },
  { x: 0.5, half: 0.19 },
  { x: 0.68, half: 0.1 },
];
// Two rings on the 45° diagonal — the orientation every link glyph uses. Side by side they
// read as the letters "CO" instead; tilting them is what makes the pair say "chain". `off`
// is each centre's distance from the middle along that diagonal, at 0.79×r so the strokes
// cross: closer and the holes merge, further and it is two loose circles.
const CHAIN = { off: 0.059, r: 0.075, halfW: 0.021 };

// Below 48px the rings close up into a blob and the dots land on half a pixel, so both drop
// out and the waveform widens to carry the icon alone. 16px keeps only the strip and bars.
function detailFor(size) {
  return { rings: size >= 48, dots: size >= 32, barHalfW: size >= 48 ? 0.026 : 0.06 };
}

// At 16 and 32 a bar is one or two pixels wide, and a fractional centre splits it across two
// columns at half coverage each — the bar washes out into the gradient instead of reading as
// white. Snapping edges to the pixel grid is what keeps the toolbar icon crisp; the larger
// sizes have the resolution to anti-alias smoothly and are left alone.
const snapEdge = (v, on) => (on ? Math.round(v) : v);
const snapMid = (v, on) => (on ? Math.floor(v) + 0.5 : v);

function distToVSegment(px, py, x, y1, y2) {
  const cy = clamp(py, y1, y2);
  return Math.hypot(px - x, py - cy);
}

function makePixelFn(size) {
  const { rings, dots, barHalfW: barHalfWFrac } = detailFor(size);
  const snap = !rings;
  const corner = size * CORNER;
  const barHalfW = snap ? Math.max(1, Math.round(size * barHalfWFrac)) : size * barHalfWFrac;
  const bars = rings ? BARS_FULL : BARS_PLAIN;
  const cy = snapEdge(size * CENTER_Y, snap);
  const stripY = snapEdge(size * STRIP_H, snap);
  const ringR = size * CHAIN.r;
  const ringHalfW = size * CHAIN.halfW;
  // The break that makes one ring read as passing behind the other; never below a pixel.
  const ringGap = Math.max(1, size * 0.014);
  const ringOff = (size * CHAIN.off) / Math.SQRT2; // 45°, so the same offset on both axes
  const backX = size * 0.5 - ringOff;
  const backY = cy + ringOff;
  const frontX = size * 0.5 + ringOff;
  const frontY = cy - ringOff;

  return (ix, iy) => {
    const x = ix + 0.5;
    const y = iy + 0.5;
    // Rounded-rect coverage with ~1px anti-aliasing
    const dx = Math.max(corner - x, x - (size - corner), 0);
    const dy = Math.max(corner - y, y - (size - corner), 0);
    const bg = clamp(corner + 0.5 - Math.hypot(dx, dy), 0, 1);
    if (bg === 0) return [0, 0, 0, 0];

    const t = (x + y) / (2 * size);
    let r = lerp(VIOLET[0], INDIGO[0], t);
    let g = lerp(VIOLET[1], INDIGO[1], t);
    let b = lerp(VIOLET[2], INDIGO[2], t);

    // Browser: the chrome strip, then the tab dots once they have pixels to land on.
    let white = 0.18 * clamp(stripY + 0.5 - y, 0, 1);
    if (dots) {
      const dotR = snap ? Math.max(1, Math.round(DOTS.r * size)) : DOTS.r * size;
      const dotY = snapMid(DOTS.y * size, snap);
      for (const dotX of DOTS.x) {
        const d = Math.hypot(x - snapMid(dotX * size, snap), y - dotY);
        white = Math.max(white, 0.75 * clamp(dotR + 0.5 - d, 0, 1));
      }
    }

    // Voice: the waveform.
    let ink = 0;
    for (const bar of bars) {
      const halfH = Math.max(snapEdge(bar.half * size, snap) - barHalfW, 0);
      const d = distToVSegment(x, y, snapEdge(bar.x * size, snap), cy - halfH, cy + halfH);
      ink = Math.max(ink, clamp(barHalfW + 0.5 - d, 0, 1));
    }

    // Link: two rings threaded through the waveform. The back one is hidden by the whole
    // front disc, not just where the strokes cross — clip only at the stroke and its far arc
    // still shows through the front ring's hole, which reads as a smudge rather than a chain.
    if (rings) {
      const toFront = Math.hypot(x - frontX, y - frontY);
      const back = Math.abs(Math.hypot(x - backX, y - backY) - ringR);
      const front = Math.abs(toFront - ringR);
      const occluded = clamp(toFront - (ringR + ringHalfW + ringGap) + 0.5, 0, 1);
      ink = Math.max(
        ink,
        clamp(ringHalfW + 0.5 - back, 0, 1) * occluded,
        clamp(ringHalfW + 0.5 - front, 0, 1),
      );
    }

    white = Math.max(white, ink);
    r = lerp(r, 255, white);
    g = lerp(g, 255, white);
    b = lerp(b, 255, white);

    return [Math.round(r), Math.round(g), Math.round(b), Math.round(bg * 255)];
  };
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  const file = join(outDir, `${size}.png`);
  writeFileSync(file, png(size, makePixelFn(size)));
  console.log(`wrote ${file}`);
}
