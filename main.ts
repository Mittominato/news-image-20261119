// news-image-20261119 — "The world in one image: Thursday 19 November 2026".
// A Node 22 program (standard library only, no network) that draws a 1024x1024
// newspaper-style infographic of the day's verified world news and writes it to
// /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png outside the grader).
//
// Everything here is drawn by hand in this file: the PNG encoder (CRC32 + chunk
// assembly, deflate via node:zlib), the 5x7 bitmap font below, the layout engine
// and every icon. No image files, no copied code, no randomness, no clock reads,
// so two runs write byte-identical PNGs.
//
// News embedded below was researched on 19 November 2026 (early UTC) and checked
// story by story against its publication date. Only events that happened, or were
// first reported, on 19 November 2026 are presented as today's news:
//   - GTA VI unlocks at midnight local time, starting in New Zealand (Reuters, 19 Nov)
//   - Gulf exchanges widen overnight: Kuwait and Bahrain report fresh attacks
//     after US jets hit a missile site on Qeshm Island (BBC, first reported 19 Nov 00:06Z)
//   - Trump, Xi and Putin meet in Shenzhen today, 2:30 p.m. — first-ever trilateral
//     (White House schedule; reported 18-19 Nov, meeting on 19 Nov)
//   - Cyclone Akvan: IMD bulletin 02:30, 19 Nov — red alert, schools shut, landfall due 20 Nov
//   - India-Japan 4th 2+2 dialogue in Tokyo on 19 Nov (PIB / The Hindu)
//   - NASA/JPL briefs today (19 Nov, noon EST) on Voyager 1, now one light-day away
// Footer items: General Pants collapses (19 Nov, Australia); scientists report a
// possible answer to Earth's missing billion years of geology (reported 19 Nov).
// Stories from 18 Nov (Jeffries nomination, Australia's settler sanctions, the Pew
// religion report, Fed minutes, Nvidia) were deliberately left out: they belong to
// 18 November, not to this day.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// PNG encoding: CRC32 (table built at runtime) + chunk assembly.
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crcBuf = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  out.writeUInt32BE(crc32(crcBuf), 8 + data.length);
  return out;
}

