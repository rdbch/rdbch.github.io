// Overview figure (index_full.html, #overview): prints the four panels' HTML (inline SVG).
//   node tools/overview_figure.mjs > panels.html   then paste between <div class="ov-panels"> and its </div>.
// Styling lives in index_full.html (.ov-* rules). Toy renders in (c)/(d) are seeded, so output is stable.
const V = [[68, 1, 84], [71, 44, 122], [59, 81, 139], [44, 113, 142], [33, 144, 141], [39, 173, 129], [92, 200, 99], [170, 220, 50], [253, 231, 37]];
const vir = (t) => {
  t = Math.min(1, Math.max(0, t));
  const x = t * (V.length - 1), i = Math.min(V.length - 2, Math.floor(x)), f = x - i;
  const c = V[i].map((a, k) => Math.round(a + (V[i + 1][k] - a) * f));
  return `rgb(${c.join(",")})`;
};
const f1 = (v) => +v.toFixed(1);
const rng = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- toy scene: flat on the left, detailed on the right (as in the method animations)
// Gaussians in unit coords: u in [0,1] across, v in [0,1] down. Simple region u<0.45.
function sceneGaussians() {
  const r = rng(11), gs = [];
  // simple region: large flat Gaussians
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
    const u = 0.05 + i * 0.09 + (r() - 0.5) * 0.04, v = 0.16 + j * 0.34 + (r() - 0.5) * 0.08;
    gs.push({ u, v, a: 0.2 + r() * 0.06, b: 0.11 + r() * 0.03, ang: r() * 60 - 30, col: [118 + r() * 18, 156 + r() * 16, 196 + r() * 14], op: 0.3 + r() * 0.25, simple: true });
  }
  // complex region: many small, varied Gaussians
  for (let k = 0; k < 230; k++) {
    const u = 0.42 + r() * 0.57, v = 0.03 + r() * 0.94;
    const leaf = r();
    const col = leaf < 0.45 ? [60 + r() * 50, 120 + r() * 70, 50 + r() * 30] : leaf < 0.75 ? [200 + r() * 50, 110 + r() * 60, 40 + r() * 30] : [150 + r() * 60, 60 + r() * 30, 60 + r() * 40];
    gs.push({ u, v, a: 0.012 + r() * 0.02, b: 0.02 + r() * 0.03, ang: r() * 180, col, op: 0.55 + r() * 0.45, simple: false });
  }
  gs.forEach((g) => { g.scale = Math.hypot(g.a, g.b); });
  return gs;
}
const GS = sceneGaussians();
const N = GS.length;
// ranking scores
const byOpacity = [...GS].sort((p, q) => q.op - p.op);
const cOf = (g) => (g.simple ? 0.12 : 0.85);
const score = (g) => g.op + 2 * 1.6 * g.scale / Math.exp(2.2 * cOf(g));
const byOurs = [...GS].sort((p, q) => score(q) - score(p));

let clipId = 0;
function render(order, tau, x, y, w, h) {
  const id = "ovc" + clipId++;
  const keep = order.slice(0, Math.max(1, Math.ceil(tau * N)));
  let s = `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/></clipPath>`;
  s += `<g clip-path="url(#${id})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#151a1d"/>`;
  for (const g of keep) {
    const c = g.simple ? "url(#ov-soft)" : `rgb(${g.col.map(Math.round).join(",")})`;
    s += `<ellipse cx="${f1(x + g.u * w)}" cy="${f1(y + g.v * h)}" rx="${f1(g.b * w * (g.simple ? 0.9 : 0.55))}" ry="${f1(g.a * h * 0.9)}" transform="rotate(${f1(g.ang)} ${f1(x + g.u * w)} ${f1(y + g.v * h)})" fill="${c}" fill-opacity="${g.simple ? 1 : f1(Math.min(0.95, 0.4 + g.op * 0.6))}"/>`;
  }
  return s + `</g><rect class="ov-frame" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`;
}

