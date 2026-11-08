// What makes Mission Control installable as an app: the manifest and app icons (drawn here as
// PNGs so there are no image files to keep in sync). The service worker is sw.js.

'use strict';
const zlib = require('zlib');

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// A teal tile with a dark four-point sparkle, matching the dashboard's logo colors.
// maskable: full-bleed background so Android can crop it to any shape.
function icon(size, maskable) {
  const bg = [11, 13, 18], teal = [45, 212, 191], dark = [11, 13, 18];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2, tile = maskable ? size : size * 0.84, r = tile * 0.22, half = tile / 2;
  const star = size * (maskable ? 0.26 : 0.3);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - c, py = y + 0.5 - c;
      // rounded square
      const qx = Math.max(Math.abs(px) - (half - r), 0), qy = Math.max(Math.abs(py) - (half - r), 0);
      const inTile = maskable || (Math.abs(px) <= half && Math.abs(py) <= half && qx * qx + qy * qy <= r * r);
      // sparkle: |x|^0.5 + |y|^0.5 <= star^0.5 (an astroid)
      const inStar = Math.sqrt(Math.abs(px) / star) + Math.sqrt(Math.abs(py) / star) <= 1;
      const col = !inTile ? bg : inStar ? dark : teal;
      col.forEach((v, i) => { raw[y * (size * 3 + 1) + 1 + x * 3 + i] = v; });
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const cache = new Map();
const ICONS = { '/icon-192.png': [192, false], '/icon-512.png': [512, false], '/icon-maskable-512.png': [512, true], '/apple-touch-icon.png': [180, true] };
function iconFor(p) {
  if (!ICONS[p]) return null;
  if (!cache.has(p)) cache.set(p, icon(...ICONS[p]));
  return cache.get(p);
}

const manifest = {
  name: 'Mission Control', short_name: 'Mission Control', description: 'Command center for your AI agent team',
  start_url: '/', scope: '/', display: 'standalone', background_color: '#0B0D12', theme_color: '#0B0D12',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

module.exports = { iconFor, manifest };