// Encode raw RGB pixels (width * height * 3 bytes) as a PNG. Filter 0 on every
// scanline, fixed deflate level, no ancillary chunks: fully deterministic.
function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter type 0: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (1 + width * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Canvas: a plain RGB raster with small drawing primitives.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array; // row-major RGB

  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.fillRect(0, 0, w, h, bg);
  }

  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }

  get(x: number, y: number): RGB {
    const i = (y * this.w + x) * 3;
    return [this.px[i], this.px[i + 1], this.px[i + 2]];
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.w + xx) * 3;
        this.px[i] = c[0];
        this.px[i + 1] = c[1];
        this.px[i + 2] = c[2];
      }
    }
  }

  // Outline rectangle, 1px border.
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    this.fillRect(x, y, w, 1, c);
    this.fillRect(x, y + h - 1, w, 1, c);
    this.fillRect(x, y, 1, h, c);
    this.fillRect(x + w - 1, y, 1, h, c);
  }

  // Bresenham line, with a square brush of the given thickness.
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, thick = 1): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.fillRect(x - Math.floor(thick / 2), y - Math.floor(thick / 2), thick, thick, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      this.fillRect(cx - half, cy + y, half * 2 + 1, 1, c);
    }
  }

  circle(cx: number, cy: number, r: number, c: RGB, thick = 1): void {
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180;
      const x = Math.round(cx + r * Math.cos(rad));
      const y = Math.round(cy + r * Math.sin(rad));
      this.fillRect(x - Math.floor(thick / 2), y - Math.floor(thick / 2), thick, thick, c);
    }
  }

  // Filled triangle by horizontal scanlines.
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      const edges: Array<[number, number, number, number]> = [
        [x0, y0, x1, y1],
        [x1, y1, x2, y2],
        [x2, y2, x0, y0],
      ];
      for (const [ax, ay, bx, by] of edges) {
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      if (xs.length >= 2) {
        const lo = Math.floor(Math.min(...xs));
        const hi = Math.ceil(Math.max(...xs));
        this.fillRect(lo, y, hi - lo + 1, 1, c);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bitmap font: 5x7 glyphs, one row per number, bit 4 = leftmost column.
// All text is rendered in capitals (lowercase input is upper-cased first).
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 6, 8, 16, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  ',': [0, 0, 0, 0, 0, 12, 4],
  ':': [0, 12, 12, 0, 12, 12, 0],
  ';': [0, 12, 12, 0, 12, 4, 8],
  '!': [4, 4, 4, 4, 4, 0, 4],
  '?': [14, 17, 1, 2, 4, 0, 4],
  '-': [0, 0, 0, 14, 0, 0, 0],
  '–': [0, 0, 0, 14, 0, 0, 0],
  '—': [0, 0, 0, 31, 0, 0, 0],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '|': [4, 4, 4, 4, 4, 4, 4],
  '/': [1, 1, 2, 4, 8, 16, 16],
  '&': [12, 18, 20, 8, 21, 18, 13],
  '%': [25, 25, 2, 4, 8, 19, 19],
  '+': [0, 4, 4, 14, 4, 4, 0],
  '=': [0, 0, 31, 0, 31, 0, 0],
  $: [4, 15, 20, 14, 5, 30, 4],
  '#': [10, 10, 31, 10, 31, 10, 10],
  '@': [14, 17, 23, 21, 23, 16, 14],
  '*': [0, 4, 21, 14, 21, 4, 0],
  '"': [10, 10, 10, 0, 0, 0, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  '•': [0, 0, 4, 14, 14, 4, 0],
  '°': [14, 17, 17, 14, 0, 0, 0],
};

const FONT_W = 5;
const FONT_H = 7;

function charWidth(scale: number): number {
  return (FONT_W + 1) * scale;
}

function textWidth(text: string, scale: number): number {
  return text.length * charWidth(scale) - scale;
}

function drawChar(cv: Canvas, ch: string, x: number, y: number, scale: number, c: RGB): void {
  const glyph = GLYPHS[ch] ?? GLYPHS[' '];
  for (let row = 0; row < FONT_H; row++) {
    const bits = glyph[row];
    for (let col = 0; col < FONT_W; col++) {
      if (bits & (1 << (FONT_W - 1 - col))) {
        cv.fillRect(x + col * scale, y + row * scale, scale, scale, c);
      }
    }
  }
}

// Draw text at (x, y); returns the x just past the last character.
function drawText(cv: Canvas, text: string, x: number, y: number, scale: number, c: RGB): number {
  const upper = text.toUpperCase();
  let cx = x;
  for (const ch of upper) {
    drawChar(cv, ch, cx, y, scale, c);
    cx += charWidth(scale);
  }
  return cx;
}

function drawTextCentred(cv: Canvas, text: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(cv, text, cx - Math.floor(textWidth(text, scale) / 2), y, scale, c);
}

// Greedy word wrap: returns lines that fit maxChars characters each.
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Palette (a newspaper front page: cream paper, dark ink, one accent per story)
// ---------------------------------------------------------------------------

const PAPER: RGB = [245, 240, 230];
const CARD: RGB = [255, 255, 255];
const INK: RGB = [17, 24, 39];
const MUTED: RGB = [100, 104, 116];
const NAVY: RGB = [15, 31, 56];
const NAVY2: RGB = [23, 48, 84];
const RED: RGB = [193, 39, 45];
const BLUE: RGB = [29, 78, 216];
const TEAL: RGB = [14, 116, 144];
const AMBER: RGB = [180, 83, 9];
const GREEN: RGB = [21, 128, 61];
const PURPLE: RGB = [109, 40, 217];
const GOLD: RGB = [212, 160, 23];
const PINK: RGB = [219, 39, 119];
const SKY: RGB = [125, 211, 252];
const LINE: RGB = [203, 199, 186];

// ---------------------------------------------------------------------------
// Icons: small drawn scenes, one per story. Each takes a bounding box.
// ---------------------------------------------------------------------------

// GTA VI: a neon night skyline over the sea, palm silhouettes, big "VI".
function iconGta(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [16, 24, 64]); // night sky
  cv.fillCircle(x + Math.floor(w * 0.78), y + Math.floor(h * 0.24), 16, [255, 214, 130]); // sun
  cv.fillCircle(x + Math.floor(w * 0.78), y + Math.floor(h * 0.24), 11, [255, 236, 180]);
  // stars
  const stars: Array<[number, number]> = [[8, 6], [26, 14], [48, 5], [64, 18], [90, 8], [112, 16], [40, 24], [104, 30]];
  for (const [sx, sy] of stars) cv.fillRect(x + sx, y + sy, 2, 2, [255, 255, 255]);
  // buildings
  const bld: Array<[number, number, number]> = [
    [0, 52, 34],
    [26, 40, 26],
    [48, 58, 30],
    [74, 34, 24],
    [96, 48, 30],
    [122, 60, 28],
  ];
  for (const [bx, by, bw] of bld) {
    cv.fillRect(x + bx, y + h - by - 26, bw, by + 26, [10, 16, 40]);
    for (let wy = y + h - by - 18; wy < y + h - 30; wy += 9) {
      for (let wx = x + bx + 4; wx < x + bx + bw - 3; wx += 8) {
        if ((wx * 7 + wy * 3) % 5 !== 0) cv.fillRect(wx, wy, 3, 4, GOLD);
      }
    }
  }
  // sea
  cv.fillRect(x, y + h - 26, w, 26, [8, 60, 110]);
  for (let i = 0; i < 5; i++) {
    cv.fillRect(x + 8 + i * 30, y + h - 20 + (i % 2) * 8, 18, 2, [90, 180, 230]);
  }
  // palm silhouettes
  cv.line(x + 14, y + h - 26, x + 14, y + h - 52, [6, 40, 24], 3);
  cv.line(x + 14, y + h - 52, x + 2, y + h - 60, [6, 40, 24], 2);
  cv.line(x + 14, y + h - 52, x + 26, y + h - 60, [6, 40, 24], 2);
  cv.line(x + 14, y + h - 52, x + 14, y + h - 62, [6, 40, 24], 2);
  drawText(cv, 'VI', x + Math.floor(w * 0.56), y + Math.floor(h * 0.52), 7, PINK);
}

// Gulf: dark sea, a drone and a burst of fire over the water.
function iconGulf(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [24, 34, 54]);
  cv.fillRect(x, y + Math.floor(h * 0.62), w, h - Math.floor(h * 0.62), [10, 42, 84]);
  for (let i = 0; i < 6; i++) {
    cv.fillRect(x + 6 + i * 22, y + Math.floor(h * 0.7) + (i % 2) * 10, 14, 2, [70, 140, 200]);
  }
  // explosion burst (orange star)
  const cx = x + Math.floor(w * 0.68);
  const cy = y + Math.floor(h * 0.34);
  for (let a = 0; a < 8; a++) {
    const rad = (a * Math.PI) / 4;
    const x2 = Math.round(cx + 26 * Math.cos(rad));
    const y2 = Math.round(cy + 26 * Math.sin(rad));
    cv.fillTriangle(cx - 4, cy - 4, cx + 4, cy + 4, x2, y2, [245, 158, 11]);
  }
  cv.fillCircle(cx, cy, 10, [249, 115, 22]);
  cv.fillCircle(cx, cy, 5, [255, 235, 150]);
  // drone: body + four rotors
  const dx = x + Math.floor(w * 0.24);
  const dy = y + Math.floor(h * 0.3);
  cv.fillRect(dx - 10, dy - 4, 20, 8, [200, 210, 225]);
  cv.fillRect(dx - 2, dy - 8, 4, 16, [160, 170, 185]);
  for (const [rx, ry] of [[-14, -10], [14, -10], [-14, 10], [14, 10]] as Array<[number, number]>) {
    cv.circle(dx + rx, dy + ry, 5, [220, 225, 235], 2);
    cv.line(dx + rx - 5, dy + ry, dx + rx + 5, dy + ry, [220, 225, 235], 1);
  }
  cv.fillCircle(dx, dy, 3, RED);
}

