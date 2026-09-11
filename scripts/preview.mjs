// Offline verifier for the particle portrait (no browser needed).
//   npm run face:preview -- <count> <yawDeg> <out.png> [pitchDeg]
//   FACE_SRC=path/to/other.png npm run face:preview -- 12000 35 scripts/preview-turn.png 12
// Writes the render, a "<out>-compare.png" (source vs. particles) and prints:
//   • luminance correlation between render and source (tonal fidelity)
//   • max vertical z-step between adjacent regions (neck/body continuity; must be ≪ depth)
import fs from "node:fs";
import { PNG } from "pngjs";
import { buildConstellation, computeMask, maskBounds, sampleFromPixels } from "./.sampleFace.mjs";

const [, , countArg, yawArg, outArg, pitchArg] = process.argv;
const src = process.env.FACE_SRC ?? "src/assets/profile-cutout.png";
const img = PNG.sync.read(fs.readFileSync(src));

/* ---- two-pass subject crop (mirrors sampleFace) ------------------------- */
function resample(data, sw, sh, sx0, sy0, cw, ch, scale) {
  const w = Math.round(cw * scale), h = Math.round(ch * scale);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = Math.min(sw - 1, Math.floor(sx0 + x / scale)), py = Math.min(sh - 1, Math.floor(sy0 + y / scale));
      const si = (py * sw + px) * 4, di = (y * w + x) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  return { data: out, w, h };
}
const s0 = Math.min(1, 256 / Math.max(img.width, img.height));
const c0 = resample(img.data, img.width, img.height, 0, 0, img.width, img.height, s0);
const b = maskBounds(computeMask(c0.data, c0.w, c0.h).mask, c0.w, c0.h);
const pad = 0.03, bw = (b.maxX - b.minX + 1) / s0, bh = (b.maxY - b.minY + 1) / s0;
const sx = Math.max(0, b.minX / s0 - bw * pad), sy = Math.max(0, b.minY / s0 - bh * pad);
const sw = Math.min(img.width - sx, bw * (1 + 2 * pad)), sh = Math.min(img.height - sy, bh * (1 + 2 * pad));
const s1 = Math.min(2, 560 / Math.max(sw, sh));
const crop = resample(img.data, img.width, img.height, sx, sy, sw, sh, s1);
const { data: small, w, h } = crop;

/* ---- sample ---------------------------------------------------------------- */
const count = Number(countArg ?? 12000);
const yaw = (Number(yawArg ?? 0) * Math.PI) / 180;
const pitch = (Number(pitchArg ?? 0) * Math.PI) / 180;
const s = sampleFromPixels(small, w, h, { count });
const c = buildConstellation(s, { spray: 2400, hero: 34, escape: 240, near: 90 });
console.log(`source ${img.width}x${img.height} → analysis ${w}x${h} | points=${s.count} bg=${s.bgMode} aspect=${s.aspect.toFixed(3)} coverage=${s.coverage.toFixed(3)} bottomCut=${s.debug.bottomCut} z=[${s.debug.zRange.map((v) => v.toFixed(3)).join(", ")}] spray=${c.spray.count} hero=${c.hero.count} escape=${c.escape.count} near=${c.stars.count} nodes=${c.nodes.count} links=${c.lineVertexCount / 2}`);

/* ---- continuity metric: max |Δ mean z| between vertically adjacent cells --- */
{
  const R = 40, Cc = 30, sum = new Float64Array(R * Cc), cnt = new Int32Array(R * Cc);
  for (let i = 0; i < s.count; i++) {
    const x = s.positions[i * 3], y = s.positions[i * 3 + 1], z = s.positions[i * 3 + 2];
    const cx = Math.min(Cc - 1, Math.floor(((x / s.aspect) + 0.5) * Cc)), cy = Math.min(R - 1, Math.floor((0.5 - y) * R));
    if (cx < 0 || cy < 0) continue;
    sum[cy * Cc + cx] += z; cnt[cy * Cc + cx]++;
  }
  let maxStep = 0, at = "";
  for (let r = 0; r < R - 1; r++)
    for (let col = 0; col < Cc; col++) {
      const a = r * Cc + col, bI = (r + 1) * Cc + col;
      if (cnt[a] < 5 || cnt[bI] < 5) continue;
      const d = Math.abs(sum[a] / cnt[a] - sum[bI] / cnt[bI]);
      if (d > maxStep) { maxStep = d; at = `row ${r}→${r + 1}, col ${col}`; }
    }
  console.log(`continuity: max vertical z-step = ${maxStep.toFixed(4)} (depth ${s.depth}) at ${at} → ${maxStep < 0.3 * s.depth ? "CONTINUOUS ✓" : "TEAR ✗"}`);
}

