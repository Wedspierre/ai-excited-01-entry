// ai-excited-01 v8 — "DON'T BLINK, JUDGE! THE WAVE EATS THE SUN"
// A lone surfer drops into a giant curling wave that glows gold from inside
// at sunset: spray exploding off the lip, the horizon burning orange, one tiny
// human silhouette against a wall of water. Fear and awe in the same frame.
//
// Node 22, standard library only. Deterministic: fixed seed, no clock, no
// network, no Math.random. Two runs write byte-identical PNGs.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Writes /output/entry.png by default (MAKEFUN_OUTPUT_DIR overrides it).

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;
const HORIZON = 640;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32, fixed seed). Every random call below happens
// in a fixed order, so the picture is identical on every run.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261117);

// ---------------------------------------------------------------------------
// Canvas: RGBA buffer, origin top-left.
// ---------------------------------------------------------------------------
const px = new Uint8Array(W * H * 4);

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mix3(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Opaque write.
function put(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r | 0;
  px[i + 1] = g | 0;
  px[i + 2] = b | 0;
  px[i + 3] = 255;
}

// Alpha-blended write (a in 0..1).
function blend(x, y, r, g, b, a) {
  if (a <= 0) return;
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  if (a >= 1) {
    px[i] = r | 0;
    px[i + 1] = g | 0;
    px[i + 2] = b | 0;
    px[i + 3] = 255;
    return;
  }
  const ia = 1 - a;
  px[i] = Math.round(r * a + px[i] * ia);
  px[i + 1] = Math.round(g * a + px[i + 1] * ia);
  px[i + 2] = Math.round(b * a + px[i + 2] * ia);
  px[i + 3] = 255;
}

function fillRect(x0, y0, x1, y1, r, g, b) {
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) put(x, y, r, g, b);
  }
}

// Filled ellipse with alpha.
function ellipse(cx, cy, rx, ry, r, g, b, a) {
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const t = (y - cy) / ry;
    const half = rx * Math.sqrt(Math.max(0, 1 - t * t));
    const x0 = Math.max(0, Math.ceil(cx - half));
    const x1 = Math.min(W - 1, Math.floor(cx + half));
    for (let x = x0; x <= x1; x++) blend(x, y, r, g, b, a);
  }
}

// Filled disc with alpha.
function disc(cx, cy, rad, r, g, b, a) {
  const r0 = Math.max(0, Math.floor(cy - rad));
  const r1 = Math.min(H - 1, Math.ceil(cy + rad));
  for (let y = r0; y <= r1; y++) {
    const dy = y - cy;
    const half = Math.sqrt(Math.max(0, rad * rad - dy * dy));
    const x0 = Math.max(0, Math.ceil(cx - half));
    const x1 = Math.min(W - 1, Math.floor(cx + half));
    for (let x = x0; x <= x1; x++) blend(x, y, r, g, b, a);
  }
}

// Thick line drawn as a chain of discs.
function thickLine(x0, y0, x1, y1, w, r, g, b, a) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 0.6));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(x0 + dx * t, y0 + dy * t, w / 2, r, g, b, a);
  }
}

function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}
function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}
function sampleCurve(fn, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(fn(i / n));
  return pts;
}

