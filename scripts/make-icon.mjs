#!/usr/bin/env node
/**
 * Generates images/icon.png — a bell on a rounded square.
 *
 * The icon is built from code rather than committed as an opaque binary so it
 * can be reviewed, tweaked and regenerated. Run `node scripts/make-icon.mjs`
 * after changing anything here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 128;
const SAMPLES = 4; // supersampling factor per axis, for smooth edges

const BACKGROUND = [217, 119, 87]; // warm orange
const FOREGROUND = [255, 255, 255];

/** Signed coverage helpers, all working in a 0..128 coordinate space. */
function insideRoundedSquare(x, y) {
  const radius = 28;
  const min = 4;
  const max = SIZE - 4;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  if (x >= min + radius && x <= max - radius) return y >= min && y <= max;
  if (y >= min + radius && y <= max - radius) return x >= min && x <= max;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function insideCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function insideBell(x, y) {
  const cx = 64;

  // Handle on top of the dome.
  if (insideCircle(x, y, cx, 27, 6.5)) return true;

  // Dome: widens towards the base, with a rounded shoulder.
  if (y >= 32 && y <= 86) {
    const t = (y - 32) / (86 - 32);
    const half = 17 + 20 * t ** 1.35;
    const shoulder = y < 46 ? Math.sqrt(Math.max(0, 1 - ((46 - y) / 14) ** 2)) : 1;
    if (Math.abs(x - cx) <= half * shoulder) return true;
  }

  // Rim.
  if (y > 86 && y <= 95 && Math.abs(x - cx) <= 40) return true;

  // Clapper, kept clear of the rim so the two read as separate shapes.
  if (insideCircle(x, y, cx, 109, 8)) return true;

  return false;
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
const step = 1 / SAMPLES;
const total = SAMPLES * SAMPLES;

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    let bg = 0;
    let fg = 0;
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const x = px + (sx + 0.5) * step;
        const y = py + (sy + 0.5) * step;
        if (insideRoundedSquare(x, y)) {
          bg += 1;
          if (insideBell(x, y)) fg += 1;
        }
      }
    }
    const alpha = bg / total;
    const bellRatio = bg === 0 ? 0 : fg / bg;
    const offset = (py * SIZE + px) * 4;
    for (let c = 0; c < 3; c += 1) {
      pixels[offset + c] = Math.round(
        BACKGROUND[c] * (1 - bellRatio) + FOREGROUND[c] * bellRatio,
      );
    }
    pixels[offset + 3] = Math.round(alpha * 255);
  }
}

// --- Minimal PNG encoder (RGBA, 8-bit, no interlacing) ---

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
// bytes 10..12 stay 0: deflate, adaptive filtering, no interlace

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter type: none
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'images');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'icon.png');
fs.writeFileSync(outFile, png);
console.log(`wrote ${outFile} (${png.length} bytes)`);
