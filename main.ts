// ai-excited-01 entry — "The Leap"
// A Node 22 program (stdlib only, no network) that draws one image, fully
// procedurally, and writes it to $MAKEFUN_OUTPUT_DIR/entry.png
// (default /output/entry.png). The image is 1024x1024, deterministic:
// a fixed-seed PRNG, no Date, no randomness, no file reads, no network,
// so two runs write byte-identical files.
//
// The image: a blue whale frozen mid-breach in a huge arc OVER a
// lighthouse on a moonlit sea, a tiny rowboat below for impossible scale.
// One diagonal of motion, warm moonlight and lamp-beam against a cold
// indigo sea — a jolt of awe at first glance, a twist of scale, momentum
// toward the single moment before the whale comes down.
//
// Usage: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic PRNG (fixed seed). Not Math.random: the output must be
// byte-identical on every run.
// ---------------------------------------------------------------------------
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
const rnd = mulberry32(20261116);

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
type RGB = [number, number, number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix3(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// ---------------------------------------------------------------------------
// Canvas: RGBA buffer with alpha-over and additive drawing
// ---------------------------------------------------------------------------
class Img {
  data = new Uint8Array(W * H * 4);

  // alpha-over blend of a solid colour
  px(x: number, y: number, r: number, g: number, b: number, a = 1): void {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= W || yi >= H || a <= 0) return;
    const i = (yi * W + xi) * 4;
    const d = this.data;
    if (a >= 1) {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    } else {
      const ia = 1 - a;
      d[i] = r * a + d[i] * ia;
      d[i + 1] = g * a + d[i + 1] * ia;
      d[i + 2] = b * a + d[i + 2] * ia;
      d[i + 3] = 255;
    }
  }

  // additive glow (lightens, never darkens)
  add(x: number, y: number, r: number, g: number, b: number, a = 1): void {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= W || yi >= H || a <= 0) return;
    const i = (yi * W + xi) * 4;
    const d = this.data;
    d[i] = Math.min(255, d[i] + r * a);
    d[i + 1] = Math.min(255, d[i + 1] + g * a);
    d[i + 2] = Math.min(255, d[i + 2] + b * a);
    d[i + 3] = 255;
  }

  hline(x0: number, x1: number, y: number, r: number, g: number, b: number, a = 1): void {
    const yi = y | 0;
    if (yi < 0 || yi >= H) return;
    const xa = Math.max(0, Math.ceil(Math.min(x0, x1)));
    const xb = Math.min(W - 1, Math.floor(Math.max(x0, x1)));
    for (let x = xa; x <= xb; x++) this.px(x, yi, r, g, b, a);
  }

  fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
    for (let y = Math.max(0, Math.ceil(y0)); y <= Math.min(H - 1, Math.floor(y1)); y++) {
      this.hline(x0, x1, y, c[0], c[1], c[2], a);
    }
  }

  // filled circle via row spans
  circle(cx: number, cy: number, rad: number, c: RGB, a = 1): void {
    if (rad <= 0) return;
    const r2 = rad * rad;
    for (let y = Math.max(0, Math.ceil(cy - rad)); y <= Math.min(H - 1, Math.floor(cy + rad)); y++) {
      const dy = y - cy;
      const dx = Math.sqrt(Math.max(0, r2 - dy * dy));
      this.hline(cx - dx, cx + dx, y, c[0], c[1], c[2], a);
    }
  }

  // additive radial glow disc, fading to transparent at the rim
  glow(cx: number, cy: number, rad: number, c: RGB, strength: number): void {
    if (rad <= 0) return;
    const r2 = rad * rad;
    for (let y = Math.max(0, Math.ceil(cy - rad)); y <= Math.min(H - 1, Math.floor(cy + rad)); y++) {
      const dy = y - cy;
      for (let x = Math.max(0, Math.ceil(cx - rad)); x <= Math.min(W - 1, Math.floor(cx + rad)); x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const t = 1 - Math.sqrt(d2) / rad;
        this.add(x, y, c[0], c[1], c[2], strength * t * t);
      }
    }
  }

  // filled ellipse via row spans
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
    if (rx <= 0 || ry <= 0) return;
    for (let y = Math.max(0, Math.ceil(cy - ry)); y <= Math.min(H - 1, Math.floor(cy + ry)); y++) {
      const dy = (y - cy) / ry;
      const dx = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      this.hline(cx - dx, cx + dx, y, c[0], c[1], c[2], a);
    }
  }

  // even-odd scanline polygon fill
  poly(pts: Array<[number, number]>, c: RGB, a = 1): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(H - 1, Math.floor(maxY)); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        this.hline(xs[k], xs[k + 1], y, c[0], c[1], c[2], a);
      }
    }
  }

  // thick line drawn as overlapping circles along the segment
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / Math.max(1, w / 3)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x0 + dx * t, y0 + dy * t, w / 2, c, a);
    }
  }
}

