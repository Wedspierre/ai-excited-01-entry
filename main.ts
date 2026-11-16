// ai-excited-01 entry: a colossal koi leaps up a waterfall that pours
// upward into a starry night sky. Procedural, deterministic, stdlib only.
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;

// ---------- deterministic PRNG (fixed seed; no Date, no Math.random) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261116);
const rr = (lo: number, hi: number): number => lo + rand() * (hi - lo);

// ---------- canvas ----------
type RGB = [number, number, number];
const px = new Uint8ClampedArray(W * H * 3);

function blend(x: number, y: number, c: RGB, a: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= H || a <= 0) return;
  const i = (yi * W + xi) * 3;
  if (a >= 1) {
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    return;
  }
  px[i] = px[i] + (c[0] - px[i]) * a;
  px[i + 1] = px[i + 1] + (c[1] - px[i + 1]) * a;
  px[i + 2] = px[i + 2] + (c[2] - px[i + 2]) * a;
}

function circle(cx: number, cy: number, r: number, c: RGB, a: number): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) {
        const d = Math.sqrt(d2);
        const edge = Math.min(1, Math.max(0, r + 0.5 - d));
        blend(x, y, c, a * edge);
      }
    }
  }
}

// Soft radial glow: alpha falls off quadratically to the rim.
function glow(cx: number, cy: number, r: number, c: RGB, a: number): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d < 1) {
        const f = (1 - d) * (1 - d);
        blend(x, y, c, a * f);
      }
    }
  }
}

function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, w * 0.4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    circle(x0 + dx * t, y0 + dy * t, w / 2, c, a);
  }
}

function vgrad(stops: [number, RGB][]): void {
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        s0 = stops[i];
        s1 = stops[i + 1];
        break;
      }
    }
    const f = s1[0] === s0[0] ? 0 : (t - s0[0]) / (s1[0] - s0[0]);
    const r = s0[1][0] + (s1[1][0] - s0[1][0]) * f;
    const g = s0[1][1] + (s1[1][1] - s0[1][1]) * f;
    const b = s0[1][2] + (s1[1][2] - s0[1][2]) * f;
    const base = y * W * 3;
    for (let x = 0; x < W; x++) {
      const i = base + x * 3;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a: number): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) blend(x, y, c, a);
    }
  }
}

// Rotated ellipse as a polygon (for fins).
function ellipsePoly(cx: number, cy: number, rx: number, ry: number, rot: number): number[][] {
  const pts: number[][] = [];
  const steps = 28;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const ex = Math.cos(a) * rx;
    const ey = Math.sin(a) * ry;
    pts.push([
      cx + ex * Math.cos(rot) - ey * Math.sin(rot),
      cy + ex * Math.sin(rot) + ey * Math.cos(rot),
    ]);
  }
  return pts;
}

// Scanline polygon fill (even-odd).
function poly(points: number[][], c: RGB, a: number): void {
  let minY = H;
  let maxY = 0;
  for (const p of points) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(H - 1, Math.ceil(maxY));
  const n = points.length;
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % n];
      if ((p0[1] <= y && p1[1] > y) || (p1[1] <= y && p0[1] > y)) {
        const t = (y - p0[1]) / (p1[1] - p0[1]);
        xs.push(p0[0] + t * (p1[0] - p0[0]));
      }
    }
    xs.sort((a2, b2) => a2 - b2);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) blend(x, y, c, a);
    }
  }
}

