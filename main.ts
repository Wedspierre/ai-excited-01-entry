// ai-excited-01 v3 — "The Paper Plane That Outgrew the City"
// A paper plane the size of a city block glides between skyscrapers at dusk
// while tiny people watch from the rooftops. Procedural pixel renderer +
// hand-written PNG encoder. Node 22 stdlib only, no network, fully
// deterministic: fixed-seed PRNG, no Date / Math.random / time.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";

const W = 1024;
const H = 1024;
const SS = 2; // supersample factor for clean edges
const SW = W * SS;
const SH = H * SS;

// ---- fixed-seed PRNG (mulberry32) ----
let seed = 0x9e3779b9;
function rnd(): number {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---- framebuffer (RGB, supersampled) ----
const fb = new Uint8Array(SW * SH * 3);

function clamp255(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

function px(x: number, y: number, r: number, g: number, b: number, a = 1): void {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return;
  const i = (y * SW + x) * 3;
  if (a >= 1) { fb[i] = r; fb[i + 1] = g; fb[i + 2] = b; return; }
  fb[i] = clamp255(fb[i] * (1 - a) + r * a);
  fb[i + 1] = clamp255(fb[i + 1] * (1 - a) + g * a);
  fb[i + 2] = clamp255(fb[i + 2] * (1 - a) + b * a);
}

// logical coords (1024 space) -> supersampled
function P(x: number, y: number, r: number, g: number, b: number, a = 1): void {
  px(Math.round(x * SS), Math.round(y * SS), r, g, b, a);
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function mix(c1: number[], c2: number[], t: number): number[] {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// ---- shapes (logical coords) ----
function rect(x0: number, y0: number, x1: number, y1: number, c: number[], a = 1): void {
  for (let y = Math.max(0, Math.floor(y0 * SS)); y < Math.min(SH, Math.ceil(y1 * SS)); y++)
    for (let x = Math.max(0, Math.floor(x0 * SS)); x < Math.min(SW, Math.ceil(x1 * SS)); x++)
      px(x, y, c[0], c[1], c[2], a);
}

function fillTri(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: number[], a = 1): void {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) * SS));
  const maxX = Math.min(SW - 1, Math.ceil(Math.max(ax, bx, cx) * SS));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) * SS));
  const maxY = Math.min(SH - 1, Math.ceil(Math.max(ay, by, cy) * SS));
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const fx = (x + 0.5) / SS, fy = (y + 0.5) / SS;
      const w0 = ((by - cy) * (fx - cx) + (cx - bx) * (fy - cy)) / d;
      const w1 = ((cy - ay) * (fx - cx) + (ax - cx) * (fy - cy)) / d;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) px(x, y, c[0], c[1], c[2], a);
    }
  }
}

function disc(cx: number, cy: number, r: number, c: number[], a = 1): void {
  const rS = r * SS;
  const minX = Math.max(0, Math.floor((cx - r) * SS)), maxX = Math.min(SW - 1, Math.ceil((cx + r) * SS));
  const minY = Math.max(0, Math.floor((cy - r) * SS)), maxY = Math.min(SH - 1, Math.ceil((cy + r) * SS));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = (x + 0.5) / SS - cx, dy = (y + 0.5) / SS - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r * r) {
        // soft 1px edge
        const edge = Math.sqrt(d2);
        const aa = clamp255((r - edge) * SS + 0.5) / 255;
        px(x, y, c[0], c[1], c[2], a * Math.min(1, Math.max(0, aa)));
      }
    }
  }
}

// thick line with round caps, supersampled
function line(x0: number, y0: number, x1: number, y1: number, w: number, c: number[], a = 1): void {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.ceil(len * SS * 1.5);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + dx * t, y0 + dy * t, w / 2, c, a);
  }
}

// soft radial glow: additive-ish blend toward color
function glow(cx: number, cy: number, r: number, c: number[], peak: number): void {
  const minX = Math.max(0, Math.floor((cx - r) * SS)), maxX = Math.min(SW - 1, Math.ceil((cx + r) * SS));
  const minY = Math.max(0, Math.floor((cy - r) * SS)), maxY = Math.min(SH - 1, Math.ceil((cy + r) * SS));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = (x + 0.5) / SS - cx, dy = (y + 0.5) / SS - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d >= 1) continue;
      const f = Math.pow(1 - d, 2.2) * peak;
      px(x, y, c[0], c[1], c[2], f);
    }
  }
}

