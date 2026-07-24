// Generates placeholder extension icons (violet gradient + white sound bars)
// as raw PNGs with no image dependencies. Run: npm run icons
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
const BARS = [
  { x: 0.3, h: 0.28 },
  { x: 0.5, h: 0.5 },
  { x: 0.7, h: 0.28 },
];

function distToVSegment(px, py, x, y1, y2) {
  const cy = clamp(py, y1, y2);
  return Math.hypot(px - x, py - cy);
}

function makePixelFn(size) {
  const corner = size * 0.22;
  const barHalfW = size * 0.055;
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

    let barCov = 0;
    for (const bar of BARS) {
      const halfH = Math.max((bar.h * size) / 2 - barHalfW, 0);
      const d = distToVSegment(x, y, bar.x * size, size / 2 - halfH, size / 2 + halfH);
      barCov = Math.max(barCov, clamp(barHalfW + 0.5 - d, 0, 1));
    }
    r = lerp(r, 255, barCov);
    g = lerp(g, 255, barCov);
    b = lerp(b, 255, barCov);

    return [Math.round(r), Math.round(g), Math.round(b), Math.round(bg * 255)];
  };
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  const file = join(outDir, `${size}.png`);
  writeFileSync(file, png(size, makePixelFn(size)));
  console.log(`wrote ${file}`);
}