// toy 1D surface for the training panel
const surf = (x, x0, x1, y0) => {
  const u = (x - x0) / (x1 - x0);
  const r = smooth(0.35, 0.75, u);
  return y0 - 4 * Math.sin(u * 5) - r * (5 * Math.sin(u * 40) + 3 * Math.sin(u * 23 + 1));
};
const cx = (u) => Math.min(1, 0.1 + 0.8 * smooth(0.3, 0.75, u));  // complexity along the toy scene
function surfaceBlobs(x0, x1, y0, seed, opts = {}) {
  const r = rng(seed); let s = "";
  let pts = `M${x0} ${f1(surf(x0, x0, x1, y0))}`;
  for (let x = x0; x <= x1; x += 2) pts += ` L${x} ${f1(surf(x, x0, x1, y0))}`;
  for (let x = x0 + 4; x < x1 - 2;) {
    const u = (x - x0) / (x1 - x0), c = cx(u);
    const step = 14 - 10 * c;
    const ang = Math.atan2(surf(x + 1, x0, x1, y0) - surf(x - 1, x0, x1, y0), 2) * 180 / Math.PI;
    const big = 7 - 4.5 * c;
    s += `<ellipse cx="${f1(x)}" cy="${f1(surf(x, x0, x1, y0) + 1)}" rx="${f1(big + r())}" ry="${f1(2.3 + r() * 0.6)}" transform="rotate(${f1(ang + (r() - 0.5) * 30 * c)} ${f1(x)} ${f1(surf(x, x0, x1, y0) + 1)})" fill="${opts.grey ? "#8c949c" : vir(c)}" fill-opacity="${opts.alpha ?? 0.85}"/>`;
    x += step + r() * 2;
  }
  return { path: `<path class="ov-surf" d="${pts}"/>`, blobs: s };
}

// "C_j" / "C^2D" -> tspans shifted with dy (baseline-shift is not supported everywhere)
const M = (str) => str.replace(/([_^])\{?([A-Za-z0-9]+)\}?/g, (m, k, t) => k === "_" ? `<tspan dy="2.6" font-size="7.5">${t}</tspan><tspan dy="-2.6">\u200B</tspan>` : `<tspan dy="-4" font-size="7">${t}</tspan><tspan dy="4">\u200B</tspan>`);

