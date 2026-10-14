// Pack the per-pixel complexity maps of the pilot-study images (float32 TIFFs, one
// per row of the 2D example grid, in row order) into one compact binary for the
// page's 2D complexity filter.
//
//   node tools/pack_complexity2d.mjs out.bin outdoor.tif indoor.tif [--range lo:hi]
//
// Layout (little endian):
//   "KCX1" | uint32 W | uint32 H | uint32 S (maps) | float32 lo | float32 hi
//   uint16 complexity[S][W*H]  (row major, quantized between lo and hi; 16 bits like the
//   point clouds: 8 bits alias against the 200-bin histogram and draw spikes)
// The range defaults to 0:5, the one the 3D point clouds use, so both sliders agree.
// Also writes out.bin.js, a script copy used only when the page is opened from disk.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const rangeAt = args.indexOf("--range");
const [lo, hi] = rangeAt >= 0 ? args.splice(rangeAt, 2)[1].split(":").map(Number) : [0, 5];
const [out, ...inputs] = args;
if (!out || !inputs.length) { console.error("usage: pack_complexity2d.mjs out.bin a.tif [b.tif ...] [--range lo:hi]"); process.exit(1); }

// Minimal reader for uncompressed, single-strip, one-channel float32 little-endian TIFFs (tifffile's default).
function readTiff(path) {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 2) !== "II") throw new Error(path + ": not a little-endian TIFF");
  const ifd = b.readUInt32LE(4), tags = {};
  for (let i = 0, n = b.readUInt16LE(ifd); i < n; i++) {
    const e = ifd + 2 + i * 12, type = b.readUInt16LE(e + 2);
    tags[b.readUInt16LE(e)] = type === 3 ? b.readUInt16LE(e + 8) : b.readUInt32LE(e + 8);
  }
  const [w, h] = [tags[256], tags[257]];
  if (tags[258] !== 32 || tags[339] !== 3 || (tags[259] || 1) !== 1 || (tags[277] || 1) !== 1)
    throw new Error(path + ": expected an uncompressed one-channel float32 TIFF");
  if (tags[278] !== undefined && tags[278] < h) throw new Error(path + ": multi-strip TIFFs are not supported");
  const at = tags[273];
  return { w, h, data: new Float32Array(b.buffer.slice(b.byteOffset + at, b.byteOffset + at + w * h * 4)) };
}

const maps = inputs.map(readTiff);
const { w, h } = maps[0];
if (maps.some((m) => m.w !== w || m.h !== h)) throw new Error("all maps must have the same size");
const head = Buffer.alloc(24);
head.write("KCX1", 0, "ascii");
head.writeUInt32LE(w, 4); head.writeUInt32LE(h, 8); head.writeUInt32LE(maps.length, 12);
head.writeFloatLE(lo, 16); head.writeFloatLE(hi, 20);
const body = Buffer.alloc(maps.length * w * h * 2);
maps.forEach((m, k) => m.data.forEach((v, i) => {
  body.writeUInt16LE(Math.round(Math.min(1, Math.max(0, ((Number.isFinite(v) ? v : lo) - lo) / (hi - lo))) * 65535), (k * w * h + i) * 2);
}));
const buf = Buffer.concat([head, body]);
writeFileSync(out, buf);
console.log(`${out}: ${maps.length} maps of ${w}x${h}, range ${lo}:${hi}`);
// Same script copy as pack_pointcloud.mjs, for pages opened from disk (fetch is blocked there).
const key = out.split("/").pop();
writeFileSync(out + ".js", `(window.KPC = window.KPC || {})[${JSON.stringify(key)}] = "${buf.toString("base64")}";\n`);
console.log(`wrote ${out}.js (for file:// previews)`);