// Quadratic bezier point
function qbez(p0: [number, number], p1: [number, number], p2: [number, number], t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}
// Quadratic bezier tangent (unnormalised)
function qbezTan(p0: [number, number], p1: [number, number], p2: [number, number], t: number): [number, number] {
  return [
    2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]),
    2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]),
  ];
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const SKY_TOP: RGB = [6, 9, 38];
const SKY_MID: RGB = [12, 30, 76];
const SKY_HOR: RGB = [20, 88, 112];
const SEA_TOP: RGB = [9, 58, 82];
const SEA_BOT: RGB = [3, 17, 40];
const MOON: RGB = [255, 236, 176];
const MOON_CORE: RGB = [255, 248, 220];
const WHALE_TOP: RGB = [22, 62, 104];
const WHALE_MID: RGB = [30, 88, 134];
const WHALE_DARK: RGB = [14, 44, 78];
const BELLY: RGB = [208, 233, 246];
const BELLY_SHADE: RGB = [158, 204, 228];
const GLOW_CYAN: RGB = [126, 240, 255];
const FOAM: RGB = [236, 248, 252];
const LIGHT_WHITE: RGB = [246, 241, 231];
const LIGHT_RED: RGB = [198, 52, 40];
const LAMP: RGB = [255, 214, 130];
const ROCK: RGB = [18, 30, 52];

const img = new Img();

// ---------------------------------------------------------------------------
// 1. Sky: vertical gradient, deep indigo to teal horizon
// ---------------------------------------------------------------------------
for (let y = 0; y < H; y++) {
  const t = y / H;
  const c = t < 0.55 ? mix3(SKY_TOP, SKY_MID, t / 0.55) : mix3(SKY_MID, SKY_HOR, (t - 0.55) / 0.45);
  img.hline(0, W - 1, y, c[0], c[1], c[2]);
}

// ---------------------------------------------------------------------------
// 2. Stars (deterministic) + a few bright sparkles
// ---------------------------------------------------------------------------
for (let i = 0; i < 240; i++) {
  const x = rnd() * W;
  const y = rnd() * 700;
  const b = 0.35 + rnd() * 0.65;
  const r = rnd();
  if (r < 0.06) {
    // 4-point sparkle
    const s = 5 + rnd() * 7;
    img.line(x - s, y, x + s, y, 1.6, [255, 250, 230], b);
    img.line(x, y - s, x, y + s, 1.6, [255, 250, 230], b);
    img.circle(x, y, 1.8, [255, 255, 255], b);
  } else {
    img.circle(x, y, 0.8 + rnd() * 1.4, [235, 242, 255], b);
  }
}

// ---------------------------------------------------------------------------
// 3. Moon, top-left, with halo and craters
// ---------------------------------------------------------------------------
const MOON_X = 168;
const MOON_Y = 148;
const MOON_R = 58;
img.glow(MOON_X, MOON_Y, 190, [255, 226, 150], 0.34);
img.glow(MOON_X, MOON_Y, 110, [255, 236, 176], 0.5);
img.circle(MOON_X, MOON_Y, MOON_R, MOON);
img.circle(MOON_X - 4, MOON_Y - 3, MOON_R - 4, MOON_CORE);
img.circle(MOON_X - 18, MOON_Y - 12, 9, [238, 214, 160], 0.8);
img.circle(MOON_X + 14, MOON_Y + 8, 12, [238, 214, 160], 0.7);
img.circle(MOON_X + 22, MOON_Y - 20, 6, [238, 214, 160], 0.7);
img.circle(MOON_X - 6, MOON_Y + 22, 7, [240, 218, 166], 0.6);