// ---------------- Panel (a): motivation from the pilot study
function panelA() {
  let s = "";
  const iw = 90, ih = 50.6, ys = 16;
  [["01_rgb", "input view", 4], ["01_complexity", "complexity", 105], ["01_psnr", "PSNR (inverted)", 206]].forEach(([f, label, x], i) => {
    s += `<clipPath id="ova${i}"><rect x="${x}" y="${ys}" width="${iw}" height="${f1(ih)}" rx="4"/></clipPath>`;
    s += `<image href="static/images/pilot/${f}.jpg" x="${x}" y="${ys}" width="${iw}" height="${f1(ih)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#ova${i})"/>`;
    s += `<text class="ov-sub" x="${x + iw / 2}" y="${ys - 5}" text-anchor="middle">${label}</text>`;
  });
  s += `<path class="ov-arrow" d="M96 41.5h7" marker-end="url(#ov-head)"/>`;
  s += `<text class="ov-hl" x="200.5" y="46" text-anchor="middle" font-size="14">≈</text>`;
  s += `<text class="ov-sub" x="150" y="80" text-anchor="middle">computed before training</text>`;
  s += `<text class="ov-sub" x="251" y="80" text-anchor="middle">after training</text>`;
  s += `<text x="150" y="98" text-anchor="middle" class="ov-strong">Complexity predicts where 3DGS fails</text>`;
  s += `<line class="ov-rule" x1="4" x2="296" y1="110" y2="110"/>`;

  // Q2 mini box plot: Gaussians per voxel vs complexity (log)
  const px = 22, py = 128, pw = 118, ph = 74;
  s += `<text class="ov-sub" x="${px - 18}" y="${py - 6}">Gaussians / voxel</text>`;
  s += `<path class="ov-axis" d="M${px} ${py}V${py + ph}H${px + pw}"/>`;
  for (let i = 0; i < 6; i++) {
    const x = px + 10 + i * 18, med = py + ph - 14 - i * 9.5, q = 6 + i * 0.6;
    s += `<line class="ov-whisk" x1="${x}" x2="${x}" y1="${f1(med - q - 5)}" y2="${f1(med + q + 5)}"/>`;
    s += `<rect x="${x - 5}" y="${f1(med - q)}" width="10" height="${f1(2 * q)}" rx="1.5" fill="${vir(0.12 + i * 0.16)}"/>`;
    s += `<line x1="${x - 5}" x2="${x + 5}" y1="${f1(med)}" y2="${f1(med)}" stroke="#fff" stroke-width="1.2"/>`;
  }
  s += `<text class="ov-tick" x="${px + pw}" y="${py + ph + 10}" text-anchor="end">complexity →</text>`;
  s += `<text class="ov-sub" x="${px + pw / 2 - 8}" y="${py + ph + 24}" text-anchor="middle"><tspan x="${px + pw / 2 - 8}">exp. more where complex,</tspan><tspan x="${px + pw / 2 - 8}" dy="11">but flat areas over-split</tspan></text>`;

  // Q3 mini: PSNR vs complexity at decreasing budgets (opacity pruning)
  const qx = 172, qy = 128, qw = 118, qh = 74;
  s += `<text class="ov-sub" x="${qx - 18}" y="${qy - 6}">PSNR, opacity pruning</text>`;
  s += `<path class="ov-axis" d="M${qx} ${qy}V${qy + qh}H${qx + qw}"/>`;
  [["100%", 0], ["10%", 1], ["1%", 2], ["0.1%", 3]].forEach(([lab, k]) => {
    const y0 = qy + 10 + k * 16;
    s += `<path d="M${qx + 4} ${y0} C${qx + 40} ${y0 + 1}, ${qx + 80} ${y0 + 4}, ${qx + qw - 22} ${y0 + 8}" fill="none" stroke="${vir(0.85 - k * 0.27)}" stroke-width="1.8" stroke-linecap="round"/>`;
    s += `<text class="ov-tick" x="${qx + qw - 19}" y="${y0 + 11}">${lab}</text>`;
  });
  s += `<text class="ov-tick" x="${qx + qw}" y="${qy + qh + 10}" text-anchor="end">complexity →</text>`;
  s += `<text class="ov-sub" x="${qx + qw / 2 - 8}" y="${qy + qh + 24}" text-anchor="middle"><tspan x="${qx + qw / 2 - 8}">simple regions lose</tspan><tspan x="${qx + qw / 2 - 8}" dy="11">as much as complex ones</tspan></text>`;

  s += `<rect class="ov-callout" x="4" y="252" width="292" height="40" rx="6"/>`;
  s += `<text class="ov-strong ov-teal" x="150" y="268" text-anchor="middle">→ capacity should follow complexity,</text>`;
  s += `<text class="ov-strong ov-teal" x="150" y="283" text-anchor="middle">in training and when cutting the budget</text>`;
  return s;
}