/* ---- rasterise (additive, star sprites, browser-equivalent sizing) --------- */
const W = 900, H = 760, faceH = 620, cx = W / 2, cy = H / 2;
const spacing = faceH * Math.sqrt(s.coverage / count);
const quad = 1.8 * spacing;
const buf = new Float32Array(W * H * 3);
const add = (x, y, r, g, bl, a) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] += r * a; buf[i + 1] += g * a; buf[i + 2] += bl * a;
};
const rot = (x, y, z) => {
  const y1 = y * Math.cos(pitch) - z * Math.sin(pitch), z1 = y * Math.sin(pitch) + z * Math.cos(pitch);
  return [x * Math.cos(yaw) + z1 * Math.sin(yaw), y1];
};
function star(px, py, quadPx, r, g, bl, alpha, bright, halo, coreR = 0.16, spike = 0) {
  const R = quadPx / 2;
  const x0 = Math.floor(px - R), x1 = Math.ceil(px + R), y0 = Math.floor(py - R), y1 = Math.ceil(py + R);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - px) / (2 * R), dy = (y + 0.5 - py) / (2 * R), d2 = dx * dx + dy * dy;
      if (d2 > 0.25) continue;
      const d = Math.sqrt(d2);
      const core = Math.exp((-2 * d2) / (coreR * coreR)), hl = Math.exp((-0.9 * d2) / 0.0484);
      const k = spike > 0 ? 9 / spike : 1e9;
      const spikes = spike > 0 && bright > 0.5 ? 0.6 * (Math.exp(-Math.abs(dx) * k) * Math.exp(-dy * dy * 260) + Math.exp(-Math.abs(dy) * k) * Math.exp(-dx * dx * 260)) : 0;
      const edge = Math.min(1, Math.max(0, (0.5 - d) / 0.08));
      add(x, y, r, g, bl, (core + halo * hl + spikes) * edge * edge * (3 - 2 * edge) * alpha);
    }
}
for (let i = 0; i < c.lineVertexCount; i += 2) {
  const [ax, ay] = rot(c.linePositions[i * 3], c.linePositions[i * 3 + 1], c.linePositions[i * 3 + 2]);
  const [bx, by] = rot(c.linePositions[i * 3 + 3], c.linePositions[i * 3 + 4], c.linePositions[i * 3 + 5]);
  const X0 = cx + ax * faceH, Y0 = cy - ay * faceH, X1 = cx + bx * faceH, Y1 = cy - by * faceH;
  const steps = Math.ceil(Math.hypot(X1 - X0, Y1 - Y0));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    add(Math.round(X0 + (X1 - X0) * t), Math.round(Y0 + (Y1 - Y0) * t), 0.6, 0.8, 1, 0.55 * 0.6 * (c.lineColors[i * 3 + 2] * (1 - t) + c.lineColors[i * 3 + 5] * t));
  }
}
const quadCss = Math.max(2.2, quad);
const coreR = Math.min(0.34, Math.max(0.12, 0.8 / quadCss));
const drawSet = (set, quadPx, alphaMul, halo, cr, spike) => {
  for (let i = 0; i < set.count; i++) {
    const [x, y] = rot(set.positions[i * 3], set.positions[i * 3 + 1], set.positions[i * 3 + 2]);
    star(cx + x * faceH, cy - y * faceH, quadPx * set.sizes[i], set.colors[i * 3], set.colors[i * 3 + 1], set.colors[i * 3 + 2], set.alphas[i] * alphaMul, set.bright[i], halo, cr, spike);
  }
};
drawSet(c.stars, 0.011 * H, 0.9, 0.35, 0.16, 1.2);
drawSet(c.nodes, 0.015 * H, 0.9, 0.5, 0.16, 1.5);
drawSet(c.spray, quadCss * 0.95, 1, 0.35, coreR, 0);
drawSet(c.escape, Math.max(quadCss * 1.1, 4), 0.95, 0.35, Math.max(coreR, 0.16), 0);
drawSet(s, quadCss, 1, 0.3, coreR, 0);
drawSet(c.hero, 0.036 * H, 0.85, 0.9, 0.06, 2.6);

const png = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) {
  png.data[i * 4] = Math.min(255, buf[i * 3] * 255 + 5);
  png.data[i * 4 + 1] = Math.min(255, buf[i * 3 + 1] * 255 + 7);
  png.data[i * 4 + 2] = Math.min(255, buf[i * 3 + 2] * 255 + 13);
  png.data[i * 4 + 3] = 255;
}
const out = outArg ?? "scripts/preview-front.png";
fs.writeFileSync(out, PNG.sync.write(png));
console.log("wrote", out);