// Soft dark clouds drifting near the horizon and moon
for (const [cx, cy, rx, ry, a] of [
  [700, 120, 150, 20, 0.2],
  [560, 210, 120, 16, 0.18],
  [330, 660, 170, 18, 0.2],
] as const) {
  img.ellipse(cx, cy, rx, ry, [16, 34, 74], a);
  img.ellipse(cx + 40, cy + 8, rx * 0.6, ry * 0.7, [16, 34, 74], a);
}

// ---------------------------------------------------------------------------
// 4. Sea: bottom band, dark teal gradient + wave strokes
// ---------------------------------------------------------------------------
const SEA_Y = 800;
for (let y = SEA_Y; y < H; y++) {
  const t = (y - SEA_Y) / (H - SEA_Y);
  const c = mix3(SEA_TOP, SEA_BOT, t);
  img.hline(0, W - 1, y, c[0], c[1], c[2]);
}
// moonlight path on the water, left side
for (let y = SEA_Y + 4; y < H; y += 6) {
  const spread = 60 + (y - SEA_Y) * 0.35;
  const cx = MOON_X + Math.sin(y * 0.05) * 14;
  img.hline(cx - spread, cx + spread, y, 255, 226, 150, 0.05);
  img.hline(cx - spread * 0.45, cx + spread * 0.45, y + 2, 255, 226, 150, 0.06);
}
// long wave strokes
for (let w = 0; w < 7; w++) {
  const y0 = 830 + w * 26;
  const amp = 5 + w * 1.5;
  for (let x = 0; x < W; x += 4) {
    const y = y0 + Math.sin(x * 0.011 + w * 1.7) * amp;
    img.circle(x, y, 2.2, [64, 150, 178], 0.28 - w * 0.02);
  }
}

// ---------------------------------------------------------------------------
// 5. The whale — spine is a quadratic bezier, body is overlapping circles
//    Tail (in the water, bottom-left) -> head (upper-right, above lighthouse)
// ---------------------------------------------------------------------------
const SPINE0: [number, number] = [260, 850];
const SPINE1: [number, number] = [430, 530];
const SPINE2: [number, number] = [845, 295];

// body radius profile along t: fat mid-body, tapered tail stock, blunt head
function bodyR(t: number): number {
  const bulge = Math.sin(Math.PI * Math.pow(t, 0.72));
  let r = 22 + 122 * bulge;
  if (t > 0.85) r = Math.max(r, 50 - (t - 0.85) * 40); // blunt rounded head
  return r;
}

const spinePts: Array<[number, number]> = [];
const N = 240;
for (let i = 0; i <= N; i++) {
  spinePts.push(qbez(SPINE0, SPINE1, SPINE2, i / N));
}