// ================= SKY =================
const SKY_STOPS: [number, number[]][] = [
  [0.00, [16, 14, 48]],
  [0.30, [52, 32, 86]],
  [0.52, [122, 54, 104]],
  [0.68, [214, 96, 84]],
  [0.80, [255, 150, 76]],
  [1.00, [255, 196, 110]],
];
function skyAt(t: number): number[] {
  for (let i = 1; i < SKY_STOPS.length; i++) {
    if (t <= SKY_STOPS[i][0]) {
      const [t0, c0] = SKY_STOPS[i - 1], [t1, c1] = SKY_STOPS[i];
      return mix(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return SKY_STOPS[SKY_STOPS.length - 1][1];
}
for (let y = 0; y < SH; y++) {
  const c = skyAt(y / SH);
  for (let x = 0; x < SW; x++) {
    const i = (y * SW + x) * 3;
    fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2];
  }
}

// stars in the upper sky
for (let i = 0; i < 150; i++) {
  const x = rnd() * W, y = rnd() * 380;
  const s = rnd();
  if (s < 0.5) P(x, y, 255, 240, 220, 0.25 + rnd() * 0.55);
  else P(x, y, 200, 210, 255, 0.2 + rnd() * 0.4);
}

// sun + glow (low, behind the plane's path — just above the skyline)
glow(705, 565, 300, [255, 170, 90], 0.6);
glow(705, 565, 150, [255, 210, 140], 0.85);
disc(705, 565, 56, [255, 226, 168]);
disc(705, 565, 48, [255, 240, 205]);

// sunset cloud streaks
const CLOUDS: [number, number, number, number, number[]][] = [
  [120, 210, 260, 16, [255, 150, 130]],
  [560, 150, 300, 14, [255, 170, 150]],
  [820, 300, 240, 13, [240, 130, 140]],
  [300, 420, 340, 15, [255, 180, 150]],
  [60, 560, 220, 12, [255, 160, 120]],
  [760, 520, 280, 13, [255, 175, 140]],
];
for (const [cx, cy, rx, ry, col] of CLOUDS) {
  for (let k = 0; k < 5; k++) {
    disc(cx + (rnd() - 0.5) * rx * 1.2, cy + (rnd() - 0.5) * ry * 1.6, rx * (0.25 + rnd() * 0.3), col, 0.10 + rnd() * 0.10);
  }
}

// distant birds
for (const [bx, by, s] of [[180, 260, 9], [215, 245, 7], [880, 210, 8], [905, 232, 6], [430, 180, 7]] as const) {
  line(bx - s, by, bx, by - s * 0.55, 2.2, [30, 20, 50], 0.85);
  line(bx, by - s * 0.55, bx + s, by, 2.2, [30, 20, 50], 0.85);
}

// ================= CITY =================
// back skyline (lighter, hazy)
const BACK: [number, number, number][] = [
  [0, 700, 150], [120, 640, 190], [260, 690, 130], [380, 600, 210],
  [560, 670, 150], [690, 620, 180], [830, 680, 140], [940, 640, 90],
];
for (const [bx, top, bw] of BACK) {
  rect(bx, top, bx + bw, H, [58, 44, 82]);
  if (bw > 120) rect(bx + bw * 0.4, top - 26, bx + bw * 0.6, top, [58, 44, 82]); // rooftop block
}
// front skyline (dark, crisp)
const FRONT: [number, number, number][] = [
  [0, 760, 170], [150, 700, 150], [290, 780, 130], [410, 660, 170],
  [560, 760, 140], [690, 700, 160], [840, 770, 184],
];
for (const [bx, top, bw] of FRONT) {
  rect(bx, top, bx + bw, H, [22, 15, 40]);
  // antenna on some towers
  if (bw >= 150) {
    line(bx + bw / 2, top, bx + bw / 2, top - 42, 3, [22, 15, 40]);
    disc(bx + bw / 2, top - 44, 3.5, [255, 90, 80], 0.95);
  }
}
// lit windows on front towers (warm, sparse)
seed = 0x51ab3c7d; // re-seed for the window pattern (still fixed)
for (const [bx, top, bw] of FRONT) {
  const cols = Math.floor(bw / 22), rows = Math.floor((H - top) / 30);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.34) {
        const warm = rnd();
        const col = warm < 0.7 ? [255, 205, 120] : warm < 0.9 ? [255, 160, 110] : [170, 220, 255];
        rect(bx + 8 + c * 22, top + 14 + r * 30, bx + 8 + c * 22 + 9, top + 14 + r * 30 + 12, col, 0.55 + rnd() * 0.4);
      }
    }
  }
}
// a few lit windows on back towers
for (const [bx, top, bw] of BACK) {
  const cols = Math.floor(bw / 26), rows = Math.floor((H - top) / 34);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.16) rect(bx + 8 + c * 26, top + 14 + r * 34, bx + 8 + c * 26 + 8, top + 14 + r * 34 + 10, [255, 190, 120], 0.5);
    }
  }
}

// rooftop observers: tiny people pointing up at the plane
function person(x: number, y: number, h: number, c: number[]): void {
  // y = feet on rooftop; drawn large enough to read as a tiny watcher
  line(x, y - h * 0.55, x, y - h, 3, c);              // body
  disc(x, y - h - 3.5, 3.4, c);                       // head
  line(x, y - h * 0.75, x - 6, y - h - 8, 2.6, c);    // raised arm
  line(x, y - h * 0.75, x + 6.5, y - h - 9, 2.6, c);  // raised arm
  line(x, y - h * 0.55, x - 3.5, y, 2.6, c);          // leg
  line(x, y - h * 0.55, x + 3.5, y, 2.6, c);          // leg
}
const WATCH: [number, number][] = [
  [185, 700], [215, 700], [245, 700],          // left tower roof, trio
  [480, 660], [505, 660],                      // middle tower roof
  [770, 700], [800, 700], [828, 700], [855, 700], // right tower roof, crowd
];
for (const [wx, wy] of WATCH) person(wx, wy, 21, [8, 6, 18]);