// ---------------- Panel (b): training (steps 1, 2, 4)
function badge(n, x, y) {
  return `<circle class="ov-badge" cx="${x}" cy="${y}" r="7.5"/><text class="ov-badge-t" x="${x}" y="${y + 3.4}" text-anchor="middle">${n}</text>`;
}
function panelB() {
  let s = "";
  // step 1: per-Gaussian complexity
  let y = 0;
  s += badge(1, 11, y + 11) + `<text class="ov-strong" x="23" y="${y + 15}">Per-Gaussian complexity</text>`;
  s += `<defs><linearGradient id="ov-vir" x1="0" x2="1">${[0, 0.25, 0.5, 0.75, 1].map((t) => `<stop offset="${t}" stop-color="${vir(cx(t))}"/>`).join("")}</linearGradient></defs>`;
  const x0 = 150, x1 = 292;
  s += `<rect x="${x0}" y="${y + 26}" width="${x1 - x0}" height="9" rx="2" fill="url(#ov-vir)"/>`;
  s += `<text class="ov-tick" x="${x1}" y="${y + 22}" text-anchor="end">complexity map</text>`;
  const sb1 = surfaceBlobs(x0, x1, y + 70, 3);
  for (const u of [0.15, 0.5, 0.82]) {
    const xx = x0 + u * (x1 - x0);
    s += `<line class="ov-proj" x1="${f1(xx)}" x2="${f1(xx)}" y1="${y + 36}" y2="${f1(surf(xx, x0, x1, y + 70) - 3)}"/>`;
  }
  s += sb1.path + sb1.blobs;
  s += `<text class="ov-math" x="8" y="${y + 44}">${M("C_j ← (1−η) C_j + η C^{2D}(π(μ_j))")}</text>`;
  s += `<text class="ov-sub" x="8" y="${y + 60}"><tspan x="8">running average of the image</tspan><tspan x="8" dy="11">complexity each Gaussian sees</tspan></text>`;

  // step 2: densification
  y = 100;
  s += `<line class="ov-rule" x1="4" x2="296" y1="${y - 4}" y2="${y - 4}"/>`;
  s += badge(2, 11, y + 11) + `<text class="ov-strong" x="23" y="${y + 15}">Complexity-aware densification</text>`;
  const sb2 = surfaceBlobs(x0, x1, y + 70, 5);
  s += sb2.path + sb2.blobs;
  // relocation arcs from the simple to the complex region
  [[0.12, 0.7], [0.24, 0.88]].forEach(([a, b], i) => {
    const xa = x0 + a * (x1 - x0), xb = x0 + b * (x1 - x0);
    const ya = surf(xa, x0, x1, y + 70) - 6, yb = surf(xb, x0, x1, y + 70) - 6;
    s += `<path class="ov-reloc" d="M${f1(xa)} ${f1(ya)} Q${f1((xa + xb) / 2)} ${f1(y + 22 + i * 6)} ${f1(xb)} ${f1(yb)}" marker-end="url(#ov-head-teal)"/>`;
  });
  s += `<text class="ov-tick ov-teal" x="${f1(x0 + 0.47 * (x1 - x0))}" y="${y + 30}" text-anchor="middle">relocate</text>`;
  s += `<text class="ov-math" x="8" y="${y + 44}">${M("p(μ_j) = α_j · exp(C̃_j)")}</text>`;
  s += `<text class="ov-sub" x="8" y="${y + 60}"><tspan x="8">moves capacity to complex</tspan><tspan x="8" dy="11">regions, where errors are</tspan></text>`;

  // step 4: variance objective
  y = 200;
  s += `<line class="ov-rule" x1="4" x2="296" y1="${y - 4}" y2="${y - 4}"/>`;
  s += badge(4, 11, y + 11) + `<text class="ov-strong" x="23" y="${y + 15}">Variance objective</text>`;
  const r = rng(21);
  const grid = (gx, gy, uniform) => {
    let g = "";
    for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) {
      const a = uniform ? 0.32 + r() * 0.08 : (i < 3 ? 0.65 + r() * 0.3 : 0.05 + r() * 0.15);
      g += `<rect x="${gx + i * 8}" y="${gy + j * 8}" width="7.4" height="7.4" rx="1" class="ov-err" fill-opacity="${f1(a * 100) / 100}"/>`;
    }
    return g;
  };
  s += grid(158, y + 26, false) + grid(232, y + 26, true);
  s += `<text class="ov-tick" x="186" y="${y + 80}" text-anchor="middle">uneven Δ</text>`;
  s += `<text class="ov-tick ov-teal" x="260" y="${y + 80}" text-anchor="middle">uniform Δ ✓</text>`;
  s += `<path class="ov-arrow" d="M218 ${y + 46}h10" marker-end="url(#ov-head)"/>`;
  s += `<text class="ov-math" x="8" y="${y + 44}">min Var(Δ), Δ = ℰ(full) − ℰ(τ)</text>`;
  s += `<text class="ov-sub" x="8" y="${y + 60}"><tspan x="8">a smaller budget loses quality</tspan><tspan x="8" dy="11">evenly across the image</tspan></text>`;
  return s;
}