// 5a. Body, top colour, with a vertical shade: darker back, lighter low side
for (let i = 0; i <= N; i++) {
  const t = i / N;
  const [x, y] = spinePts[i];
  const r = bodyR(t);
  const shade = mix3(WHALE_TOP, WHALE_MID, 0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
  img.circle(x, y, r, shade);
}
// back: darker cap along the upper edge (the whale's dark back)
for (let i = 0; i <= N; i++) {
  const t = i / N;
  const [x, y] = spinePts[i];
  const r = bodyR(t);
  const [tx, ty] = qbezTan(SPINE0, SPINE1, SPINE2, t);
  const tl = Math.hypot(tx, ty) || 1;
  // normal pointing up-left (away from the sea)
  let nx = -ty / tl;
  let ny = tx / tl;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  img.circle(x + nx * r * 0.38, y + ny * r * 0.38, r * 0.72, WHALE_DARK, 0.85);
}
// 5b. Belly: pale underside, circles offset toward the sea side, kept inside
for (let i = 0; i <= N; i++) {
  const t = i / N;
  const [x, y] = spinePts[i];
  const r = bodyR(t);
  const [tx, ty] = qbezTan(SPINE0, SPINE1, SPINE2, t);
  const tl = Math.hypot(tx, ty) || 1;
  let nx = -ty / tl;
  let ny = tx / tl;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  img.circle(x + nx * r * 0.5, y + ny * r * 0.5, r * 0.52, BELLY);
}
// belly shade line along the lower edge of the pale belly
for (let i = 0; i <= N; i++) {
  const t = i / N;
  const [x, y] = spinePts[i];
  const r = bodyR(t);
  const [tx, ty] = qbezTan(SPINE0, SPINE1, SPINE2, t);
  const tl = Math.hypot(tx, ty) || 1;
  let nx = -ty / tl;
  let ny = tx / tl;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  img.circle(x + nx * r * 0.78, y + ny * r * 0.78, r * 0.2, BELLY_SHADE, 0.8);
}
// throat grooves: three smooth curved lines following the belly
for (let g = 0; g < 3; g++) {
  const off = 0.42 + g * 0.13;
  let prev: [number, number] | null = null;
  for (let i = Math.floor(N * 0.55); i <= N; i++) {
    const t = i / N;
    const [x, y] = spinePts[i];
    const r = bodyR(t);
    const [tx, ty] = qbezTan(SPINE0, SPINE1, SPINE2, t);
    const tl = Math.hypot(tx, ty) || 1;
    let nx = -ty / tl;
    let ny = tx / tl;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const p: [number, number] = [x + nx * r * off, y + ny * r * off];
    if (prev) img.line(prev[0], prev[1], p[0], p[1], 3, [120, 178, 205], 0.5);
    prev = p;
  }
}

// 5c. Tail flukes at the tail tip (t = 0), spread like a fan.
// Tangent at the tail points up-right toward the head; the flukes spread
// perpendicular to it: one up-left (clear of the water), one down-right
// (dipping into the spray).
const [tx0, ty0] = spinePts[0];
const [dtx, dty] = qbezTan(SPINE0, SPINE1, SPINE2, 0);
const dl = Math.hypot(dtx, dty) || 1;
const ux = dtx / dl;
const uy = dty / dl;
// perpendicular, up-left side
const px = uy;
const py = -ux;
// upper fluke (sweeps up-left, clear of the water)
img.poly(
  [
    [tx0 - ux * 4, ty0 - uy * 4],
    [tx0 + px * 70 - ux * 10, ty0 + py * 70 - uy * 10],
    [tx0 + px * 200 - ux * 40, ty0 + py * 200 - uy * 40],
    [tx0 + px * 95 - ux * 60, ty0 + py * 95 - uy * 60],
    [tx0 + px * 30 - ux * 45, ty0 + py * 30 - uy * 45],
  ],
  WHALE_TOP,
);
// lower fluke (short, same blue as the body, dipping into the spray)
img.poly(
  [
    [tx0 - ux * 4, ty0 - uy * 4],
    [tx0 - px * 45 - ux * 8, ty0 - py * 45 - uy * 8],
    [tx0 - px * 105 - ux * 30, ty0 - py * 105 - uy * 30],
    [tx0 - px * 65 - ux * 48, ty0 - py * 65 - uy * 48],
    [tx0 - px * 20 - ux * 36, ty0 - py * 20 - uy * 36],
  ],
  WHALE_TOP,
);
// pale trailing-edge highlights on both flukes
img.line(tx0 + px * 70 - ux * 10, ty0 + py * 70 - uy * 10, tx0 + px * 200 - ux * 40, ty0 + py * 200 - uy * 40, 3, BELLY_SHADE, 0.8);
img.line(tx0 - px * 45 - ux * 8, ty0 - py * 45 - uy * 8, tx0 - px * 105 - ux * 30, ty0 - py * 105 - uy * 30, 3, BELLY_SHADE, 0.6);

// 5c2. Small dorsal fin on the back, near the tail stock
const dorT = 0.24;
const [dox, doy] = spinePts[Math.floor(N * dorT)];
const dor = bodyR(dorT);
const [dtx2, dty2] = qbezTan(SPINE0, SPINE1, SPINE2, dorT);
const dtl = Math.hypot(dtx2, dty2) || 1;
let dnx = -dty2 / dtl;
let dny = dtx2 / dtl;
if (dny > 0) {
  dnx = -dnx;
  dny = -dny;
}
img.poly(
  [
    [dox + dnx * dor * 0.8 - (dtx2 / dtl) * 26, doy + dny * dor * 0.8 - (dty2 / dtl) * 26],
    [dox + dnx * dor * 1.35 - (dtx2 / dtl) * 4, doy + dny * dor * 1.35 - (dty2 / dtl) * 4],
    [dox + dnx * dor * 0.8 + (dtx2 / dtl) * 22, doy + dny * dor * 0.8 + (dty2 / dtl) * 22],
  ],
  WHALE_DARK,
);

// 5e. Head: eye, smile line, blowhole spray hint
const headT = 0.93;
const [hx, hy] = spinePts[Math.floor(N * headT)];
const hr = bodyR(headT);
const [htx, hty] = qbezTan(SPINE0, SPINE1, SPINE2, headT);
const htl = Math.hypot(htx, hty) || 1;
let hnx = -hty / htl;
let hny = htx / htl;
if (hny > 0) {
  hnx = -hnx;
  hny = -hny;
}
// eye on the upper side of the head
img.circle(hx + hnx * hr * 0.45, hy + hny * hr * 0.45, 10, [8, 18, 34]);
img.circle(hx + hnx * hr * 0.45 - 3, hy + hny * hr * 0.45 - 3, 3.5, [255, 255, 255]);
// mouth: one smooth gentle curve along the lower jaw toward the snout
{
  let prev: [number, number] | null = null;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const mt = 0.86 + t * 0.13;
    const [mx, my] = spinePts[Math.floor(N * mt)];
    const mr = bodyR(mt);
    const [mtx, mty] = qbezTan(SPINE0, SPINE1, SPINE2, mt);
    const mtl = Math.hypot(mtx, mty) || 1;
    let mnx = -mty / mtl;
    let mny = mtx / mtl;
    if (mny < 0) {
      mnx = -mnx;
      mny = -mny;
    }
    const p: [number, number] = [mx + mnx * mr * 0.72, my + mny * mr * 0.72];
    if (prev) img.line(prev[0], prev[1], p[0], p[1], 3.5, [10, 32, 60], 0.9);
    prev = p;
  }
}
// blowhole: two small dots on top of the head + a soft mist puff just above
const bx = hx + hnx * hr * 0.75;
const by = hy + hny * hr * 0.75;
img.circle(bx - 5, by - 2, 3.5, [10, 32, 60]);
img.circle(bx + 5, by - 2, 3.5, [10, 32, 60]);
img.glow(bx, by - 26, 34, [200, 235, 245], 0.4);
for (let i = 0; i < 16; i++) {
  const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
  const d = 10 + rnd() * 26;
  img.circle(bx + Math.cos(a) * d, by - 18 + Math.sin(a) * d * 0.7, 2 + rnd() * 2.5, FOAM, 0.5 + rnd() * 0.4);
}

