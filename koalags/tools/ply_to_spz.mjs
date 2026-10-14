// Convert a 3DGS PLY (x, y, z, f_dc_*, f_rest_*, opacity, scale_*, rot_*) into a
// compressed .spz (Niantic format, version 2) for the budget viewer.
// The Gaussian order is kept as is, so a file sorted by importance stays sorted
// and any budget is a prefix of it.
//
//   node tools/ply_to_spz.mjs in.ply out.spz [--sh 0|1|2|3] [--stream out.spzs [--slice 10000]] [--preview out_prefix]
//
// --stream also writes the same Gaussians as a progressive stream: consecutive
// slices of the order, each a standalone .spz of --slice Gaussians, so a viewer
// can draw every slice as soon as its bytes arrive and the scene refines steadily. Layout (little endian):
//   "KSS1" | uint32 C (slices) | C x (uint32 bytes, uint32 count) | C x .spz bytes
//
// Coordinates are written unchanged (no axis conversion), like the PLY.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const shOut = Number(opt("--sh", "1"));
const preview = opt("--preview", null);
const stream = opt("--stream", null);
const sliceSize = Number(opt("--slice", "10000"));
const [input, out] = args;
if (!input || !out) {
  console.error("usage: node tools/ply_to_spz.mjs in.ply out.spz [--sh 0|1|2|3] [--stream out.spzs [--slice 10000]] [--preview prefix]");
  process.exit(1);
}

const buf = readFileSync(input);
const headerEnd = buf.indexOf("\n", buf.indexOf("end_header")) + 1;
const header = buf.subarray(0, headerEnd).toString("latin1");
if (!header.includes("format binary_little_endian")) throw new Error("expected binary_little_endian PLY");
const N = Number(header.match(/element vertex (\d+)/)[1]);
const props = [...header.matchAll(/^property (\w+) (\w+)$/gm)].map((m) => {
  if (m[1] !== "float") throw new Error("expected float properties, got " + m[1] + " " + m[2]);
  return m[2];
});
const P = props.length;
const at = Object.fromEntries(props.map((p, i) => [p, i]));
const restCount = props.filter((p) => p.startsWith("f_rest_")).length;
const shIn = { 0: 0, 9: 1, 24: 2, 45: 3 }[restCount];
if (shIn === undefined) throw new Error("unexpected number of f_rest coefficients: " + restCount);
const shDeg = Math.min(shOut, shIn);
const shDimIn = restCount / 3;                 // coefficients per channel in the PLY
const shDim = [0, 3, 8, 15][shDeg];            // coefficients per channel in the output
const f = new Float32Array(buf.buffer.slice(buf.byteOffset + headerEnd, buf.byteOffset + headerEnd + N * P * 4));
console.log(`${N} Gaussians, SH degree ${shIn} in, ${shDeg} out`);

const FRACTIONAL_BITS = 12;
const COLOR_SCALE = 0.15;
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const quantizeSH = (v, bucket) => {
  const q = Math.round(v * 128) + 128;
  return Math.max(0, Math.min(255, Math.floor((q + bucket / 2) / bucket) * bucket));
};

const fx = 1 << FRACTIONAL_BITS;
const xyz = ["x", "y", "z"].map((k) => at[k]);
const dc = ["f_dc_0", "f_dc_1", "f_dc_2"].map((k) => at[k]);
const sc = ["scale_0", "scale_1", "scale_2"].map((k) => at[k]);
const rot = ["rot_0", "rot_1", "rot_2", "rot_3"].map((k) => at[k]);  // w, x, y, z
const rest0 = at.f_rest_0;
// 24-bit fixed point covers +-2048 units; the rare far background Gaussian
// beyond that is pulled in along its direction from the origin.
const LIMIT = ((1 << 23) - 1) / fx;
let clamped = 0;

