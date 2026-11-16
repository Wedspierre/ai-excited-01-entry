// ai-excited-01 v4 — "Sunset Leap": a train leaps the broken bridge at sunset.
// Procedural pixel renderer + PNG encoder, written from scratch.
// Node 22, stdlib only, no network, fully deterministic (fixed-seed PRNG).
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const img = new Uint8Array(W * H * 3);

// ---- deterministic PRNG (mulberry32, fixed seed) ----
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

// ---- color helpers ----
type RGB = [number, number, number];
function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mixC(c1: RGB, c2: RGB, t: number): RGB {
  return [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
}

function put(x: number, y: number, c: RGB, alpha = 1): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const i = (yi * W + xi) * 3;
  if (alpha >= 1) {
    img[i] = clamp255(c[0]);
    img[i + 1] = clamp255(c[1]);
    img[i + 2] = clamp255(c[2]);
  } else {
    const inv = 1 - alpha;
    img[i] = clamp255(img[i] * inv + c[0] * alpha);
    img[i + 1] = clamp255(img[i + 1] * inv + c[1] * alpha);
    img[i + 2] = clamp255(img[i + 2] * inv + c[2] * alpha);
  }
}

// ---- filled shapes ----
function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, alpha = 1): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(W - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(H - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) put(x, y, c, alpha);
  }
}

function fillPoly(pts: Array<[number, number]>, c: RGB, alpha = 1): void {
  let minY = H;
  let maxY = 0;
  for (const p of pts) {
    minY = Math.min(minY, Math.floor(p[1]));
    maxY = Math.max(maxY, Math.ceil(p[1]));
  }
  minY = Math.max(0, minY);
  maxY = Math.min(H - 1, maxY);
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      if ((p1[1] <= yc && p2[1] > yc) || (p2[1] <= yc && p1[1] > yc)) {
        xs.push(p1[0] + ((yc - p1[1]) / (p2[1] - p1[1])) * (p2[0] - p1[0]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) put(x, y, c, alpha);
    }
  }
}

function disc(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
  if (r <= 0) return;
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    const x0 = Math.max(0, Math.ceil(cx - dx));
    const x1 = Math.min(W - 1, Math.floor(cx + dx));
    for (let x = x0; x <= x1; x++) put(x, y, c, alpha);
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, alpha = 1): void {
  if (rx <= 0 || ry <= 0) return;
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    const dx = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
    const x0 = Math.max(0, Math.ceil(cx - dx));
    const x1 = Math.min(W - 1, Math.floor(cx + dx));
    for (let x = x0; x <= x1; x++) put(x, y, c, alpha);
  }
}

function thickLine(x1: number, y1: number, x2: number, y2: number, radius: number, c: RGB, alpha = 1): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / Math.max(1, radius * 0.7)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(x1 + dx * t, y1 + dy * t, radius, c, alpha);
  }
}

function polyline(pts: Array<[number, number]>, radius: number, c: RGB, alpha = 1): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], radius, c, alpha);
  }
}

// ---- rotation helpers ----
const DEG = Math.PI / 180;
function rotPt(cx: number, cy: number, lx: number, ly: number, deg: number): [number, number] {
  const a = deg * DEG;
  const co = Math.cos(a);
  const si = Math.sin(a);
  return [cx + lx * co - ly * si, cy + lx * si + ly * co];
}
function rotRect(cx: number, cy: number, w: number, h: number, deg: number, c: RGB, alpha = 1): void {
  const hw = w / 2;
  const hh = h / 2;
  fillPoly(
    [
      rotPt(cx, cy, -hw, -hh, deg),
      rotPt(cx, cy, hw, -hh, deg),
      rotPt(cx, cy, hw, hh, deg),
      rotPt(cx, cy, -hw, hh, deg),
    ],
    c,
    alpha,
  );
}
function rotPoly(cx: number, cy: number, local: Array<[number, number]>, deg: number, c: RGB, alpha = 1): void {
  fillPoly(local.map((p) => rotPt(cx, cy, p[0], p[1], deg)), c, alpha);
}

