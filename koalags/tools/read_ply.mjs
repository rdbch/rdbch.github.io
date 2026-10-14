// Minimal PLY reader (binary_little_endian or ascii) for vertex-only point clouds.
import { readFileSync } from "node:fs";

const SIZES = { char: 1, uchar: 1, short: 2, ushort: 2, int: 4, uint: 4, float: 4, double: 8,
  int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, float32: 4, float64: 8 };

export function readPly(path) {
  const buf = readFileSync(path);
  const end = buf.indexOf("end_header");
  const headerEnd = buf.indexOf("\n", end) + 1;
  const lines = buf.subarray(0, headerEnd).toString("latin1").split(/\r?\n/);
  const format = lines.find((l) => l.startsWith("format ")).split(" ")[1];
  let count = 0;
  const props = [];
  let inVertex = false;
  for (const l of lines) {
    const t = l.trim().split(/\s+/);
    if (t[0] === "element") { inVertex = t[1] === "vertex"; if (inVertex) count = +t[2]; }
    else if (t[0] === "property" && inVertex) {
      if (t[1] === "list") throw new Error("list properties not supported");
      props.push({ type: t[1], name: t[2] });
    }
  }
  const cols = Object.fromEntries(props.map((p) => [p.name, new Float64Array(count)]));
  if (format === "binary_little_endian") {
    const view = new DataView(buf.buffer, buf.byteOffset + headerEnd);
    let o = 0;
    for (let i = 0; i < count; i++) {
      for (const p of props) {
        let v;
        switch (p.type) {
          case "float": case "float32": v = view.getFloat32(o, true); break;
          case "double": case "float64": v = view.getFloat64(o, true); break;
          case "uchar": case "uint8": v = view.getUint8(o); break;
          case "char": case "int8": v = view.getInt8(o); break;
          case "ushort": case "uint16": v = view.getUint16(o, true); break;
          case "short": case "int16": v = view.getInt16(o, true); break;
          case "uint": case "uint32": v = view.getUint32(o, true); break;
          case "int": case "int32": v = view.getInt32(o, true); break;
          default: throw new Error("unsupported type " + p.type);
        }
        cols[p.name][i] = v;
        o += SIZES[p.type];
      }
    }
  } else if (format === "ascii") {
    const text = buf.subarray(headerEnd).toString("latin1");
    let pos = 0;
    for (let i = 0; i < count; i++) {
      let nl = text.indexOf("\n", pos);
      if (nl < 0) nl = text.length;
      const vals = text.slice(pos, nl).trim().split(/\s+/);
      for (let k = 0; k < props.length; k++) cols[props[k].name][i] = +vals[k];
      pos = nl + 1;
    }
  } else {
    throw new Error("unsupported PLY format " + format);
  }
  return { count, props, cols };
}