// Shenzhen: three flags (US stripes, China red, Russia tricolour) over towers.
function iconShenzhen(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [232, 238, 245]);
  // towers
  cv.fillRect(x + 8, y + h - 46, 22, 46, [90, 100, 118]);
  cv.fillRect(x + 38, y + h - 62, 24, 62, [70, 80, 100]);
  cv.fillRect(x + 70, y + h - 38, 22, 38, [110, 120, 138]);
  cv.fillRect(x + 100, y + h - 54, 22, 54, [80, 90, 110]);
  for (let wy = y + h - 56; wy < y + h - 8; wy += 8) {
    for (let wx = x + 12; wx < x + 118; wx += 10) {
      if ((wx + wy) % 3 === 0) cv.fillRect(wx, wy, 3, 4, [255, 220, 120]);
    }
  }
  // flag poles + flags
  const flags: Array<[number, RGB, (fx: number, fy: number) => void]> = [
    [0, [255, 255, 255], (fx, fy) => {
      for (let s = 0; s < 5; s++) cv.fillRect(fx, fy + s * 4, 30, 2, RED);
      cv.fillRect(fx, fy, 14, 10, BLUE);
    }],
    [48, [222, 41, 16], (fx, fy) => {
      cv.fillRect(fx, fy, 4, 4, GOLD);
      cv.fillRect(fx + 8, fy + 2, 2, 2, GOLD);
      cv.fillRect(fx + 12, fy + 6, 2, 2, GOLD);
    }],
    [96, [255, 255, 255], (fx, fy) => {
      cv.fillRect(fx, fy + 7, 30, 6, BLUE);
      cv.fillRect(fx, fy + 13, 30, 7, RED);
    }],
  ];
  for (const [off, bg, draw] of flags) {
    const fx = x + off;
    const fy = y + 8;
    cv.fillRect(fx, fy, 30, 20, bg);
    cv.rect(fx, fy, 30, 20, INK);
    draw(fx, fy);
    cv.fillRect(fx, fy + 20, 2, 12, INK);
  }
}

