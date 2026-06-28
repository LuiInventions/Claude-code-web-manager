// Generates build/resources/icon.png (256x256) and icon.ico with no external
// image tooling — a dark rounded square with an accent ">_" terminal prompt.
// PNG is hand-encoded (zlib + zlib.crc32, both Node built-ins); the ICO wraps
// the PNG (Vista+ PNG-in-ICO format, valid on modern Windows).
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = path.join(root, "build", "resources");
fs.mkdirSync(outDir, { recursive: true });

const S = 256;
const buf = Buffer.alloc(S * S * 4); // RGBA

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const sa = a / 255;
  buf[i] = Math.round(r * sa + buf[i] * (1 - sa));
  buf[i + 1] = Math.round(g * sa + buf[i + 1] * (1 - sa));
  buf[i + 2] = Math.round(b * sa + buf[i + 2] * (1 - sa));
  buf[i + 3] = Math.max(buf[i + 3], a);
}

const radius = 52;
function inRounded(x, y, pad) {
  const minX = pad, minY = pad, maxX = S - pad, maxY = S - pad;
  if (x < minX || y < minY || x >= maxX || y >= maxY) return false;
  const rx = Math.min(x - minX, maxX - 1 - x);
  const ry = Math.min(y - minY, maxY - 1 - y);
  const r = radius - pad;
  if (rx < r && ry < r) {
    const dx = r - rx, dy = r - ry;
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    if (inRounded(x, y, 8)) {
      const t = y / S;
      const r = Math.round(18 + 6 * (1 - t));
      const g = Math.round(22 + 8 * (1 - t));
      const b = Math.round(30 + 12 * (1 - t));
      set(x, y, r, g, b, 255);
    }
  }
}

const ACCENT = [122, 162, 247]; // #7AA2F7
function stroke(x1, y1, x2, y2, thickness) {
  const half = thickness / 2;
  const minx = Math.floor(Math.min(x1, x2) - half), maxx = Math.ceil(Math.max(x1, x2) + half);
  const miny = Math.floor(Math.min(y1, y2) - half), maxy = Math.ceil(Math.max(y1, y2) + half);
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      let t = ((x - x1) * dx + (y - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + t * dx, py = y1 + t * dy;
      const d = Math.hypot(x - px, y - py);
      const a = d <= half ? 255 : d <= half + 1.5 ? Math.round(255 * (1 - (d - half) / 1.5)) : 0;
      if (a > 0 && inRounded(x, y, 8)) set(x, y, ACCENT[0], ACCENT[1], ACCENT[2], a);
    }
  }
}

const th = 22;
stroke(80, 78, 138, 128, th); // ">" upper
stroke(138, 128, 80, 178, th); // ">" lower
stroke(150, 182, 196, 182, th); // "_" cursor

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
fs.writeFileSync(path.join(outDir, "icon.png"), png);

const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0;
entry[1] = 0;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12);
const ico = Buffer.concat([dir, entry, png]);
fs.writeFileSync(path.join(outDir, "icon.ico"), ico);

console.log("wrote icon.png (" + png.length + "B) and icon.ico (" + ico.length + "B) to " + outDir);