// ---- PNG encoder (filter per row, best of None/Sub/Up/Avg/Paeth) ----
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
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
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}
function encodePNG(): Buffer {
  const stride = W * 3;
  const raw = Buffer.alloc(H * (stride + 1));
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const row = Buffer.from(img.subarray(y * stride, (y + 1) * stride));
    let bestType = 0;
    let bestScore = Infinity;
    let bestRow: Buffer = row;
    for (let f = 0; f <= 4; f++) {
      const out = Buffer.alloc(stride);
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const v = row[x];
        const a = x >= 3 ? row[x - 3] : 0;
        const b = prev[x];
        const cc = x >= 3 ? prev[x - 3] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) pred = paeth(a, b, cc);
        const d = (v - pred) & 0xff;
        out[x] = d;
        score += d < 128 ? d : 256 - d;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = f;
        bestRow = out;
      }
    }
    raw[y * (stride + 1)] = bestType;
    bestRow.copy(raw, y * (stride + 1) + 1);
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- palette ----
const SKY_STOPS: Array<[number, RGB]> = [
  [0, [26, 6, 34]],
  [0.22, [74, 13, 44]],
  [0.42, [158, 32, 22]],
  [0.58, [238, 92, 16]],
  [0.72, [255, 176, 46]],
  [0.82, [255, 211, 94]],
  [1, [255, 196, 80]],
];
const SUN_C: [number, number] = [580, 568];
const SUN_R = 202;
const DECK_Y = 778;
const GAP_L = 400;
const GAP_R = 640;

// ---- sky gradient ----
function drawSky(): void {
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let i = 0;
    while (i + 1 < SKY_STOPS.length && SKY_STOPS[i + 1][0] < t) i++;
    const s0 = SKY_STOPS[i];
    const s1 = SKY_STOPS[Math.min(i + 1, SKY_STOPS.length - 1)];
    const f = s1[0] === s0[0] ? 0 : (t - s0[0]) / (s1[0] - s0[0]);
    const c = mixC(s0[1], s1[1], Math.max(0, Math.min(1, f)));
    // faint deterministic grain so the gradient never bands
    const g = (rnd() - 0.5) * 3;
    for (let x = 0; x < W; x++) put(x, y, [c[0] + g, c[1] + g, c[2] + g]);
  }
}

// ---- sun with halo and cloud bands ----
function drawSun(): void {
  // wide soft halo
  for (let r = 360; r > SUN_R + 40; r -= 12) {
    disc(SUN_C[0], SUN_C[1], r, [255, 110, 28], 0.045);
  }
  // disc: edge orange -> core near-white, concentric rings
  for (let r = SUN_R; r > 0; r -= 3) {
    const t = 1 - r / SUN_R; // 0 edge, 1 core
    const c = mixC(mixC([255, 138, 30], [255, 210, 62], Math.min(1, t * 1.6)), [255, 248, 220], Math.max(0, (t - 0.55) / 0.45));
    disc(SUN_C[0], SUN_C[1], r, c);
  }
  // dark cloud bands crossing the sun (drawn before the train) — thin,
  // off-centre, so they never bisect the disc
  ellipse(SUN_C[0], 486, 250, 17, [122, 20, 48], 0.3);
  ellipse(SUN_C[0], 736, 260, 14, [94, 18, 48], 0.24);
  // thin bright rim where the bands meet the disc
  ellipse(SUN_C[0], 505, 250, 4, [255, 190, 90], 0.45);
  ellipse(SUN_C[0], 751, 260, 4, [255, 170, 70], 0.35);
}