// ---------------- Panel (c): level of detail (step 3)
function panelC() {
  let s = "";
  s += badge(3, 11, 11) + `<text class="ov-strong" x="23" y="15">Complexity-aware importance</text>`;
  s += `<text class="ov-math" x="150" y="34" text-anchor="middle">${M("S(g_j) = α_j + λ · s(g_j) / exp(C_j)")}</text>`;
  // the ordered set
  const sx = 8, sw = 284, sy = 60, n = 48;
  for (let i = 0; i < n; i++) {
    s += `<rect x="${f1(sx + i * sw / n)}" y="${sy}" width="${f1(sw / n - 1)}" height="10" rx="1" class="ov-cell" fill-opacity="${f1(100 * (1 - 0.82 * i / n)) / 100}"/>`;
  }
  s += `<text class="ov-tick" x="${sx}" y="${sy + 21}">most important</text><text class="ov-tick" x="${sx + sw}" y="${sy + 21}" text-anchor="end">least</text>`;
  // prefix brackets
  [[0.06, "1%"], [0.3, "10%"]].forEach(([t, lab]) => {
    const x = sx + t * sw;
    s += `<line class="ov-cut" x1="${f1(x)}" x2="${f1(x)}" y1="${sy - 5}" y2="${sy + 14}"/><text class="ov-tick ov-hl" x="${f1(x)}" y="${sy - 8}" text-anchor="middle">${lab}</text>`;
  });
  s += `<text class="ov-tick ov-hl" x="${sx + sw}" y="${sy - 8}" text-anchor="end">100%</text>`;
  s += `<text class="ov-sub" x="150" y="${sy + 35}" text-anchor="middle">one sorted set: any budget τ renders its first ⌈τN⌉</text>`;
  // renders: opacity ranking vs ours at 100 / 10 / 1 %
  const tw = 90, th = 50.6, xs = [4, 105, 206];
  const taus = [1, 0.1, 0.035];
  ["100%", "10%", "1%"].forEach((lab, i) => { s += `<text class="ov-tick" x="${xs[i] + tw / 2}" y="117" text-anchor="middle">${lab}</text>`; });
  s += `<text class="ov-sub" x="4" y="130">opacity ranking</text>`;
  xs.forEach((x, i) => { s += render(byOpacity, taus[i], x, 134, tw, th); });
  s += `<text class="ov-sub ov-teal ov-b" x="4" y="203">KoalaGS</text>`;
  xs.forEach((x, i) => { s += render(byOurs, taus[i], x, 207, tw, th); });
  s += `<text class="ov-sub" x="150" y="281" text-anchor="middle">large Gaussians keep simple regions covered</text>`;
  return s;
}

// ---------------- Panel (d): progressive streaming
function panelD() {
  let s = "";
  // server: the sorted file as a stack of chunks
  s += `<text class="ov-tick" x="22" y="12" text-anchor="middle">sorted file</text>`;
  for (let i = 0; i < 7; i++) s += `<rect x="8" y="${18 + i * 10}" width="28" height="8" rx="1.5" class="ov-cell" fill-opacity="${f1(100 * (1 - 0.8 * i / 7)) / 100}"/>`;
  // chunks in flight
  s += `<line class="ov-wire" x1="42" x2="200" y1="52" y2="52"/>`;
  [[70, 0.3], [110, 0.55], [150, 0.75], [186, 0.95]].forEach(([x, a]) => { s += `<rect x="${x}" y="47" width="14" height="10" rx="1.5" class="ov-cell" fill-opacity="${a}"/>`; });
  s += `<path class="ov-arrow" d="M190 52h12" marker-end="url(#ov-head)"/>`;
  s += `<text class="ov-sub" x="121" y="38" text-anchor="middle">most important chunks first</text>`;
  // client screen with a partial render
  s += `<rect class="ov-screen" x="206" y="22" width="88" height="56" rx="4"/>`;
  s += render(byOurs, 0.12, 209, 25, 82, 46.1);
  s += `<path class="ov-axis" d="M243 78v6M236 84h22"/>`;
  s += `<text class="ov-sub" x="150" y="100" text-anchor="middle">rendered while it downloads</text>`;
  // time to quality plot (Bonsai, 50 Mbps): curves are schematic, 25 dB crossings from the paper
  const px = 30, py = 118, pw = 258, ph = 124, T = 12, lo = 14, hi = 35;
  const X = (t) => px + t / T * pw, Y = (q) => py + ph - (q - lo) / (hi - lo) * ph;
  s += `<path class="ov-axis" d="M${px} ${py}V${py + ph}H${px + pw}"/>`;
  s += `<text class="ov-tick" x="${px - 4}" y="${f1(Y(25) + 3)}" text-anchor="end">25 dB</text>`;
  s += `<line class="ov-guide" x1="${px}" x2="${px + pw}" y1="${f1(Y(25))}" y2="${f1(Y(25))}"/>`;
  const curve = (t25, cls) => {
    const k = t25 / Math.log(3); let d = "";
    for (let t = 0; t <= T + 1e-9; t += 0.1) d += (d ? " L" : "M") + f1(X(t)) + " " + f1(Y(30 - 15 * Math.exp(-t / k)));
    return `<path class="${cls}" d="${d}"/>`;
  };
  s += curve(9.8, "ov-c-mcmc") + curve(2.0, "ov-c-mgs") + curve(1.5, "ov-c-ours");
  [[1.5, "1.5 s", "ov-teal", -1], [2.0, "2.0 s", "", 1], [9.8, "9.8 s", "", 0]].forEach(([t, lab, cls, side]) => {
    s += `<circle cx="${f1(X(t))}" cy="${f1(Y(25))}" r="2.6" class="${cls ? "ov-dot-ours" : "ov-dot"}"/>`;
    s += `<line class="ov-guide" x1="${f1(X(t))}" x2="${f1(X(t))}" y1="${f1(Y(25))}" y2="${py + ph}"/>`;
    s += `<text class="ov-tick ${cls}" x="${f1(X(t) + side * 3)}" y="${py + ph + 11}" text-anchor="${side < 0 ? "end" : side > 0 ? "start" : "middle"}">${lab}</text>`;
  });
  s += `<text class="ov-tick" x="${px + pw}" y="${py + ph + 24}" text-anchor="end">time →</text>`;
  // legend
  [["KoalaGS", "ov-c-ours", "ov-teal ov-b", 0], ["MGS", "ov-c-mgs", "", 82], ["3DGS-MCMC", "ov-c-mcmc", "", 146]].forEach(([lab, cls, tcls, dx]) => {
    s += `<path class="${cls}" d="M${px + 14 + dx} ${py + 4}h14"/><text class="ov-tick ${tcls}" x="${px + 32 + dx}" y="${py + 7}">${lab}</text>`;
  });
  s += `<text class="ov-sub" x="150" y="${py + ph + 40}" text-anchor="middle">time to 25 dB · Bonsai over a 50 Mbps link</text>`;
  return s;
}