/* ---- side-by-side + tonal fidelity ------------------------------------------ */
{
  const side = new PNG({ width: W * 2, height: H });
  for (let i = 3; i < side.data.length; i += 4) side.data[i] = 255;
  const fh = faceH, fw = fh * (w / h), ox = cx - fw / 2, oy = cy - fh / 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = (x - ox) / fw, v = (y - oy) / fh;
      if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
      const si = (Math.floor(v * h) * w + Math.floor(u * w)) * 4, di = (y * W * 2 + x) * 4;
      if (small[si + 3] < 128) continue;
      side.data[di] = small[si]; side.data[di + 1] = small[si + 1]; side.data[di + 2] = small[si + 2];
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4, di = (y * W * 2 + W + x) * 4;
      side.data[di] = png.data[si]; side.data[di + 1] = png.data[si + 1]; side.data[di + 2] = png.data[si + 2];
    }
  fs.writeFileSync(out.replace(".png", "-compare.png"), PNG.sync.write(side));

  const cells = 48, a = [], bb = [];
  for (let gy = 0; gy < cells; gy++)
    for (let gx = 0; gx < cells; gx++) {
      let la = 0, lb = 0, n = 0;
      for (let y = Math.floor(oy + (gy * fh) / cells); y < oy + ((gy + 1) * fh) / cells; y++)
        for (let x = Math.floor(ox + (gx * fw) / cells); x < ox + ((gx + 1) * fw) / cells; x++) {
          const ri = (y * W + x) * 4, li = (y * W * 2 + x) * 4;
          la += (png.data[ri] + png.data[ri + 1] + png.data[ri + 2]) / 3;
          lb += (side.data[li] + side.data[li + 1] + side.data[li + 2]) / 3;
          n++;
        }
      a.push(la / n); bb.push(lb / n);
    }
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length, ma = mean(a), mb = mean(bb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (bb[i] - mb); da += (a[i] - ma) ** 2; db += (bb[i] - mb) ** 2; }
  console.log("tonal fidelity (luminance correlation render vs source):", (num / Math.sqrt(da * db)).toFixed(3));
}

/* ---- density report: particles per 1000 px² in the densest / median / sparsest occupied regions -- */
{
  const G = 24, cnt = new Int32Array(G * G), area = new Int32Array(G * G);
  for (let i = 0; i < s.count; i++) {
    const gx = Math.min(G - 1, Math.max(0, Math.floor(((s.positions[i * 3] / s.aspect) + 0.5) * G)));
    const gy = Math.min(G - 1, Math.max(0, Math.floor((0.5 - s.positions[i * 3 + 1]) * G)));
    cnt[gy * G + gx]++;
  }
  // occupied area per cell from the analysis mask
  const { mask } = computeMask(small, w, h);
  const bb = maskBounds(mask, w, h);
  for (let y = bb.minY; y <= bb.maxY; y++) for (let x = bb.minX; x <= bb.maxX; x++) {
    if (!mask[y * w + x]) continue;
    const gx = Math.min(G - 1, Math.floor(((x - bb.minX) / (bb.maxX - bb.minX + 1)) * G)), gy = Math.min(G - 1, Math.floor(((y - bb.minY) / (bb.maxY - bb.minY + 1)) * G));
    area[gy * G + gx]++;
  }
  const d = [];
  for (let k = 0; k < G * G; k++) if (area[k] > 60) d.push((1000 * cnt[k]) / area[k]);
  d.sort((a, b) => a - b);
  const q = (p) => d[Math.floor(p * (d.length - 1))].toFixed(0);
  console.log(`density (particles / 1000 px²): sparsest ${q(0.05)} · median ${q(0.5)} · densest ${q(0.95)} → dynamic range ${(d[Math.floor(0.95 * (d.length - 1))] / Math.max(1, d[Math.floor(0.05 * (d.length - 1))])).toFixed(1)}×`);
  // ASCII density map (rows sampled)
  const glyph = " ·:-=+*#%@";
  const maxD = d[d.length - 1];
  let art = "";
  for (let gy = 0; gy < G; gy += 2) {
    let row = "";
    for (let gx = 0; gx < G; gx++) {
      const k = gy * G + gx;
      if (area[k] <= 60) { row += " "; continue; }
      const v = (1000 * cnt[k]) / area[k] / maxD;
      row += glyph[Math.min(9, Math.floor(Math.sqrt(v) * 9.99))];
    }
    art += row + "\n";
  }
  console.log(art);
}