// ---- high clouds + birds ----
function drawClouds(): void {
  const clouds: Array<[number, number, number, number, RGB, number]> = [
    [210, 150, 190, 20, [94, 18, 48], 0.75],
    [300, 176, 150, 14, [140, 30, 44], 0.6],
    [790, 120, 220, 22, [94, 18, 48], 0.8],
    [880, 148, 160, 14, [150, 34, 46], 0.55],
    [520, 220, 170, 16, [110, 22, 50], 0.6],
    [120, 330, 150, 15, [120, 24, 48], 0.55],
    [930, 330, 170, 16, [110, 22, 50], 0.6],
    [60, 470, 130, 13, [130, 28, 46], 0.5],
    [970, 470, 130, 13, [130, 28, 46], 0.5],
  ];
  for (const [cx, cy, rx, ry, c, a] of clouds) {
    ellipse(cx, cy + 7, rx, ry * 0.55, [255, 122, 40], a * 0.4);
    ellipse(cx, cy, rx, ry, c, a);
  }
  // birds, tiny silhouettes for scale
  const birds: Array<[number, number, number]> = [
    [290, 285, 15],
    [335, 262, 12],
    [700, 232, 14],
    [748, 262, 11],
  ];
  for (const [bx, by, s] of birds) {
    thickLine(bx - s, by - s * 0.35, bx, by, 2, [26, 8, 18], 0.9);
    thickLine(bx, by, bx + s, by - s * 0.35, 2, [26, 8, 18], 0.9);
  }
}

// ---- canyon, gorge, river ----
function drawCanyon(): void {
  // distant canyon wall visible through the gap, behind the bridge
  fillPoly(
    [
      [GAP_L - 10, DECK_Y],
      [GAP_R + 10, DECK_Y],
      [GAP_R + 10, 900],
      [GAP_L - 10, 900],
    ],
    [58, 18, 36],
  );
  thickLine(GAP_L - 10, 838, GAP_R + 10, 832, 3, [120, 40, 44], 0.5);
  thickLine(GAP_L - 10, 872, GAP_R + 10, 866, 3, [90, 28, 40], 0.45);
  // gorge depth between the cliffs, with faint strata and bounce light
  fillPoly(
    [
      [408, 850],
      [632, 846],
      [618, H],
      [424, H],
    ],
    [13, 4, 9],
  );
  thickLine(420, 892, 624, 886, 2, [58, 22, 34], 0.5);
  thickLine(424, 928, 620, 922, 2, [44, 16, 28], 0.45);
  // river glint far below
  for (let i = 0; i < 3; i++) {
    const y = 952 + i * 15;
    thickLine(452 + i * 6, y, 596 - i * 8, y, 3, [255, 176, 46], 0.8 - i * 0.18);
  }
  disc(520, 972, 46, [255, 140, 40], 0.05);
  // left cliff
  const leftTop: Array<[number, number]> = [
    [0, 872],
    [90, 838],
    [180, 868],
    [270, 842],
    [350, 878],
    [412, 852],
  ];
  fillPoly([...leftTop, [430, H], [0, H]], [28, 10, 18]);
  polyline(leftTop, 2.5, [255, 138, 42], 0.55);
  // right cliff
  const rightTop: Array<[number, number]> = [
    [628, 846],
    [700, 872],
    [780, 838],
    [860, 866],
    [940, 830],
    [1024, 862],
  ];
  fillPoly([...rightTop, [1024, H], [618, H]], [28, 10, 18]);
  polyline(rightTop, 2.5, [255, 138, 42], 0.55);
}

// ---- broken bridge ----
function quadCurve(p0: [number, number], p1: [number, number], p2: [number, number], n: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return pts;
}