// Scanline polygon fill; shader(x, y) returns [r, g, b, a].
function fillPolyShader(pts, shader) {
  let minY = H;
  let maxY = 0;
  for (const p of pts) {
    minY = Math.min(minY, Math.floor(p[1]));
    maxY = Math.max(maxY, Math.ceil(p[1]));
  }
  minY = Math.max(0, minY);
  maxY = Math.min(H - 1, maxY);
  const n = pts.length;
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) {
        const c = shader(x, y);
        blend(x, y, c[0], c[1], c[2], c[3]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Sky: deep violet at the top burning down to gold at the horizon.
// ---------------------------------------------------------------------------
const SKY_STOPS = [
  [0, 36, 10, 62], // deep violet
  [240, 96, 26, 88], // magenta dusk
  [430, 196, 66, 44], // burnt orange
  [560, 248, 138, 52], // amber
  [HORIZON, 255, 178, 70], // molten gold
];
for (let y = 0; y < HORIZON; y++) {
  let s0 = SKY_STOPS[0];
  let s1 = SKY_STOPS[SKY_STOPS.length - 1];
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    if (y >= SKY_STOPS[i][0] && y <= SKY_STOPS[i + 1][0]) {
      s0 = SKY_STOPS[i];
      s1 = SKY_STOPS[i + 1];
      break;
    }
  }
  const t = s1[0] === s0[0] ? 0 : (y - s0[0]) / (s1[0] - s0[0]);
  const r = Math.round(lerp(s0[1], s1[1], t));
  const g = Math.round(lerp(s0[2], s1[2], t));
  const b = Math.round(lerp(s0[3], s1[3], t));
  for (let x = 0; x < W; x++) put(x, y, r, g, b);
}

// ---------------------------------------------------------------------------
// 2. The low sun, half-sunk, with a wide burning glow.
// ---------------------------------------------------------------------------
const SUN = { x: 330, y: 588, r: 88 };
for (let rad = 290; rad > SUN.r; rad -= 6) {
  const a = 0.085 * (1 - (rad - SUN.r) / 200);
  disc(SUN.x, SUN.y, rad, 255, 148, 58, Math.max(0, a));
}
disc(SUN.x, SUN.y, SUN.r, 255, 216, 128, 1);
disc(SUN.x, SUN.y, SUN.r - 26, 255, 236, 178, 1);
// Sun's hot core.
disc(SUN.x, SUN.y, SUN.r - 52, 255, 248, 214, 1);

// ---------------------------------------------------------------------------
// 3. A distant low ridge on the left horizon, half-eating the sun.
// ---------------------------------------------------------------------------
fillPolyShader(
  [
    [0, HORIZON],
    [0, 612],
    [90, 596],
    [180, 578],
    [260, 592],
    [340, 614],
    [420, HORIZON],
  ],
  () => [10, 44, 62, 1],
);

// ---------------------------------------------------------------------------
// 4. Sea: dark teal falling away into night, with the sun's golden road.
// ---------------------------------------------------------------------------
for (let y = HORIZON; y < H; y++) {
  const t = (y - HORIZON) / (H - HORIZON);
  const c = mix3([12, 56, 78], [2, 14, 26], t);
  for (let x = 0; x < W; x++) put(x, y, c[0] | 0, c[1] | 0, c[2] | 0);
}
// Golden reflection: shimmering dashes widening toward the viewer.
for (let y = HORIZON + 8; y < H - 8; y += 7) {
  const w = 26 + (y - HORIZON) * 0.34;
  const cx = SUN.x + Math.sin(y * 0.02) * 8;
  const dashes = 1 + Math.floor(rand() * 3);
  for (let d = 0; d < dashes; d++) {
    const len = 12 + rand() * 34;
    const x0 = cx - w / 2 + rand() * (w - len);
    const a = 0.16 + rand() * 0.4 * (1 - (y - HORIZON) / 420);
    thickLine(x0, y, x0 + len, y, 3, 255, 186, 92, Math.max(0.08, a));
  }
}

// ---------------------------------------------------------------------------
// 5. THE WAVE — a giant curling barrel filling the right two-thirds.
//    Crest sweeps up from the right edge, the lip hooks over and down, the
//    face curves back to the sea. Its shader glows gold from inside, where
//    the sunset shines straight through the water.
// ---------------------------------------------------------------------------
const crestPts = sampleCurve(
  (t) => cubic([1024, 300], [920, 180], [740, 165], [620, 230], t),
  48,
);
const lipPts = sampleCurve((t) => quad([620, 230], [560, 300], [640, 395], t), 24);
const facePts = sampleCurve(
  (t) => cubic([640, 395], [545, 620], [600, 860], [720, 1024], t),
  48,
);
const wavePts = [
  [1024, 1024],
  [1024, 300],
  ...crestPts.slice(1),
  ...lipPts.slice(1),
  ...facePts.slice(1),
  [720, 1024],
];

function waveColor(x, y) {
  const v = clamp((y - 180) / 844, 0, 1);
  let c;
  if (v < 0.5) c = mix3([34, 140, 128], [14, 92, 102], v / 0.5);
  else c = mix3([14, 92, 102], [5, 36, 54], (v - 0.5) / 0.5);
  // Sunset burning through the water near the barrel.
  const dx = x - 760;
  const dy = y - 360;
  const d = Math.sqrt(dx * dx + dy * dy);
  const g = Math.pow(Math.max(0, 1 - d / 380), 2) * 0.6;
  c = [lerp(c[0], 255, g), lerp(c[1], 178, g), lerp(c[2], 72, g)];
  // Depth darkening at the far right edge.
  if (x > 960) {
    const s = ((x - 960) / 64) * 0.25;
    c = [c[0] * (1 - s), c[1] * (1 - s), c[2] * (1 - s)];
  }
  return [c[0], c[1], c[2], 1];
}
fillPolyShader(wavePts, waveColor);

// Sunlight shafts slanting across the wave face — thin, soft, few, kept
// to the right side so they never cross the surfer.
for (let i = 0; i < 3; i++) {
  const x0 = 800 + i * 62 + rand() * 18;
  const y0 = 380 + rand() * 40;
  thickLine(x0, y0, x0 - 100, y0 + 240, 4, 255, 200, 100, 0.05 + rand() * 0.03);
}

// ---------------------------------------------------------------------------
// 6. The barrel mouth: a dark eye in the wave, rimmed with gold fire.
// ---------------------------------------------------------------------------
// (No separate barrel mouth is drawn: the curling lip, the gold glow
// burning through the face, and the surfer inside the curl carry the tube.
// A drawn opening kept reading as a floating object, not as water.)

// ---------------------------------------------------------------------------
// 7. The lip: white-gold foam tearing along the crest, drips, and spray
//    exploding upward off it.
// ---------------------------------------------------------------------------
for (let i = 0; i + 1 < crestPts.length; i++) {
  const a = crestPts[i];
  const b = crestPts[i + 1];
  thickLine(a[0], a[1], b[0], b[1], 15, 250, 248, 238, 0.95);
}
for (let i = 0; i + 1 < crestPts.length; i++) {
  const a = crestPts[i];
  const b = crestPts[i + 1];
  thickLine(a[0], a[1] + 7, b[0], b[1] + 7, 5, 255, 196, 92, 0.85);
}
// Drips hanging off the lip.
for (let i = 2; i < crestPts.length - 2; i += 3) {
  const p = crestPts[i];
  const len = 10 + rand() * 24;
  thickLine(p[0], p[1] + 4, p[0] + (rand() - 0.5) * 8, p[1] + 4 + len, 3, 250, 250, 244, 0.85);
}
// Spray bursting off the crest.
for (let i = 0; i < 380; i++) {
  const p = crestPts[Math.floor(rand() * crestPts.length)];
  const x = p[0] + (rand() - 0.5) * 36;
  const y = p[1] - rand() * 78;
  const r = 1 + rand() * 3.2;
  if (rand() < 0.45) disc(x, y, r, 255, 210, 120, 0.55 + rand() * 0.4);
  else disc(x, y, r, 252, 252, 246, 0.6 + rand() * 0.4);
}
// Long spray streaks flung up and left.
for (let i = 0; i < 48; i++) {
  const p = crestPts[Math.floor(rand() * crestPts.length)];
  const ang = Math.PI * (0.72 + rand() * 0.28);
  const len = 22 + rand() * 56;
  thickLine(p[0], p[1], p[0] + Math.cos(ang) * len, p[1] - Math.sin(ang) * len, 2, 252, 252, 246, 0.55 + rand() * 0.3);
}
// A big plume exploding off the lip tip.
for (let i = 0; i < 70; i++) {
  const ang = rand() * Math.PI * 2;
  const len = 12 + rand() * 90;
  const x = 620 + Math.cos(ang) * len;
  const y = 232 + Math.sin(ang) * len * 0.8;
  disc(x, y, 1 + rand() * 2.6, 252, 252, 246, 0.5 + rand() * 0.45);
}

// ---------------------------------------------------------------------------
// 8. Foam at the wave's base and streaks across the sea.
// ---------------------------------------------------------------------------
for (let i = 0; i < 150; i++) {
  const x = 700 + rand() * 320;
  const y = 930 + rand() * 90;
  disc(x, y, 1.5 + rand() * 5, 240, 246, 248, 0.25 + rand() * 0.5);
}
for (let i = 0; i < 10; i++) {
  const y = 700 + rand() * 300;
  const x0 = 40 + rand() * 300;
  const len = 60 + rand() * 180;
  thickLine(x0, y, x0 + len, y + (rand() - 0.5) * 6, 2.5, 235, 242, 246, 0.2 + rand() * 0.25);
}

// ---------------------------------------------------------------------------
// 9. THE SURFER — one tiny dark silhouette dropping down the face,
//    board lit gold, spray trailing behind the tail.
// ---------------------------------------------------------------------------
const SURF = { x: 655, y: 700 };
// Spray trail behind the board.
for (let i = 0; i < 26; i++) {
  const t = i / 26;
  const x = 640 - t * 46 + (rand() - 0.5) * 10;
  const y = 730 + t * 26 + (rand() - 0.5) * 8;
  disc(x, y, 1.5 + rand() * 2.5, 250, 250, 244, 0.85 - t * 0.5);
}
// Board, nose down the face, gold edge catching the sun.
thickLine(628, 734, 682, 710, 6, 248, 244, 232, 1);
thickLine(628, 732, 682, 708, 2, 255, 200, 96, 1);
// The surfer: crouched, arms out, black against the glowing wall.
const INK = [8, 10, 14];
disc(SURF.x, SURF.y - 4, 5, INK[0], INK[1], INK[2], 1); // head
thickLine(SURF.x, SURF.y + 1, SURF.x - 4, SURF.y + 20, 6, INK[0], INK[1], INK[2], 1); // torso
thickLine(SURF.x - 3, SURF.y + 6, SURF.x - 18, SURF.y + 12, 4, INK[0], INK[1], INK[2], 1); // back arm
thickLine(SURF.x - 3, SURF.y + 6, SURF.x + 13, SURF.y + 1, 4, INK[0], INK[1], INK[2], 1); // front arm
thickLine(SURF.x - 4, SURF.y + 20, SURF.x - 16, SURF.y + 33, 4.5, INK[0], INK[1], INK[2], 1); // back leg
thickLine(SURF.x - 4, SURF.y + 20, SURF.x + 10, SURF.y + 31, 4.5, INK[0], INK[1], INK[2], 1); // front leg

// ---------------------------------------------------------------------------
// 10. Birds for scale — five small silhouettes high in the burning sky.
// ---------------------------------------------------------------------------
for (const [bx, by, s] of [
  [150, 170, 9],
  [215, 140, 7],
  [270, 190, 8],
  [900, 120, 8],
  [950, 160, 6],
]) {
  thickLine(bx - s, by - 3, bx, by + 2, 2, 24, 10, 30, 0.9);
  thickLine(bx + s, by - 3, bx, by + 2, 2, 24, 10, 30, 0.9);
}

// ---------------------------------------------------------------------------
// 11. The words to the judge — big block letters, gold first line, white
//     after, dark outline so they punch through the sky at any size.
// ---------------------------------------------------------------------------
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
  ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};