// 5f. Bioluminescent speckles along the belly edge
for (let i = 0; i < 90; i++) {
  const t = 0.15 + rnd() * 0.8;
  const [sx, sy] = spinePts[Math.floor(N * t)];
  const r = bodyR(t);
  const [stx, sty] = qbezTan(SPINE0, SPINE1, SPINE2, t);
  const stl = Math.hypot(stx, sty) || 1;
  let snx = -sty / stl;
  let sny = stx / stl;
  if (sny < 0) {
    snx = -snx;
    sny = -sny;
  }
  const off = 0.55 + rnd() * 0.35;
  const gx = sx + snx * r * off;
  const gy = sy + sny * r * off;
  img.glow(gx, gy, 5 + rnd() * 4, GLOW_CYAN, 0.5);
  img.circle(gx, gy, 1.6 + rnd() * 1.6, [210, 250, 255], 0.95);
}

// ---------------------------------------------------------------------------
// 6. Spray + foam where the tail leaves the water.
//    The body crosses the waterline near (290, 802); the spray fans out from
//    that entry point, and smooth ripple rings spread across the surface.
// ---------------------------------------------------------------------------
const EX = 290;
const EY = 802;
img.glow(EX, EY, 150, [120, 200, 235], 0.25);
// smooth ripple rings on the water surface
for (let k = 0; k < 3; k++) {
  const rx = 95 + k * 34;
  const ry = 26 + k * 10;
  let prev: [number, number] | null = null;
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.06) {
    const ex = EX + Math.cos(a) * rx;
    const ey = EY + Math.sin(a) * ry + 6;
    const p: [number, number] = [ex, ey];
    if (prev && ey > SEA_Y - 2) img.line(prev[0], prev[1], p[0], p[1], 3.5 - k * 0.7, FOAM, 0.8 - k * 0.2);
    prev = p;
  }
}
// droplet fan arcing up from the entry point
for (let i = 0; i < 150; i++) {
  const a = -Math.PI * (0.15 + rnd() * 0.7);
  const d = 40 + rnd() * rnd() * 260;
  const dx = EX + Math.cos(a) * d * 1.15;
  const dy = EY + Math.sin(a) * d * 0.75 - 10;
  const s = 1 + rnd() * 3.2;
  img.circle(dx, dy, s, dy < SEA_Y ? FOAM : [190, 225, 240], 0.55 + rnd() * 0.4);
}
// a few long spray streaks
for (let i = 0; i < 14; i++) {
  const a = -Math.PI * (0.2 + rnd() * 0.6);
  const d0 = 60 + rnd() * 60;
  const d1 = d0 + 40 + rnd() * 90;
  img.line(
    EX + Math.cos(a) * d0 * 1.15,
    EY + Math.sin(a) * d0 * 0.75,
    EX + Math.cos(a) * d1 * 1.15,
    EY + Math.sin(a) * d1 * 0.75,
    2.5,
    FOAM,
    0.5,
  );
}

