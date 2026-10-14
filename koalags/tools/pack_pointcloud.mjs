// Pack several CloudCompare PLY exports of the SAME point cloud (same points,
// same order, different colors) into one compact binary for the web viewer.
//
//   node tools/pack_pointcloud.mjs out.bin rgb.ply complexity.ply psnr.ply
//        [--scalar file.ply:field --scalar-range lo:hi] [--preview out_prefix]
//
// Layout (little endian):
//   "KPC1" | uint32 N | uint32 S (color sets) | float32 min[3] | float32 max[3]
//   uint16 xyz[N*3]  (quantized between min and max)
//   uint8 rgb[S][N*3]
// With --scalar (e.g. the per-point complexity) the file is "KPC2": the header adds
// float32 scalarLo, scalarHi, and uint16 scalar[N] (quantized between them) follows xyz.
// Outlier points (beyond the 1st/99th percentile per axis + 10% margin) are dropped.
// Also writes out.bin.js, a script copy used only when the page is opened from disk.
import { writeFileSync } from "node:fs";
import { readPly } from "./read_ply.mjs";

const args = process.argv.slice(2);
const previewAt = args.indexOf("--preview");
const preview = previewAt >= 0 ? args.splice(previewAt, 2)[1] : null;
const scalarAt = args.indexOf("--scalar");
const scalarArg = scalarAt >= 0 ? args.splice(scalarAt, 2)[1] : null;
const rangeAt = args.indexOf("--scalar-range");
const scalarRange = rangeAt >= 0 ? args.splice(rangeAt, 2)[1].split(":").map(Number) : null;
const [out, ...inputs] = args;
if (!out || inputs.length === 0) {
  console.error("usage: node tools/pack_pointcloud.mjs out.bin a.ply [b.ply ...] [--preview prefix]");
  process.exit(1);
}

const clouds = inputs.map((f) => { console.log("reading", f); return readPly(f); });
const N0 = clouds[0].count;
for (const c of clouds) if (c.count !== N0) throw new Error("point counts differ");

const axes = ["x", "y", "z"];
const lo = [], hi = [];
for (const k of axes) {
  const v = Float64Array.from(clouds[0].cols[k]).sort();
  const p1 = v[Math.floor(0.01 * (N0 - 1))], p99 = v[Math.floor(0.99 * (N0 - 1))];
  const m = 0.1 * (p99 - p1);
  lo.push(p1 - m); hi.push(p99 + m);
}
const keep = [];
for (let i = 0; i < N0; i++) {
  let ok = true;
  for (let a = 0; a < 3; a++) {
    const v = clouds[0].cols[axes[a]][i];
    if (v < lo[a] || v > hi[a]) { ok = false; break; }
  }
  if (ok) keep.push(i);
}
const N = keep.length;
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const i of keep) for (let a = 0; a < 3; a++) {
  const v = clouds[0].cols[axes[a]][i];
  if (v < min[a]) min[a] = v;
  if (v > max[a]) max[a] = v;
}
console.log(`kept ${N} / ${N0} points; bounds`, min.map((v) => v.toFixed(2)), max.map((v) => v.toFixed(2)));

let scalar = null, sLo = 0, sHi = 1;
if (scalarArg) {
  const [file, field] = scalarArg.split(":");
  const sc = readPly(file);
  if (sc.count !== N0) throw new Error("scalar file has a different point count");
  if (!sc.cols[field]) throw new Error("no field " + field + " in " + file);
  scalar = sc.cols[field];
  if (scalarRange) [sLo, sHi] = scalarRange;
  else { sLo = Infinity; sHi = -Infinity; for (const i of keep) { sLo = Math.min(sLo, scalar[i]); sHi = Math.max(sHi, scalar[i]); } }
  console.log(`scalar ${field}: stored over [${sLo}, ${sHi}]`);
}

const S = clouds.length;
const headerBytes = scalar ? 44 : 36;
const buf = Buffer.alloc(headerBytes + N * 6 + (scalar ? N * 2 : 0) + S * N * 3);
buf.write(scalar ? "KPC2" : "KPC1", 0, "latin1");
buf.writeUInt32LE(N, 4);
buf.writeUInt32LE(S, 8);
for (let a = 0; a < 3; a++) { buf.writeFloatLE(min[a], 12 + a * 4); buf.writeFloatLE(max[a], 24 + a * 4); }
if (scalar) { buf.writeFloatLE(sLo, 36); buf.writeFloatLE(sHi, 40); }
let o = headerBytes;
for (const i of keep) for (let a = 0; a < 3; a++) {
  const t = (clouds[0].cols[axes[a]][i] - min[a]) / (max[a] - min[a] || 1);
  buf.writeUInt16LE(Math.round(t * 65535), o); o += 2;
}
if (scalar) for (const i of keep) {
  const t = Math.min(1, Math.max(0, (scalar[i] - sLo) / (sHi - sLo || 1)));
  buf.writeUInt16LE(Math.round(t * 65535), o); o += 2;
}
for (const c of clouds) for (const i of keep) {
  buf[o++] = c.cols.red[i]; buf[o++] = c.cols.green[i]; buf[o++] = c.cols.blue[i];
}
writeFileSync(out, buf);
console.log(`wrote ${out} (${(buf.length / 1e6).toFixed(1)} MB)`);

// Script copy for opening index.html straight from disk (file://), where
// browsers block fetch() but still run <script src>. Local use only (gitignored).
const key = out.split("/").pop();
writeFileSync(out + ".js", `(window.KPC = window.KPC || {})[${JSON.stringify(key)}] = "${buf.toString("base64")}";\n`);
console.log(`wrote ${out}.js (for file:// previews)`);

// Optional orthographic previews (PPM) to check orientation: front (x,y) and top (x,z).
if (preview) {
  const W = 600, H = 400;
  for (const [name, u, v] of [["front_xy", 0, 1], ["top_xz", 0, 2]]) {
    const img = Buffer.alloc(W * H * 3, 255);
    const su = (W - 1) / (max[u] - min[u]), sv = (H - 1) / (max[v] - min[v]);
    const s = Math.min(su, sv);
    for (const i of keep) {
      const px = Math.round((clouds[0].cols[axes[u]][i] - min[u]) * s);
      const py = Math.round((clouds[0].cols[axes[v]][i] - min[v]) * s);  // +v goes DOWN in the image
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      const k = (py * W + px) * 3;
      img[k] = clouds[0].cols.red[i]; img[k + 1] = clouds[0].cols.green[i]; img[k + 2] = clouds[0].cols.blue[i];
    }
    writeFileSync(`${preview}_${name}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
  }
}