// Cyclone: a spiral swirl with rain streaks.
function iconCyclone(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [214, 228, 240]);
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2) - 4;
  for (let r = 46; r > 6; r -= 8) {
    cv.circle(cx, cy, r, r > 30 ? TEAL : BLUE, 3);
  }
  cv.fillCircle(cx, cy, 8, [255, 255, 255]);
  cv.fillCircle(cx, cy, 4, TEAL);
  // rain streaks
  for (let i = 0; i < 8; i++) {
    const rx = x + 6 + i * 16;
    const ry = y + h - 22 + (i % 2) * 8;
    cv.line(rx, ry, rx - 4, ry + 12, BLUE, 2);
  }
}

// India-Japan: the two flags side by side over a rising sun disc.
function iconIndiaJapan(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [238, 240, 244]);
  cv.fillCircle(x + Math.floor(w / 2), y + Math.floor(h * 0.42), 26, [255, 214, 130]);
  // India flag (left)
  const ix = x + 12;
  const iy = y + 14;
  cv.fillRect(ix, iy, 52, 12, [255, 153, 51]);
  cv.fillRect(ix, iy + 12, 52, 12, [255, 255, 255]);
  cv.fillRect(ix, iy + 24, 52, 12, [19, 136, 8]);
  cv.circle(ix + 26, iy + 18, 6, NAVY, 2);
  cv.rect(ix, iy, 52, 36, INK);
  // Japan flag (right)
  const jx = x + w - 64;
  const jy = y + 14;
  cv.fillRect(jx, jy, 52, 36, [255, 255, 255]);
  cv.fillCircle(jx + 26, jy + 18, 9, [188, 0, 45]);
  cv.rect(jx, jy, 52, 36, INK);
  // ground line + torii-ish gate
  cv.fillRect(x + 10, y + h - 26, w - 20, 3, INK);
  cv.line(x + 34, y + h - 26, x + 34, y + h - 52, RED, 3);
  cv.line(x + w - 34, y + h - 26, x + w - 34, y + h - 52, RED, 3);
  cv.fillRect(x + 26, y + h - 54, w - 52, 4, RED);
  cv.fillRect(x + 32, y + h - 44, w - 64, 3, RED);
}

