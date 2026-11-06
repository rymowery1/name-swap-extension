#!/usr/bin/env node
/*
 * Generates the extension icons as PNGs with no dependencies.
 *
 * Mark: a rounded red square with two white bars — a full-width line above a
 * shorter one, reading as a title that's been edited down. Shapes are drawn at
 * 4x and averaged, so the curves stay smooth even at 16px.
 */
'use strict';
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const SS = 4; // supersample factor

/* Amber ground with dark bars: stays legible on both a light and a dark
   Chrome toolbar, and carries no platform branding. */
const BG = [235, 182, 76]; // #EBB64C
const FG = [21, 19, 14];   // #15130E

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Is (x, y) inside a rounded rectangle? Coordinates in unit space (0..1). */
function inRoundRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function render(size) {
  const big = size * SS;
  const acc = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px * SS + sx + 0.5) / big; // 0..1
          const y = (py * SS + sy + 0.5) / big;

          let color = null;
          if (inRoundRect(x, y, 0.02, 0.02, 0.98, 0.98, 0.22)) {
            color = BG;
            // Two bars: the upper one full width, the lower one shorter.
            if (inRoundRect(x, y, 0.20, 0.32, 0.80, 0.44, 0.06)) color = FG;
            if (inRoundRect(x, y, 0.20, 0.56, 0.58, 0.68, 0.06)) color = FG;
          }

          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 255;
          }
        }
      }

      const n = SS * SS;
      const i = (py * size + px) * 4;
      // Premultiplied average, un-premultiplied back out for straight alpha.
      acc[i] = a === 0 ? 0 : Math.round(r / (a / 255));
      acc[i + 1] = a === 0 ? 0 : Math.round(g / (a / 255));
      acc[i + 2] = a === 0 ? 0 : Math.round(b / (a / 255));
      acc[i + 3] = Math.round(a / n);
    }
  }

  return encodePng(size, size, acc);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log('wrote', path.relative(process.cwd(), file), fs.statSync(file).size + 'B');
}