// ---------------------------------------------------------------------------
// 7. Lighthouse, bottom-right, on dark rocks — lamp beam sweeping up-left
//    across the whale's belly
// ---------------------------------------------------------------------------
const LH_X = 878;
const LH_TOP = 648;
const LH_BASE = 1024;
const LH_HALF_TOP = 27;
const LH_HALF_BASE = 46;
// rocks
img.poly(
  [
    [LH_X - 95, LH_BASE],
    [LH_X - 70, 968],
    [LH_X - 30, 946],
    [LH_X + 12, 962],
    [LH_X + 58, 944],
    [LH_X + 96, 972],
    [LH_X + 110, LH_BASE],
  ],
  ROCK,
);
img.poly(
  [
    [LH_X - 70, 968],
    [LH_X - 30, 946],
    [LH_X + 12, 962],
    [LH_X + 58, 944],
    [LH_X + 40, 992],
    [LH_X - 40, 994],
  ],
  [26, 42, 68],
);
// beam (drawn first so the tower sits over its root)
const LAMP_X = LH_X;
const LAMP_Y = LH_TOP - 38;
img.poly(
  [
    [LAMP_X, LAMP_Y],
    [450, 320],
    [530, 450],
  ],
  LAMP,
  0.08,
);
img.poly(
  [
    [LAMP_X, LAMP_Y],
    [430, 300],
    [500, 430],
  ],
  LAMP,
  0.16,
);
img.poly(
  [
    [LAMP_X, LAMP_Y],
    [470, 330],
    [520, 420],
  ],
  LAMP,
  0.24,
);
// soft light pooling along the beam's centreline
for (let i = 0; i <= 10; i++) {
  const t = i / 10;
  const gx = LAMP_X + (485 - LAMP_X) * t;
  const gy = LAMP_Y + (375 - LAMP_Y) * t;
  img.glow(gx, gy, 26 - t * 10, LAMP, 0.1);
}
img.glow(LAMP_X, LAMP_Y, 120, LAMP, 0.5);
// tower
img.poly(
  [
    [LH_X - LH_HALF_BASE, LH_BASE],
    [LH_X + LH_HALF_BASE, LH_BASE],
    [LH_X + LH_HALF_TOP, LH_TOP],
    [LH_X - LH_HALF_TOP, LH_TOP],
  ],
  LIGHT_WHITE,
);
// red bands (width interpolated along the taper)
function towerHalfAt(y: number): number {
  const t = (y - LH_TOP) / (LH_BASE - LH_TOP);
  return LH_HALF_TOP + (LH_HALF_BASE - LH_HALF_TOP) * t;
}
for (const [y0, y1] of [
  [726, 786],
  [856, 916],
] as const) {
  img.poly(
    [
      [LH_X - towerHalfAt(y0), y0],
      [LH_X + towerHalfAt(y0), y0],
      [LH_X + towerHalfAt(y1), y1],
      [LH_X - towerHalfAt(y1), y1],
    ],
    LIGHT_RED,
  );
}
// lamp room + dome
img.fillRect(LH_X - 32, LH_TOP - 44, LH_X + 32, LH_TOP, [12, 22, 44]);
img.fillRect(LH_X - 20, LH_TOP - 38, LH_X + 20, LH_TOP - 6, LAMP);
img.line(LH_X - 20, LH_TOP - 22, LH_X + 20, LH_TOP - 22, 2, [12, 22, 44], 0.9);
img.line(LH_X, LH_TOP - 38, LH_X, LH_TOP - 6, 2, [12, 22, 44], 0.9);
img.ellipse(LH_X, LH_TOP - 44, 34, 14, [12, 22, 44]);
img.line(LH_X, LH_TOP - 58, LH_X, LH_TOP - 74, 3, [12, 22, 44]);
img.circle(LH_X, LH_TOP - 76, 4, LAMP);
img.glow(LH_X, LH_TOP - 22, 60, LAMP, 0.55);
// gallery railing
img.line(LH_X - 34, LH_TOP - 2, LH_X + 34, LH_TOP - 2, 2, [12, 22, 44], 0.9);
for (let i = -3; i <= 3; i++) {
  img.line(LH_X + i * 10, LH_TOP - 2, LH_X + i * 10, LH_TOP + 8, 1.6, [12, 22, 44], 0.9);
}