// Voyager: black space, stars, a gold dish probe on a trajectory line.
function iconVoyager(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [8, 12, 26]);
  const stars: Array<[number, number]> = [[10, 8], [30, 20], [52, 6], [76, 16], [100, 8], [122, 22], [20, 44], [140, 40], [160, 10], [180, 26]];
  for (const [sx, sy] of stars) cv.fillRect(x + sx, y + sy, 2, 2, [255, 255, 255]);
  // trajectory
  cv.line(x + 8, y + h - 14, x + w - 60, y + 18, [120, 140, 180], 2);
  // probe body + dish
  const px = x + w - 52;
  const py = y + 22;
  cv.fillRect(px - 4, py - 2, 26, 6, [200, 205, 215]);
  cv.fillTriangle(px + 22, py - 10, px + 22, py + 14, px + 40, py + 2, [212, 175, 55]);
  cv.fillTriangle(px - 14, py - 2, px - 4, py - 2, px - 4, py + 4, [160, 165, 180]);
  cv.fillRect(px - 26, py, 12, 2, [212, 175, 55]);
  drawText(cv, '1 LIGHT-DAY', x + 10, y + h - 26, 2, [255, 235, 150]);
}

// ---------------------------------------------------------------------------
// The day's news (verified 19 Nov 2026, early UTC — see the file header).
// ---------------------------------------------------------------------------

interface Story {
  kicker: string;
  accent: RGB;
  headline: string;
  body: string[];
  icon: (cv: Canvas, x: number, y: number, w: number, h: number) => void;
}

const GRID_STORIES: Story[] = [
  {
    kicker: 'MIDDLE EAST',
    accent: RED,
    headline: 'GULF WAR WIDENS OVERNIGHT',
    body: [
      'Iran drones hit a US radar base in Bahrain; US jets hit Qeshm Island.',
      'Kuwait and Bahrain report fresh attacks overnight.',
    ],
    icon: iconGulf,
  },
  {
    kicker: 'DIPLOMACY — APEC',
    accent: BLUE,
    headline: 'TRUMP, XI AND PUTIN MEET TODAY',
    body: [
      'First-ever trilateral of the three leaders in Shenzhen, at 2:30 p.m.',
      'Nuclear arms on the table. No deal expected.',
    ],
    icon: iconShenzhen,
  },
  {
    kicker: 'WEATHER — INDIA',
    accent: TEAL,
    headline: 'CYCLONE AKVAN NEARS INDIA',
    body: [
      'Severe storm in the Bay of Bengal. Red alert on the east coast.',
      'Schools shut; landfall due Friday near Puri.',
    ],
    icon: iconCyclone,
  },
  {
    kicker: 'ASIA — DEFENCE',
    accent: GREEN,
    headline: 'INDIA AND JAPAN HOLD 2+2 TALKS',
    body: [
      'Ministers meet in Tokyo to deepen defence and Indo-Pacific ties.',
      'Fourth round of the foreign and defence dialogue.',
    ],
    icon: iconIndiaJapan,
  },
];

// ---------------------------------------------------------------------------
// Layout: 1024x1024 front page.
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;
const MARGIN = 24;

function drawGridPanel(cv: Canvas, x: number, y: number, w: number, h: number, s: Story): void {
  cv.fillRect(x, y, w, h, CARD);
  cv.rect(x, y, w, h, LINE);
  cv.fillRect(x, y, w, 4, s.accent);
  const iconW = 132;
  s.icon(cv, x + 1, y + 5, iconW, h - 6);
  cv.fillRect(x + iconW + 1, y + 5, 1, h - 10, LINE);
  const tx = x + iconW + 14;
  const tw = w - iconW - 26;
  let cy = y + 14;
  drawText(cv, s.kicker, tx, cy, 2, s.accent);
  cy += 20;
  const headChars = Math.floor(tw / charWidth(3));
  const headLines = wrapText(s.headline, headChars);
  for (const line of headLines) {
    drawText(cv, line, tx, cy, 3, INK);
    cy += 24;
  }
  cy += 2;
  const bodyChars = Math.floor(tw / charWidth(2));
  for (const para of s.body) {
    for (const line of wrapText(para, bodyChars)) {
      drawText(cv, line, tx, cy, 2, [52, 58, 72]);
      cy += 16;
    }
    cy += 3;
  }
}