// Gzipped .spz holding Gaussians [start, end) of the PLY, in order.
function encode(start, end) {
  const n = end - start;
  const H = 16;
  const data = Buffer.alloc(H + n * (9 + 1 + 3 + 3 + 3 + shDim * 3));
  data.writeUInt32LE(0x5053474e, 0);  // "NGSP"
  data.writeUInt32LE(2, 4);           // version
  data.writeUInt32LE(n, 8);
  data[12] = shDeg;
  data[13] = FRACTIONAL_BITS;
  data[14] = 0;                       // flags
  data[15] = 0;
  const oPos = H, oAlpha = oPos + n * 9, oColor = oAlpha + n, oScale = oColor + n * 3;
  const oRot = oScale + n * 3, oSH = oRot + n * 3;
  for (let i = 0; i < n; i++) {
    const b = (start + i) * P;
    const m = Math.max(Math.abs(f[b + xyz[0]]), Math.abs(f[b + xyz[1]]), Math.abs(f[b + xyz[2]]));
    const shrink = m > LIMIT ? LIMIT / m : 1;
    if (shrink < 1) clamped++;
    for (let a = 0; a < 3; a++) {
      const q = Math.round(f[b + xyz[a]] * shrink * fx) & 0xffffff;
      const o = oPos + i * 9 + a * 3;
      data[o] = q & 0xff; data[o + 1] = (q >> 8) & 0xff; data[o + 2] = (q >> 16) & 0xff;
    }
    data[oAlpha + i] = u8(255 / (1 + Math.exp(-f[b + at.opacity])));
    for (let a = 0; a < 3; a++) {
      data[oColor + i * 3 + a] = u8(f[b + dc[a]] * COLOR_SCALE * 255 + 127.5);
      data[oScale + i * 3 + a] = u8((f[b + sc[a]] + 10) * 16);
    }
    let w = f[b + rot[0]], x = f[b + rot[1]], y = f[b + rot[2]], z = f[b + rot[3]];
    const s = (w < 0 ? -127.5 : 127.5) / (Math.hypot(w, x, y, z) || 1);
    data[oRot + i * 3] = u8(x * s + 127.5);
    data[oRot + i * 3 + 1] = u8(y * s + 127.5);
    data[oRot + i * 3 + 2] = u8(z * s + 127.5);
    // PLY f_rest is channel-major (all red, then green, then blue); SPZ interleaves rgb per coefficient.
    for (let j = 0; j < shDim; j++) for (let c = 0; c < 3; c++) {
      data[oSH + (i * shDim + j) * 3 + c] = quantizeSH(f[b + rest0 + c * shDimIn + j], j < 3 ? 8 : 16);
    }
  }
  return gzipSync(data, { level: 9 });
}

// Script copy for opening index.html straight from disk (file://), where
// browsers block fetch() but still run <script src>. Local use only (gitignored).
function writeWithScriptCopy(path, bytes) {
  writeFileSync(path, bytes);
  const key = path.split("/").pop();
  writeFileSync(path + ".js", `(window.KPC = window.KPC || {})[${JSON.stringify(key)}] = "${bytes.toString("base64")}";\n`);
  console.log(`wrote ${path} (${(bytes.length / 1e6).toFixed(1)} MB) and ${path}.js (for file:// previews)`);
}

writeWithScriptCopy(out, encode(0, N));
if (clamped) console.log(`pulled ${clamped} far Gaussians inside the +-${LIMIT.toFixed(0)} position range`);

if (stream) {
  const slices = [];
  for (let start = 0; start < N; start += sliceSize) {
    const end = Math.min(start + sliceSize, N);
    slices.push({ count: end - start, bytes: encode(start, end) });
  }
  const table = Buffer.alloc(8 + slices.length * 8);
  table.write("KSS1", 0, "latin1");
  table.writeUInt32LE(slices.length, 4);
  slices.forEach((c, k) => { table.writeUInt32LE(c.bytes.length, 8 + k * 8); table.writeUInt32LE(c.count, 12 + k * 8); });
  console.log(`stream: ${slices.length} slices`);
  writeWithScriptCopy(stream, Buffer.concat([table, ...slices.map((c) => c.bytes)]));
}

// Optional orthographic previews (PPM) of the Gaussian centers to check orientation
// and the importance order: front (x,y), top (x,z), and the first 1% only.
if (preview) {
  const lo = [], hi = [];
  for (let a = 0; a < 3; a++) {
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) v[i] = f[i * P + xyz[a]];
    v.sort();
    lo.push(v[Math.floor(0.02 * N)]); hi.push(v[Math.floor(0.98 * N)]);
  }
  const W = 600, Hh = 450;
  for (const [name, u, v, count] of [["front_xy", 0, 1, N], ["top_xz", 0, 2, N], ["front_xy_first1pct", 0, 1, Math.ceil(N / 100)]]) {
    const img = Buffer.alloc(W * Hh * 3, 255);
    const s = Math.min((W - 1) / (hi[u] - lo[u]), (Hh - 1) / (hi[v] - lo[v]));
    for (let i = count - 1; i >= 0; i--) {  // draw the most important last, on top
      const b = i * P;
      const px = Math.round((f[b + xyz[u]] - lo[u]) * s), py = Math.round((f[b + xyz[v]] - lo[v]) * s);  // +v goes DOWN
      if (px < 0 || px >= W || py < 0 || py >= Hh) continue;
      const k = (py * W + px) * 3;
      for (let c = 0; c < 3; c++) img[k + c] = u8((0.5 + 0.2820948 * f[b + dc[c]]) * 255);
    }
    writeFileSync(`${preview}_${name}.ppm`, Buffer.concat([Buffer.from(`P6 ${W} ${Hh} 255\n`), img]));
  }
  console.log(`wrote previews ${preview}_*.ppm`);
}