function drawGlyph(ch, x, y, s, r, g, b, a) {
  const rows = FONT[ch];
  if (!rows) return;
  for (let ry = 0; ry < 7; ry++) {
    for (let rx = 0; rx < 5; rx++) {
      if (rows[ry][rx] === '1') {
        for (let dy = 0; dy < s; dy++) {
          for (let dx = 0; dx < s; dx++) blend(x + rx * s + dx, y + ry * s + dy, r, g, b, a);
        }
      }
    }
  }
}

function drawTextRaw(text, x, y, s, r, g, b, a) {
  let cx = x;
  for (const ch of text) {
    drawGlyph(ch, cx, y, s, r, g, b, a);
    cx += 5 * s + s + 1;
  }
}

// Outline pass (8 offsets in dark ink), then the face colour.
function drawText(text, x, y, s, fr, fg, fb) {
  const offs = [
    [-3, 0],
    [3, 0],
    [0, -3],
    [0, 3],
    [-3, -3],
    [3, 3],
    [-3, 3],
    [3, -3],
  ];
  for (const [dx, dy] of offs) drawTextRaw(text, x + dx, y + dy, s, 16, 8, 28, 0.95);
  drawTextRaw(text, x, y, s, fr, fg, fb, 1);
}

drawText("DON'T BLINK, JUDGE!", 48, 62, 7, 255, 196, 84);
drawText('THE WAVE', 48, 128, 7, 255, 246, 232);
drawText('EATS THE SUN', 48, 194, 7, 255, 246, 232);
// Small proof-of-craft line along the bottom.
drawText('DRAWN BY CODE. NO PHOTO. NO STOCK.', 48, 976, 3, 255, 214, 140);

// ---------------------------------------------------------------------------
// 12. Encode a whole PNG (stdlib zlib) and write it.
// ---------------------------------------------------------------------------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type 6: RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0; // filter: none
  raw.set(px.subarray(y * W * 4, (y + 1) * W * 4), y * (1 + W * 4) + 1);
}
const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', idat),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'entry.png');
writeFileSync(outPath, png);
console.log(
  `wrote ${outPath} ${png.length} bytes sha256=${createHash('sha256').update(png).digest('hex')}`,
);