// ---------------------------------------------------------------------------
// 8. Tiny rowboat, bottom-centre — the scale joke: one person watching
//    a whale fly over a lighthouse
// ---------------------------------------------------------------------------
const BOAT_X = 520;
const BOAT_Y = 938;
img.ellipse(BOAT_X, BOAT_Y + 12, 46, 8, [10, 40, 58], 0.8);
img.poly(
  [
    [BOAT_X - 42, BOAT_Y],
    [BOAT_X + 42, BOAT_Y],
    [BOAT_X + 30, BOAT_Y + 14],
    [BOAT_X - 30, BOAT_Y + 14],
  ],
  [96, 52, 28],
);
img.poly(
  [
    [BOAT_X - 42, BOAT_Y],
    [BOAT_X + 42, BOAT_Y],
    [BOAT_X + 38, BOAT_Y + 4],
    [BOAT_X - 38, BOAT_Y + 4],
  ],
  [140, 82, 44],
);
// tiny figure, standing, looking up
img.circle(BOAT_X - 4, BOAT_Y - 16, 5, [20, 26, 40]);
img.line(BOAT_X - 4, BOAT_Y - 11, BOAT_X - 4, BOAT_Y - 1, 7, [210, 60, 50]);
// lantern glow in the boat
img.glow(BOAT_X + 22, BOAT_Y - 6, 22, LAMP, 0.8);
img.circle(BOAT_X + 22, BOAT_Y - 6, 3, [255, 240, 200]);
// boat wake
for (let x = BOAT_X - 70; x < BOAT_X + 70; x += 6) {
  img.circle(x, BOAT_Y + 18 + Math.sin(x * 0.2) * 2, 1.6, FOAM, 0.5);
}

// ---------------------------------------------------------------------------
// 9. Glowing plankton dots in the sea + vignette for focus
// ---------------------------------------------------------------------------
for (let i = 0; i < 70; i++) {
  const x = rnd() * W;
  const y = SEA_Y + 10 + rnd() * (H - SEA_Y - 20);
  img.glow(x, y, 4 + rnd() * 3, GLOW_CYAN, 0.35);
  img.circle(x, y, 1.2, [190, 245, 255], 0.8);
}
// gentle vignette: darken the four corners a touch
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2);
    const dy = (y - H / 2) / (H / 2);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1.05) {
      const a = Math.min(0.22, (d - 1.05) * 0.9);
      img.px(x, y, 0, 0, 0, a);
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoder: raw scanlines (filter 0), zlib deflate, CRC32
// ---------------------------------------------------------------------------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;
      const di = y * (1 + W * 3) + 1 + x * 3;
      raw[di] = img.data[si];
      raw[di + 1] = img.data[si + 1];
      raw[di + 2] = img.data[si + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), encodePng());