function drawBridge(): void {
  const STEEL: RGB = [20, 9, 15];
  const STEEL2: RGB = [34, 14, 22];
  const RIM: RGB = [255, 154, 46];
  // decks
  fillRect(0, DECK_Y, GAP_L, DECK_Y + 26, STEEL);
  fillRect(GAP_R, DECK_Y, W, DECK_Y + 26, STEEL);
  // sunlit top edge of each deck
  thickLine(0, DECK_Y, GAP_L, DECK_Y, 2, RIM, 0.85);
  thickLine(GAP_R, DECK_Y, W, DECK_Y, 2, RIM, 0.85);
  // rails on the decks
  thickLine(0, DECK_Y - 5, GAP_L - 8, DECK_Y - 5, 1.8, [70, 30, 36], 0.9);
  thickLine(GAP_R + 8, DECK_Y - 5, W, DECK_Y - 5, 1.8, [70, 30, 36], 0.9);
  // jagged broken ends
  fillPoly(
    [
      [GAP_L - 14, DECK_Y],
      [GAP_L, DECK_Y - 10],
      [GAP_L + 12, DECK_Y + 4],
      [GAP_L, DECK_Y + 26],
      [GAP_L - 14, DECK_Y + 26],
    ],
    STEEL2,
  );
  fillPoly(
    [
      [GAP_R + 14, DECK_Y],
      [GAP_R, DECK_Y - 10],
      [GAP_R - 12, DECK_Y + 4],
      [GAP_R, DECK_Y + 26],
      [GAP_R + 14, DECK_Y + 26],
    ],
    STEEL2,
  );
  // under-deck truss zigzags
  const truss = (x0: number, x1: number): void => {
    thickLine(x0, DECK_Y + 26, x1, DECK_Y + 26, 3, STEEL2);
    thickLine(x0, DECK_Y + 78, x1, DECK_Y + 78, 3, STEEL2);
    const step = 56;
    for (let x = x0; x + step <= x1; x += step) {
      thickLine(x, DECK_Y + 26, x + step / 2, DECK_Y + 78, 3, STEEL2);
      thickLine(x + step / 2, DECK_Y + 78, x + step, DECK_Y + 26, 3, STEEL2);
      thickLine(x + step / 2, DECK_Y + 26, x + step / 2, DECK_Y + 78, 2.5, STEEL2);
    }
  };
  truss(0, GAP_L - 8);
  truss(GAP_R + 8, W);
  // support towers
  const tower = (x0: number, x1: number, yTop: number, yBot: number): void => {
    thickLine(x0, yTop, x0, yBot, 5, STEEL);
    thickLine(x1, yTop, x1, yBot, 5, STEEL);
    thickLine(x0, yTop + 8, x1, yBot - 8, 3.5, STEEL2);
    thickLine(x1, yTop + 8, x0, yBot - 8, 3.5, STEEL2);
    thickLine(x0, yTop, x1, yTop, 4, STEEL2);
  };
  tower(64, 168, DECK_Y + 26, 856);
  tower(856, 960, DECK_Y + 26, 850);
  // THE TWIST: the left rails curl upward like a ski jump, launching the train.
  // Two rails bending up out of the break, ending mid-air with sparks.
  const curl1 = quadCurve([GAP_L - 6, DECK_Y - 5], [492, DECK_Y - 62], [548, 664], 24);
  const curl2 = quadCurve([GAP_L - 6, DECK_Y + 3], [486, DECK_Y - 48], [538, 672], 24);
  polyline(curl1, 4.5, [42, 20, 30], 1);
  polyline(curl2, 4.5, [42, 20, 30], 1);
  polyline(curl1, 2.2, RIM, 0.95);
  // snapped rail stubs jutting up at both breaks
  thickLine(GAP_L - 4, DECK_Y - 4, GAP_L + 22, DECK_Y - 44, 3, [58, 26, 34], 1);
  thickLine(GAP_R + 4, DECK_Y - 4, GAP_R - 20, DECK_Y - 40, 3, [58, 26, 34], 1);
  // right rails bent down into the gorge
  const bend = quadCurve([GAP_R + 6, DECK_Y - 5], [600, DECK_Y + 26], [584, 868], 18);
  polyline(bend, 4, [42, 20, 30], 1);
  // dangling cables from the breaks
  const cable1 = quadCurve([GAP_L - 20, DECK_Y + 20], [GAP_L + 26, DECK_Y + 96], [GAP_L + 8, DECK_Y + 150], 18);
  const cable2 = quadCurve([GAP_R + 22, DECK_Y + 20], [GAP_R - 24, DECK_Y + 88], [GAP_R - 6, DECK_Y + 138], 18);
  polyline(cable1, 2, [36, 16, 26], 0.95);
  polyline(cable2, 2, [36, 16, 26], 0.95);
}

