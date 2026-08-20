// Renders public/icon/{16,32,48,96,128}.png — the extension icon and the site favicon.
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

function oklch(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return lin.map((v) => {
    const c = clamp(v, 0, 1);
    const enc = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return enc * 255;
  });
}

const BG_TOP = oklch(0.208, 0.021, 50);
const BG_BOTTOM = oklch(0.138, 0.014, 52);
const BRAND = oklch(0.83, 0.13, 195);

const FRAME = { x0: 2.25, y0: 4.25, x1: 29.75, y1: 27.75, r: 6, stroke: 1.5, alpha: 0.55 };
const TITLEBAR = { y: 10.5, x0: 2.5, x1: 29.5, stroke: 1.25, alpha: 0.35 };
const CHROME_DOTS = [
  { x: 6.4, y: 7.4, r: 1, alpha: 0.5 },
  { x: 9.8, y: 7.4, r: 1, alpha: 0.35 },
];

// The two cubics of `M9 22.2 c2.4 0 2.4-6.4 6.9-6.4 s4.6 6.4 7 6.4`, expanded.
const CURVE = [
  [
    [9, 22.2],
    [11.4, 22.2],
    [11.4, 15.8],
    [15.9, 15.8],
  ],
  [
    [15.9, 15.8],
    [20.4, 15.8],
    [20.5, 22.2],
    [22.9, 22.2],
  ],
];
const CURVE_STROKE = 1.75;

const NODES = [
  { x: 9, y: 22.2, r: 2.35, filled: false },
  { x: 15.9, y: 15.8, r: 2.55, filled: true },
  { x: 22.9, y: 22.2, r: 2.35, filled: false },
];
const NODE_STROKE = 1.6;

const CLUSTER = { x: 15.95, y: 19.4 };

const CURVE_POINTS = (() => {
  const pts = [];
  for (const [p0, p1, p2, p3] of CURVE) {
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  }
  return pts;
})();

function rrectSdf(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  );
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function polylineDist(px, py, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = segDist(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (d < best) best = d;
  }
  return best;
}

function detailFor(size) {
  if (size >= 96) return { frame: true, titlebar: true, dots: true, scale: 1, boost: 1, curveBoost: 1, solidNodes: false };
  if (size >= 48) return { frame: true, titlebar: true, dots: false, scale: 1, boost: 1.1, curveBoost: 1.1, solidNodes: false };
  if (size >= 32) return { frame: true, titlebar: false, dots: false, scale: 1, boost: 1.25, curveBoost: 1.15, solidNodes: false };
  // 16px: ring interiors fall under a pixel, so nodes go solid; scale is capped by
  // the outer node edge, 16 - (6.95 + 2.35) * scale, staying inside the tile.
  return { frame: false, titlebar: false, dots: false, scale: 1.45, boost: 1.5, curveBoost: 0.8, solidNodes: true };
}

function makePixelFn(size) {
  const d = detailFor(size);
  const unit = size / 32;

  const tx = (x) => (d.scale === 1 ? x : (x - CLUSTER.x) * d.scale + 16) * unit;
  const ty = (y) => (d.scale === 1 ? y : (y - CLUSTER.y) * d.scale + 16) * unit;
  const ts = (v) => v * d.scale * unit;

  const curvePts = CURVE_POINTS.map(([x, y]) => [tx(x), ty(y)]);
  const nodes = NODES.map((n) => ({
    x: tx(n.x),
    y: ty(n.y),
    r: ts(n.r),
    filled: n.filled || d.solidNodes,
  }));
  const curveHalf = (ts(CURVE_STROKE) * d.curveBoost) / 2;
  const nodeHalf = (ts(NODE_STROKE) * d.boost) / 2;
  const bgCorner = size * 0.22;

  return (ix, iy) => {
    const x = ix + 0.5;
    const y = iy + 0.5;

    const tile = clamp(
      0.5 - rrectSdf(x, y, size / 2, size / 2, size / 2, size / 2, bgCorner),
      0,
      1,
    );
    if (tile === 0) return [0, 0, 0, 0];

    const t = (x + y) / (2 * size);
    let r = lerp(BG_TOP[0], BG_BOTTOM[0], t);
    let g = lerp(BG_TOP[1], BG_BOTTOM[1], t);
    let b = lerp(BG_TOP[2], BG_BOTTOM[2], t);

    const paint = (alpha) => {
      if (alpha <= 0) return;
      const a = clamp(alpha, 0, 1);
      r = lerp(r, BRAND[0], a);
      g = lerp(g, BRAND[1], a);
      b = lerp(b, BRAND[2], a);
    };

    if (d.frame) {
      const half = (FRAME.stroke * unit * d.boost) / 2;
      const sdf = rrectSdf(
        x,
        y,
        ((FRAME.x0 + FRAME.x1) / 2) * unit,
        ((FRAME.y0 + FRAME.y1) / 2) * unit,
        ((FRAME.x1 - FRAME.x0) / 2) * unit,
        ((FRAME.y1 - FRAME.y0) / 2) * unit,
        FRAME.r * unit,
      );
      paint(FRAME.alpha * clamp(half + 0.5 - Math.abs(sdf), 0, 1));
    }

    if (d.titlebar) {
      const half = (TITLEBAR.stroke * unit) / 2;
      const dist = segDist(x, y, TITLEBAR.x0 * unit, TITLEBAR.y * unit, TITLEBAR.x1 * unit, TITLEBAR.y * unit);
      paint(TITLEBAR.alpha * clamp(half + 0.5 - dist, 0, 1));
    }

    if (d.dots) {
      for (const dot of CHROME_DOTS) {
        const dist = Math.hypot(x - dot.x * unit, y - dot.y * unit);
        paint(dot.alpha * clamp(dot.r * unit + 0.5 - dist, 0, 1));
      }
    }

    // The connector runs behind the outlined nodes; their interiors punch it back out.
    let occlusion = 1;
    for (const n of nodes) {
      if (n.filled) continue;
      occlusion *= 1 - clamp(n.r - nodeHalf + 0.5 - Math.hypot(x - n.x, y - n.y), 0, 1);
    }
    paint(clamp(curveHalf + 0.5 - polylineDist(x, y, curvePts), 0, 1) * occlusion);

    for (const n of nodes) {
      const dist = Math.hypot(x - n.x, y - n.y);
      paint(
        n.filled
          ? clamp(n.r + 0.5 - dist, 0, 1)
          : clamp(nodeHalf + 0.5 - Math.abs(dist - n.r), 0, 1),
      );
    }

    return [Math.round(r), Math.round(g), Math.round(b), Math.round(tile * 255)];
  };
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 96, 128]) {
  const file = join(outDir, `${size}.png`);
  writeFileSync(file, png(size, makePixelFn(size)));
  console.log(`wrote ${file}`);
}