function buildPage(): Canvas {
  const cv = new Canvas(W, H, PAPER);

  // ---- Banner -------------------------------------------------------------
  cv.fillRect(0, 0, W, 118, NAVY);
  cv.fillRect(0, 114, W, 4, RED);
  drawTextCentred(cv, 'THURSDAY 19 NOVEMBER 2026', W / 2, 24, 5, [255, 255, 255]);
  drawTextCentred(cv, 'THE WORLD IN ONE IMAGE', W / 2, 76, 2, [255, 214, 130]);

  // ---- Lead story: GTA VI -------------------------------------------------
  const lx = MARGIN;
  const ly = 134;
  const lw = W - 2 * MARGIN;
  const lh = 252;
  cv.fillRect(lx, ly, lw, lh, CARD);
  cv.rect(lx, ly, lw, lh, LINE);
  cv.fillRect(lx, ly, lw, 5, PINK);
  iconGta(cv, lx + 1, ly + 6, 300, lh - 7);
  cv.fillRect(lx + 301, ly + 6, 1, lh - 12, LINE);
  const tx = lx + 322;
  drawText(cv, 'CULTURE — GAMING', tx, ly + 18, 2, PINK);
  drawText(cv, 'GTA VI IS OUT', tx, ly + 44, 6, INK);
  drawText(cv, 'VICE CITY RETURNS AFTER 13 YEARS', tx, ly + 108, 3, RED);
  const leadBody = [
    "Rockstar's sequel unlocks at midnight in each market, starting in New Zealand.",
    'Set in Vice City, Leonida. On PS5 and Xbox Series X|S.',
    'Analysts put pre-orders near 16m copies — over $1.5bn before launch.',
  ];
  let cy = ly + 142;
  for (const para of leadBody) {
    for (const line of wrapText(para, 54)) {
      drawText(cv, line, tx, cy, 2, [52, 58, 72]);
      cy += 19;
    }
    cy += 2;
  }

  // ---- 2x2 grid ------------------------------------------------------------
  const gw = 480;
  const gh = 168;
  const gap = 16;
  const gy0 = 402;
  for (let i = 0; i < GRID_STORIES.length; i++) {
    const gx = MARGIN + (i % 2) * (gw + gap);
    const gy = gy0 + Math.floor(i / 2) * (gh + gap);
    drawGridPanel(cv, gx, gy, gw, gh, GRID_STORIES[i]);
  }

  // ---- Wide panel: Voyager 1 ----------------------------------------------
  const vx = MARGIN;
  const vy = 770;
  const vw = W - 2 * MARGIN;
  const vh = 108;
  cv.fillRect(vx, vy, vw, vh, CARD);
  cv.rect(vx, vy, vw, vh, LINE);
  cv.fillRect(vx, vy, vw, 4, PURPLE);
  iconVoyager(cv, vx + 1, vy + 5, 200, vh - 6);
  cv.fillRect(vx + 201, vy + 5, 1, vh - 10, LINE);
  const vtx = vx + 216;
  drawText(cv, 'SPACE', vtx, vy + 14, 2, PURPLE);
  drawText(cv, 'VOYAGER 1, A LIGHT-DAY AWAY', vtx, vy + 38, 3, INK);
  drawText(
    cv,
    'NASA briefs today on the probe, now 16bn miles from Earth —',
    vtx,
    vy + 70,
    2,
    [52, 58, 72],
  );
  drawText(cv, 'the farthest human-made object. Launched in 1977.', vtx, vy + 88, 2, [52, 58, 72]);

  // ---- Footer: also today + sources ---------------------------------------
  const fy = 894;
  drawText(cv, 'ALSO TODAY', MARGIN, fy, 2, RED);
  drawText(
    cv,
    'GENERAL PANTS COLLAPSES IN AUSTRALIA DAYS BEFORE BLACK FRIDAY',
    MARGIN,
    fy + 22,
    2,
    INK,
  );
  drawText(
    cv,
    'SCIENTISTS MAY HAVE FOUND WHY EARTH IS MISSING A BILLION YEARS OF HISTORY',
    MARGIN,
    fy + 42,
    2,
    INK,
  );
  cv.fillRect(MARGIN, fy + 66, W - 2 * MARGIN, 1, LINE);
  drawText(cv, 'SOURCES: REUTERS, AP, BBC, IMD, NASA — 19 NOV 2026', MARGIN, fy + 78, 2, MUTED);

  return cv;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

function main(): void {
  const cv = buildPage();
  const png = encodePng(W, H, cv.px);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'entry.png');
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
}

main();