// ---- the jump arc (Catmull-Rom through control points) ----
const ARC_PTS: Array<[number, number]> = [
  [120, 782],
  [300, 700],
  [500, 615],
  [700, 556],
  [860, 598],
  [985, 722],
];
interface ArcSample {
  x: number;
  y: number;
  ang: number;
}
function buildArc(): ArcSample[] {
  const pts: ArcSample[] = [];
  const catmull = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
    0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  for (let s = 0; s + 1 < ARC_PTS.length; s++) {
    const p0 = ARC_PTS[Math.max(0, s - 1)];
    const p1 = ARC_PTS[s];
    const p2 = ARC_PTS[s + 1];
    const p3 = ARC_PTS[Math.min(ARC_PTS.length - 1, s + 2)];
    for (let i = 0; i < 60; i++) {
      const t = i / 60;
      pts.push({ x: catmull(p0[0], p1[0], p2[0], p3[0], t), y: catmull(p0[1], p1[1], p2[1], p3[1], t), ang: 0 });
    }
  }
  pts.push({ x: ARC_PTS[ARC_PTS.length - 1][0], y: ARC_PTS[ARC_PTS.length - 1][1], ang: 0 });
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 4)];
    const b = pts[Math.min(pts.length - 1, i + 4)];
    pts[i].ang = (Math.atan2(b.y - a.y, b.x - a.x) / DEG) as number;
  }
  return pts;
}
const ARC = buildArc();
function arcAt(x: number): ArcSample {
  let best = ARC[0];
  let bd = Infinity;
  for (const p of ARC) {
    const d = Math.abs(p.x - x);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

// ---- speed lines ----
function drawSpeedLines(): void {
  for (let i = 0; i < 11; i++) {
    const x = 90 + rnd() * 850;
    const y = 170 + rnd() * 380;
    const len = 50 + rnd() * 90;
    const ang = (-19 + (rnd() - 0.5) * 10) * DEG;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    thickLine(x, y, x2, y2, 1.2 + rnd() * 1.2, [255, 179, 71], 0.1 + rnd() * 0.12);
  }
}

// ---- smoke trailing behind the locomotive ----
function drawSmoke(chimney: [number, number], locoAng: number): void {
  const a = locoAng * DEG;
  const bx = Math.cos(a);
  const by = Math.sin(a);
  for (let i = 0; i < 20; i++) {
    const t = i / 20;
    const back = 40 + t * 380 + (rnd() - 0.5) * 30;
    const up = -6 - t * 42 + (rnd() - 0.5) * 36;
    const px = chimney[0] - bx * back + -by * up;
    const py = chimney[1] - by * back + bx * up;
    const r = 10 + t * 26 + rnd() * 9;
    const c = mixC([51, 22, 46], [96, 52, 62], t);
    disc(px, py, r, c, 0.3 - t * 0.13);
    // sunlit rim on the lower-right edge of each puff
    disc(px + r * 0.35, py + r * 0.42, r * 0.55, [255, 140, 60], 0.13);
  }
}

// ---- sparks ----
const SPARK_COLORS: RGB[] = [
  [255, 246, 200],
  [255, 210, 62],
  [255, 138, 30],
  [255, 90, 30],
];
function sparkBurst(cx: number, cy: number, n: number, spread: number, dirAng: number): void {
  for (let i = 0; i < n; i++) {
    const ang = (dirAng + (rnd() - 0.5) * spread) * DEG;
    const d = 4 + rnd() * 46;
    const px = cx + Math.cos(ang) * d;
    const py = cy + Math.sin(ang) * d;
    const c = SPARK_COLORS[Math.floor(rnd() * SPARK_COLORS.length)];
    if (rnd() < 0.45) {
      // streak
      const l = 8 + rnd() * 20;
      thickLine(px, py, px + Math.cos(ang) * l, py + Math.sin(ang) * l, 1.4 + rnd() * 1.2, c, 0.95);
    } else {
      disc(px, py, 1.2 + rnd() * 2.2, c, 0.95);
    }
  }
}

// ---- train ----
const BODY: RGB = [16, 6, 12];
const BODY2: RGB = [26, 10, 18];
const RIM: RGB = [255, 176, 46];
const WINDOW: RGB = [255, 215, 106];

function drawWheel(cx: number, cy: number, deg: number, lx: number, ly: number, r: number): void {
  const [wx, wy] = rotPt(cx, cy, lx, ly, deg);
  disc(wx, wy, r, [8, 3, 6]);
  disc(wx, wy, r * 0.45, [58, 26, 34], 0.9);
  disc(wx - r * 0.3, wy - r * 0.3, r * 0.22, [255, 176, 46], 0.7);
}

function drawCar(cx: number, cy: number, deg: number, len: number, ht: number): void {
  // body
  rotRect(cx, cy, len, ht, deg, BODY);
  // roof
  rotRect(cx, cy - ht / 2 - 3, len * 0.92, 8, deg, BODY2);
  // sunlit top edge
  const t1 = rotPt(cx, cy, -len / 2, -ht / 2, deg);
  const t2 = rotPt(cx, cy, len / 2, -ht / 2, deg);
  thickLine(t1[0], t1[1], t2[0], t2[1], 2.2, RIM, 0.9);
  // glowing windows
  const nWin = Math.floor((len - 36) / 36);
  for (let i = 0; i < nWin; i++) {
    const lx = -len / 2 + 24 + i * 36;
    const [wx, wy] = rotPt(cx, cy, lx, -ht * 0.08, deg);
    rotRect(wx, wy, 17, 15, deg, i % 3 === 2 ? [255, 243, 176] : WINDOW, 0.95);
  }
  // wheels
  drawWheel(cx, cy, deg, -len / 2 + 28, ht / 2 + 10, 13);
  drawWheel(cx, cy, deg, len / 2 - 28, ht / 2 + 10, 13);
  // under-shadow
  rotRect(cx, cy + ht / 2 + 4, len * 0.94, 6, deg, [10, 4, 8], 0.9);
}

function drawLoco(cx: number, cy: number, deg: number): void {
  const len = 275;
  const ht = 112;
  // body with sloped nose
  rotPoly(
    cx,
    cy,
    [
      [-137, -ht / 2],
      [86, -ht / 2],
      [134, -16],
      [134, ht / 2],
      [-137, ht / 2],
    ],
    deg,
    BODY,
  );
  // cab roof, slightly raised at the rear
  rotRect(cx - 90, cy - ht / 2 - 7, 86, 15, deg, BODY2);
  // smokestack near the front, pouring smoke
  rotRect(cx + 68, cy - ht / 2 - 16, 16, 26, deg, BODY2);
  const chimTop = rotPt(cx, cy, 77, -ht / 2 - 30, deg);
  // sunlit top edge + nose edge
  const t1 = rotPt(cx, cy, -137, -ht / 2, deg);
  const t2 = rotPt(cx, cy, 86, -ht / 2, deg);
  const t3 = rotPt(cx, cy, 134, -16, deg);
  thickLine(t1[0], t1[1], t2[0], t2[1], 2.5, RIM, 0.95);
  thickLine(t2[0], t2[1], t3[0], t3[1], 2.5, RIM, 0.95);
  // cab windows
  const w1 = rotPt(cx, cy, -112, -ht * 0.14, deg);
  rotRect(w1[0], w1[1], 26, 20, deg, [255, 243, 176], 0.95);
  const w2 = rotPt(cx, cy, -72, -ht * 0.14, deg);
  rotRect(w2[0], w2[1], 18, 20, deg, WINDOW, 0.95);
  // side vents
  for (let i = 0; i < 3; i++) {
    const [vx, vy] = rotPt(cx, cy, -22 + i * 24, ht * 0.1, deg);
    rotRect(vx, vy, 12, 22, deg, BODY2, 0.95);
  }
  // wheels, bigger driving wheels
  drawWheel(cx, cy, deg, -104, ht / 2 + 11, 15);
  drawWheel(cx, cy, deg, -33, ht / 2 + 11, 15);
  drawWheel(cx, cy, deg, 42, ht / 2 + 11, 15);
  drawWheel(cx, cy, deg, 101, ht / 2 + 11, 13);
  // headlight + beam toward the sun-side sky
  const [hx, hy] = rotPt(cx, cy, 134, 6, deg);
  disc(hx, hy, 7, [255, 251, 232]);
  disc(hx, hy, 3.5, [255, 255, 255]);
  const ba = (deg - 10) * DEG;
  const beam: Array<[number, number]> = [
    [hx, hy],
    [hx + Math.cos(ba - 0.09) * 340, hy + Math.sin(ba - 0.09) * 340],
    [hx + Math.cos(ba + 0.09) * 340, hy + Math.sin(ba + 0.09) * 340],
  ];
  fillPoly(beam, [255, 244, 200], 0.2);
  fillPoly(
    [
      [hx, hy],
      [hx + Math.cos(ba - 0.045) * 340, hy + Math.sin(ba - 0.045) * 340],
      [hx + Math.cos(ba + 0.045) * 340, hy + Math.sin(ba + 0.045) * 340],
    ],
    [255, 244, 200],
    0.16,
  );
  void chimTop;
}

function drawTrain(): void {
  const loco = arcAt(745);
  const car1 = arcAt(555);
  const car2 = arcAt(385);
  const car3 = arcAt(215);
  // smoke first, behind the train
  const chim = rotPt(loco.x, loco.y, 77, -86, loco.ang);
  drawSmoke(chim, loco.ang);
  // cars back to front so overlaps read as coupled
  drawCar(car3.x, car3.y, car3.ang, 190, 84);
  drawCar(car2.x, car2.y, car2.ang, 200, 84);
  drawCar(car1.x, car1.y, car1.ang, 200, 84);
  drawLoco(loco.x, loco.y, loco.ang);
  // sparks: wheels, breaks, rail-curl tip, one wheel torn loose
  for (const c of [car3, car2, car1, loco]) {
    const [wx, wy] = rotPt(c.x, c.y, 0, 52, c.ang);
    sparkBurst(wx, wy + 12, 7, 120, 200);
  }
  sparkBurst(GAP_L, DECK_Y - 6, 26, 170, -60);
  sparkBurst(GAP_R, DECK_Y - 6, 22, 170, -120);
  sparkBurst(548, 664, 22, 150, -70);
  // a wheel torn off, tumbling into the gorge with a spark trail
  disc(468, 838, 14, [8, 3, 6]);
  disc(468, 838, 6, [58, 26, 34], 0.9);
  sparkBurst(468, 838, 16, 200, 90);
  // embers drifting up from the gorge
  for (let i = 0; i < 14; i++) {
    const ex = 430 + rnd() * 180;
    const ey = 900 + rnd() * 90;
    disc(ex, ey, 1.5 + rnd() * 2, SPARK_COLORS[Math.floor(rnd() * 3)], 0.8);
  }
}

// ---- vignette ----
function drawVignette(): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2);
      const dy = (y - H / 2) / (H / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.74) {
        const f = 1 - (d - 0.74) * 0.5;
        const i = (y * W + x) * 3;
        img[i] = clamp255(img[i] * f);
        img[i + 1] = clamp255(img[i + 1] * f);
        img[i + 2] = clamp255(img[i + 2] * f);
      }
    }
  }
}

// ---- main ----
function main(): void {
  drawSky();
  drawSun();
  drawClouds();
  drawCanyon();
  drawBridge();
  drawSpeedLines();
  drawTrain();
  drawVignette();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const png = encodePNG();
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
}
main();