const defs = `<defs><radialGradient id="ov-soft"><stop offset="0" stop-color="#8fb0d6" stop-opacity="0.95"/><stop offset="0.6" stop-color="#7f9fc6" stop-opacity="0.75"/><stop offset="1" stop-color="#7393bb" stop-opacity="0"/></radialGradient><marker id="ov-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" class="ov-headfill"/></marker><marker id="ov-head-teal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1L9 5L0 9z" class="ov-headteal"/></marker></defs>`;
const svg = (body, label, first) => `<svg viewBox="0 0 300 296" role="img" aria-label="${label}">${first ? defs : ""}${body}</svg>`;

const panels = [
  ["a", "Motivation", "pilot study", panelA(), "Pilot study: an input view, its complexity map and its inverted PSNR map line up; Gaussians per voxel grow with complexity but flat areas are over-split; pruning by opacity hurts simple and complex regions alike."],
  ["b", "Training", "steps 1, 2, 4", panelB(), "Training: each Gaussian keeps a running average of the image complexity it projects onto; relocation is biased toward complex regions; a variance objective keeps the error difference between full and reduced budgets uniform."],
  ["c", "Level of detail", "step 3", panelC(), "Level of detail: an importance score combining opacity, scale and complexity sorts the Gaussians once; any budget renders a prefix. At 10% and 1% the opacity ranking leaves the flat region empty while KoalaGS keeps it covered with large Gaussians."],
  ["d", "Application", "progressive streaming", panelD(), "Progressive streaming: the sorted file is sent most important chunks first and rendered while it downloads; KoalaGS reaches 25 dB after 1.5 s against 2.0 s for MGS and 9.8 s for 3DGS-MCMC on Bonsai over 50 Mbps."],
];
let html = "";
panels.forEach(([k, title, sub, body, label], i) => {
  html += `            <div class="ov-panel">
              <div class="ov-head"><span class="ov-tag">(${k})</span> ${title} <span class="ov-headsub">${sub}</span></div>
              ${svg(body, label, i === 0)}
            </div>
`;
});
process.stdout.write(html);