// ================= THE GIANT PAPER PLANE =================
// Nose to the right, gliding down-right across the dusk sky.
// Classic folded plane, drawn as facets so the fold reads at any size.
const NOSE: [number, number] = [884, 318];
const TAIL_TOP: [number, number] = [238, 236];
const TAIL_BOT: [number, number] = [300, 556];
const KEEL: [number, number] = [330, 428];   // inner fold point
const SPINE: [number, number] = [430, 330];  // top fold ridge

// speed streaks trailing behind the tail (motion)
for (let i = 0; i < 5; i++) {
  const y = 250 + i * 62 + rnd() * 10;
  const x0 = 30 + rnd() * 60, x1 = 210 - i * 12;
  line(x0, y, x1, y + 8, 3 + rnd() * 2, [255, 255, 255], 0.28 + rnd() * 0.2);
}
// small paper scraps tumbling in its wake
for (let i = 0; i < 4; i++) {
  const x = 185 + rnd() * 90, y = 300 + rnd() * 200;
  fillTri(x, y, x + 9, y + 4, x + 3, y + 10, [240, 244, 252], 0.85);
}

// under-facet (shadow side, cool grey-blue)
fillTri(NOSE[0], NOSE[1], TAIL_BOT[0], TAIL_BOT[1], KEEL[0], KEEL[1], [168, 182, 208]);
// main top facet (bright white, catches the sunset)
fillTri(NOSE[0], NOSE[1], TAIL_TOP[0], TAIL_TOP[1], SPINE[0], SPINE[1], [255, 255, 255]);
// upper wing facet (warm sunset tint on the far wing)
fillTri(NOSE[0], NOSE[1], SPINE[0], SPINE[1], KEEL[0], KEEL[1], [255, 226, 196]);
// lower wing facet (soft blue-grey)
fillTri(NOSE[0], NOSE[1], KEEL[0], KEEL[1], TAIL_BOT[0], TAIL_BOT[1], [205, 216, 235]);
// fold shadow along the keel
line(NOSE[0], NOSE[1], KEEL[0], KEEL[1], 5, [120, 132, 160], 0.65);
line(NOSE[0], NOSE[1], SPINE[0], SPINE[1], 3, [150, 158, 180], 0.4);
// crisp outline so the plane pops against the sky
line(NOSE[0], NOSE[1], TAIL_TOP[0], TAIL_TOP[1], 3, [96, 108, 140], 0.85);
line(NOSE[0], NOSE[1], TAIL_BOT[0], TAIL_BOT[1], 3, [96, 108, 140], 0.85);
line(TAIL_TOP[0], TAIL_TOP[1], TAIL_BOT[0], TAIL_BOT[1], 2.5, [96, 108, 140], 0.5);
// sunset rim light on the plane's top edge
line(NOSE[0], NOSE[1], TAIL_TOP[0], TAIL_TOP[1], 2, [255, 190, 120], 0.7);

// warm haze band near the horizon (in front of buildings' bases)
for (let y = 900; y < H; y++) {
  const a = 0.10 * (1 - (y - 900) / 124);
  for (let x = 0; x < SW; x++) px(x, y * SS, 255, 150, 90, a);
}

// ================= DOWNSAMPLE + PNG =================
const out = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < SS; dy++)
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * SW + x * SS + dx) * 3;
        r += fb[i]; g += fb[i + 1]; b += fb[i + 2];
      }
    const o = (y * W + x) * 3;
    out[o] = Math.round(r / (SS * SS));
    out[o + 1] = Math.round(g / (SS * SS));
    out[o + 2] = Math.round(b / (SS * SS));
  }
}

// CRC32
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// scanlines with per-row filter choice (None vs Up), pick smaller residual
const raw = Buffer.alloc(H * (1 + W * 3));
let prev = Buffer.alloc(W * 3);
for (let y = 0; y < H; y++) {
  const row = Buffer.from(out.subarray(y * W * 3, (y + 1) * W * 3));
  let bestF = 0, bestScore = Infinity, bestRow = row;
  for (const f of [0, 2]) {
    const cand = Buffer.alloc(W * 3);
    for (let i = 0; i < W * 3; i++) {
      const v = f === 0 ? row[i] : (row[i] - prev[i] + 256) & 0xff;
      cand[i] = v;
    }
    let score = 0;
    for (let i = 0; i < W * 3; i++) { const s = cand[i] > 127 ? cand[i] - 256 : cand[i]; score += Math.abs(s); }
    if (score < bestScore) { bestScore = score; bestF = f; bestRow = cand; }
  }
  raw[y * (1 + W * 3)] = bestF;
  bestRow.copy(raw, y * (1 + W * 3) + 1);
  prev = row;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), png);
console.log(`wrote ${join(outDir, "entry.png")} ${png.length} bytes ${W}x${H}`);