// Catmull-Rom spline through control points.
function catmull(pts: number[][], per: number): number[][] {
  const out: number[][] = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    for (let j = 0; j < per; j++) {
      const t = j / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

// A tube of overlapping circles along a spine, radius per sample.
function tube(spine: number[][], radii: number[], c: RGB, a: number, dx = 0, dy = 0): void {
  for (let i = 0; i < spine.length; i++) {
    circle(spine[i][0] + dx, spine[i][1] + dy, radii[i], c, a);
  }
}

// ---------- PNG encoder (own CRC32 + zlib deflate) ----------
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  const src = Buffer.from(px.buffer, px.byteOffset, px.byteLength);
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    src.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- scene: sky, stars, moon ----------
const WHITE: RGB = [255, 255, 255];
const FOAM: RGB = [234, 247, 255];
const ICE: RGB = [191, 224, 247];
const WATER: RGB = [111, 168, 216];
const DEEP: RGB = [46, 111, 176];

function drawSky(): void {
  vgrad([
    [0, [7, 10, 38]],
    [0.45, [20, 26, 77]],
    [0.75, [52, 38, 104]],
    [1, [88, 52, 110]],
  ]);
  // faint nebula clouds
  const neb: RGB[] = [[122, 79, 208], [192, 90, 158], [58, 111, 208], [150, 80, 200]];
  for (let i = 0; i < 9; i++) {
    glow(rr(0, W), rr(0, H * 0.75), rr(120, 260), neb[i % neb.length], rr(0.05, 0.1));
  }
  // milky way: a faint diagonal band of tiny dots, bottom-left to top-right
  for (let i = 0; i < 520; i++) {
    const t = rand();
    const x = t * W + rr(-30, 30);
    const y = 950 - t * 700 + rr(-120, 120);
    circle(x, y, rr(0.6, 1.6), [207, 224, 255], rr(0.1, 0.35));
  }
  // stars, biased toward the upper sky
  const starCols: RGB[] = [[255, 255, 255], [207, 224, 255], [255, 233, 176]];
  for (let i = 0; i < 320; i++) {
    const x = rr(0, W);
    const y = 1024 * Math.pow(rand(), 1.4);
    const r = rr(0.7, 2.1);
    circle(x, y, r, starCols[i % 3], rr(0.5, 1));
  }
  // a few bright stars with a cross sparkle
  for (let i = 0; i < 14; i++) {
    const x = rr(40, W - 40);
    const y = rr(30, 620);
    const r = rr(2.2, 3.2);
    const l = rr(8, 16);
    circle(x, y, r, WHITE, 1);
    thickLine(x - l, y, x + l, y, 1.6, WHITE, 0.7);
    thickLine(x, y - l, x, y + l, 1.6, WHITE, 0.7);
  }
}

function drawMoon(): void {
  const mx = 792;
  const my = 168;
  glow(mx, my, 210, [255, 217, 138], 0.1);
  glow(mx, my, 130, [255, 226, 160], 0.14);
  circle(mx, my, 76, [255, 238, 192], 1);
  // craters
  circle(mx - 26, my - 14, 14, [232, 207, 154], 0.55);
  circle(mx + 18, my + 22, 10, [232, 207, 154], 0.5);
  circle(mx + 30, my - 30, 7, [232, 207, 154], 0.45);
  circle(mx - 6, my + 34, 6, [232, 207, 154], 0.4);
  // lit rim on the moon's lower-left edge
  glow(mx - 40, my + 40, 60, [255, 240, 200], 0.25);
}

// ---------- scene: the waterfall that pours UPWARD ----------
// Control points of the rising column (bottom -> top) and its radius.
const FALL_PTS: number[][] = [
  [540, 1030],
  [520, 880],
  [492, 700],
  [486, 520],
  [505, 350],
  [545, 240],
  [578, 170],
];
const FALL_RAD: number[] = [145, 128, 102, 80, 62, 42, 30];

// Column centre x and radius at a given y (linear interpolation; y is monotonic).
function fallAt(y: number): [number, number] {
  for (let i = 0; i < FALL_PTS.length - 1; i++) {
    const y0 = FALL_PTS[i][1];
    const y1 = FALL_PTS[i + 1][1];
    if (y <= y0 && y >= y1) {
      const f = (y0 - y) / (y0 - y1);
      return [
        FALL_PTS[i][0] + (FALL_PTS[i + 1][0] - FALL_PTS[i][0]) * f,
        FALL_RAD[i] + (FALL_RAD[i + 1] - FALL_RAD[i]) * f,
      ];
    }
  }
  return [FALL_PTS[FALL_PTS.length - 1][0], FALL_RAD[FALL_RAD.length - 1]];
}

function drawWaterfall(): void {
  const spine = catmull(FALL_PTS, 14);
  const radii: number[] = [];
  for (let i = 0; i < spine.length; i++) {
    const f = i / (spine.length - 1);
    radii.push(FALL_RAD[0] + (FALL_RAD[FALL_RAD.length - 1] - FALL_RAD[0]) * f);
  }
  // outer column, then a brighter core (kept translucent: the koi is the hero)
  tube(spine, radii, WATER, 0.38);
  tube(spine, radii.map((r) => r * 0.5), ICE, 0.35);
  // fast vertical streaks inside the column
  for (let i = 0; i < 120; i++) {
    const y = rr(180, 1000);
    const [cx, r] = fallAt(y);
    const x = cx + rr(-r * 0.85, r * 0.85);
    const len = rr(30, 140);
    const cols: RGB[] = [WHITE, ICE, WATER];
    thickLine(x, y, x + rr(-8, 8), y - len, rr(2, 6), cols[i % 3], rr(0.15, 0.5));
  }
  // spray bursting off the column's edges
  for (let i = 0; i < 170; i++) {
    const y = rr(200, 950);
    const [cx, r] = fallAt(y);
    const side = rand() < 0.5 ? -1 : 1;
    const x = cx + side * r * rr(0.8, 1.18);
    circle(x, y, rr(1, 3.5), WHITE, rr(0.4, 0.9));
    if (rand() < 0.4) {
      thickLine(x, y, x + rr(-6, 6), y + rr(6, 18), 2, ICE, 0.5);
    }
  }
  // streaks dissolving the top edge into the sky, so it ends in spray, not a cap
  for (let i = 0; i < 26; i++) {
    const x = 548 + rr(-70, 70);
    const y0 = rr(130, 210);
    thickLine(x, y0, x + rr(-6, 6), y0 - rr(30, 80), rr(2, 4), i % 2 === 0 ? WHITE : ICE, rr(0.3, 0.6));
  }
  // feather the column's edges
  for (let i = 0; i < 40; i++) {
    const y = rr(220, 980);
    const [cx, r] = fallAt(y);
    const side = rand() < 0.5 ? -1 : 1;
    glow(cx + side * r * rr(0.9, 1.1), y, rr(14, 26), WATER, 0.15);
  }
  // the top of the fall disperses: droplets that become stars
  for (let i = 0; i < 90; i++) {
    const y = rr(20, 200);
    const spread = 30 + (200 - y) * 0.7;
    const x = 548 + rr(-spread, spread);
    const r = rr(0.8, 2.6);
    circle(x, y, r, i % 3 === 0 ? ICE : WHITE, rr(0.5, 1));
    if (i % 9 === 0) {
      const l = rr(5, 9);
      thickLine(x - l, y, x + l, y, 1.4, WHITE, 0.6);
      thickLine(x, y - l, x, y + l, 1.4, WHITE, 0.6);
    }
  }
}

// ---------- scene: the colossal koi ----------
// Spine from head (top) to tail base (bottom), an S-curve of pure thrust.
const KOI_PTS: number[][] = [
  [470, 268],
  [420, 372],
  [460, 486],
  [540, 606],
  [625, 716],
  [655, 812],
  [618, 880],
];
const KOI_RAD: number[] = [48, 68, 92, 100, 88, 66, 40];

const KOI_ORANGE: RGB = [255, 122, 26];
const KOI_LIGHT: RGB = [255, 154, 61];
const KOI_DEEP: RGB = [232, 93, 4];
const KOI_BELLY: RGB = [255, 243, 221];
const KOI_DARK: RGB = [28, 28, 48];

function drawKoi(): void {
  const spine = catmull(KOI_PTS, 16);
  const radii: number[] = [];
  for (let i = 0; i < spine.length; i++) {
    const f = i / (spine.length - 1);
    // smooth radius profile: interpolate the control radii
    const seg = f * (KOI_RAD.length - 1);
    const j = Math.min(KOI_RAD.length - 2, Math.floor(seg));
    const g = seg - j;
    radii.push(KOI_RAD[j] + (KOI_RAD[j + 1] - KOI_RAD[j]) * g);
  }

  // moonlit rim: a pale-gold tube offset up-left, mostly covered by the body
  tube(spine, radii.map((r) => r + 5), [255, 210, 122], 0.95, -7, -9);
  // shadow edge on the lower-right side, for dimension
  tube(spine, radii.map((r) => r + 3), KOI_DEEP, 0.5, 7, 8);
  // body
  tube(spine, radii, KOI_ORANGE, 1);
  // warm highlight along the upper back
  tube(spine, radii.map((r) => r * 0.72), KOI_LIGHT, 0.55, -6, -8);
  // cream belly, offset down the screen (narrow, so the orange dominates)
  const bellySpine = spine.map((p, i) => [p[0], p[1] + radii[i] * 0.3]);
  tube(bellySpine, radii.map((r) => r * 0.45), KOI_BELLY, 0.6);
  // a slightly wider head cap, so the head reads as a head
  poly(ellipsePoly(470, 272, 54, 46, -0.3), KOI_ORANGE, 1);
  poly(ellipsePoly(466, 256, 40, 26, -0.3), KOI_LIGHT, 0.5);

  // deep-orange patches on the back
  poly(ellipsePoly(470, 480, 32, 44, -0.35), KOI_DEEP, 0.7);
  poly(ellipsePoly(560, 640, 36, 48, 0.25), KOI_DEEP, 0.7);
  poly(ellipsePoly(430, 360, 24, 34, -0.2), KOI_DEEP, 0.65);
  poly(ellipsePoly(610, 760, 27, 36, 0.3), KOI_DEEP, 0.65);
  // black spots, small: koi markings, not holes
  circle(500, 540, 6, KOI_DARK, 0.7);
  circle(600, 700, 5, KOI_DARK, 0.7);
  circle(455, 420, 5, KOI_DARK, 0.65);
  circle(585, 600, 4, KOI_DARK, 0.65);

  // dorsal fin: a narrow wavy crest along the back, upper-left side,
  // free edge ~25px outside the body's left edge, inner edge tucked in
  const dorsal: number[][] = [
    [368, 330],
    [348, 375],
    [332, 420],
    [340, 460],
    [352, 500],
    [390, 550],
    [428, 600],
    [456, 600],
    [380, 500],
    [360, 420],
    [394, 335],
  ];
  poly(dorsal, KOI_LIGHT, 0.95);
  thickLine(368, 330, 332, 420, 2.5, KOI_DEEP, 0.7);
  thickLine(332, 420, 352, 500, 2.5, KOI_DEEP, 0.7);
  thickLine(352, 500, 428, 600, 2.5, KOI_DEEP, 0.7);

  // pectoral fins, spread wide as it climbs
  poly(ellipsePoly(344, 457, 58, 20, -0.7), KOI_DEEP, 0.55);
  poly(ellipsePoly(340, 455, 52, 17, -0.7), KOI_LIGHT, 0.95);
  poly(ellipsePoly(528, 406, 38, 13, 0.5), KOI_DEEP, 0.85);
  thickLine(340, 455, 300, 486, 3, [255, 210, 140], 0.6);

  // eye: fixed on the sky above, with a bright catchlight
  circle(448, 252, 10, KOI_DARK, 1);
  circle(444, 248, 3.5, WHITE, 1);
  // mouth, a small curve under the snout
  thickLine(458, 292, 478, 296, 3, KOI_DEEP, 0.6);
  // barbels streaming back from the snout's corners
  thickLine(452, 250, 424, 212, 2.5, [255, 176, 102], 0.9);
  thickLine(424, 212, 392, 194, 2.5, [255, 176, 102], 0.9);
  thickLine(490, 252, 516, 214, 2.5, [255, 176, 102], 0.9);
  thickLine(516, 214, 544, 196, 2.5, [255, 176, 102], 0.9);
}

// The tail: one broad forked fin fanning over the pool, not three thin ribbons.
function drawTail(): void {
  const tailPoly: number[][] = [
    [592, 858],
    [520, 905],
    [430, 940],
    [350, 958],
    [420, 968],
    [520, 950],
    [600, 938],
    [680, 950],
    [780, 968],
    [860, 955],
    [780, 938],
    [690, 908],
    [644, 862],
  ];
  poly(tailPoly, [255, 178, 105], 0.85);
  // flow streaks from the tail base out to the lobes
  thickLine(610, 880, 400, 950, 4, KOI_ORANGE, 0.55);
  thickLine(625, 880, 810, 950, 4, KOI_ORANGE, 0.55);
  thickLine(618, 885, 600, 935, 3, KOI_ORANGE, 0.5);
  // pale rims along the lobe edges
  thickLine(350, 958, 430, 944, 3, [255, 233, 201], 0.7);
  thickLine(860, 955, 780, 942, 3, [255, 233, 201], 0.7);
}

// ---------- scene: pool, rocks, foam, finishing spray ----------
function drawPoolAndRocks(): void {
  // the pool the fall rises out of
  ellipse(520, 985, 430, 60, [13, 44, 85], 0.9);
  // the moon's reflection, broken gold dashes under the moon
  for (let i = 0; i < 8; i++) {
    const y = 955 + i * 8;
    thickLine(790 - rr(15, 38), y, 790 + rr(15, 38), y, 3, [255, 217, 138], rr(0.25, 0.5));
  }
  // ripple rings
  for (const [rx, ry] of [[200, 28], [300, 40], [380, 52]] as [number, number][]) {
    for (let a = 0; a < Math.PI * 2; a += 0.03) {
      blend(520 + Math.cos(a) * rx, 985 + Math.sin(a) * ry, WHITE, 0.22);
    }
  }
  // dark cliff silhouettes framing the bottom corners, kept low
  poly(
    [
      [0, 1024],
      [0, 985],
      [70, 950],
      [150, 925],
      [230, 955],
      [300, 985],
      [320, 1024],
    ],
    [10, 13, 32],
    1,
  );
  poly(
    [
      [1024, 1024],
      [1024, 980],
      [950, 945],
      [880, 920],
      [810, 950],
      [740, 985],
      [720, 1024],
    ],
    [10, 13, 32],
    1,
  );
  // moonlit rims along the cliff tops
  thickLine(0, 985, 70, 950, 3, [143, 184, 255], 0.45);
  thickLine(70, 950, 150, 925, 3, [143, 184, 255], 0.45);
  thickLine(150, 925, 230, 955, 3, [143, 184, 255], 0.45);
  thickLine(1024, 980, 950, 945, 3, [143, 184, 255], 0.45);
  thickLine(950, 945, 880, 920, 3, [143, 184, 255], 0.45);
  thickLine(880, 920, 810, 950, 3, [143, 184, 255], 0.45);
  // foam bursting where the fall leaves the pool
  for (let i = 0; i < 70; i++) {
    glow(520 + rr(-165, 165), rr(930, 1005), rr(3, 12), FOAM, rr(0.15, 0.45));
  }
}

function drawFrontSpray(): void {
  // a few bright droplets in front of the koi: depth, and the rush of the climb
  const spine = catmull(KOI_PTS, 16);
  for (let i = 0; i < 36; i++) {
    const p = spine[Math.floor(rand() * spine.length)];
    circle(p[0] + rr(-130, 130), p[1] + rr(-90, 90), rr(1, 3), WHITE, rr(0.3, 0.7));
  }
}

// ---------- main ----------
function main(): void {
  drawSky();
  drawMoon();
  drawWaterfall();
  drawKoi();
  drawFrontSpray();
  drawPoolAndRocks();
  drawTail();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), encodePNG());
}

main();
