/**
 * Image → particle-portrait sampler. Fully image-agnostic: nothing in here knows about
 * faces, necks or bodies. Every quantity is derived from the supplied image.
 *
 *   image → subject crop → mask (alpha channel preferred; light/dark background keyed
 *   as fallback) → Euclidean distance transform → continuous depth (inflation +
 *   shape-from-shading relief) → IMPORTANCE MAP (multi-scale local contrast + feature
 *   gradients + tonal + silhouette band) → density map → error-diffusion stippling →
 *   per-point colour / size / alpha (size follows local density) → silhouette rim &
 *   anchors with outward normals → spray, hero stars, escape, links, nodes.
 *
 * All points share ONE coordinate system: x/y are normalised uniformly by the
 * silhouette height (aspect preserved), z is a single continuous function of the
 * mask + luminance, so the portrait always transforms as one rigid object.
 */

export interface FaceSample {
  count: number;
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  seeds: Float32Array;
  scatter: Float32Array;
  bright: Float32Array;
  /** spaced silhouette / strong-edge points used for constellation links */
  anchors: Float32Array;
  anchorNormals: Float32Array;
  anchorCount: number;
  /** dense silhouette points (xyz), outward normals (xy) and local colours – spray sources */
  rim: Float32Array;
  rimNormals: Float32Array;
  rimColors: Float32Array;
  rimCount: number;
  /** 64×64 occupancy of the silhouette over its bbox (normalised space helper) */
  occupancy: Uint8Array;
  /** silhouette bbox width / height */
  aspect: number;
  /** silhouette area in (height²) units – used to derive on-screen point spacing */
  coverage: number;
  depth: number;
  usedAlpha: boolean;
  bgMode: "alpha" | "light" | "dark";
  debug: {
    maskPixels: number;
    bbox: [number, number, number, number];
    analysisSize: [number, number];
    bottomCut: boolean;
    zRange: [number, number];
  };
}

export interface SampleOptions {
  count: number;
  maxSize?: number;
  /** total depth range in silhouette-height units */
  depth?: number;
  /** unsharp-mask amount applied to luminance for star brightness (0 = source luminance) */
  contrast?: number;
  /** exponent on the importance map: >1 concentrates particles further into detail, <1 flattens */
  focus?: number;
  jitter?: number;
  anchorCount?: number;
  seed?: number;
}

type Pixels = Uint8ClampedArray | Uint8Array;

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // crossOrigin breaks bundled/data URLs on some mobile browsers
    if (/^https?:\/\//i.test(src)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load portrait: ${src}`));
    img.src = src;
  });
}

/* ------------------------------------------------------------------------ */
/* Mask                                                                      */
/* ------------------------------------------------------------------------ */

function median(arr: number[]) {
  const s = [...arr].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
}

/** Fill enclosed holes and keep only the largest blob. */
function cleanMask(mask: Uint8Array, w: number, h: number) {
  const n = w * h;
  const reach = new Uint8Array(n);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!mask[i] && !reach[i]) {
      reach[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }
  for (let i = 0; i < n; i++) if (!reach[i]) mask[i] = 1;

  const label = new Int32Array(n).fill(-1);
  let best = -1, bestSize = 0, cur = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    let size = 0;
    stack.push(s);
    label[s] = cur;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && mask[j] && label[j] < 0) {
          label[j] = cur;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = cur;
    }
    cur++;
  }
  for (let i = 0; i < n; i++) if (mask[i] && label[i] !== best) mask[i] = 0;
}

/**
 * Primary mask = alpha channel (transparent → no particle, visible → particle).
 * Fallback for opaque images: marker-based watershed keyed to the border colour.
 * Brightness is never used as the silhouette mask when alpha is present.
 */
export function computeMask(data: Pixels, w: number, h: number) {
  const n = w * h;
  const lum = new Float32Array(n);
  const soft = new Float32Array(n).fill(1);
  const mask = new Uint8Array(n);
  let usedAlpha = false;
  for (let i = 0; i < n; i += 7) {
    if (data[i * 4 + 3] < 250) {
      usedAlpha = true;
      break;
    }
  }
  for (let i = 0; i < n; i++) lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;

  let bgMode: FaceSample["bgMode"] = "alpha";
  if (usedAlpha) {
    for (let i = 0; i < n; i++) {
      const a = data[i * 4 + 3];
      mask[i] = a > 96 ? 1 : 0;
      soft[i] = a / 255;
    }
  } else {
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    const ring = Math.max(1, Math.round(Math.min(w, h) * 0.02));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
        const i = (y * w + x) * 4;
        rs.push(data[i]);
        gs.push(data[i + 1]);
        bs.push(data[i + 2]);
      }
    }
    const br = median(rs) / 255, bg = median(gs) / 255, bb = median(bs) / 255;
    const bgLum = 0.2126 * br + 0.7152 * bg + 0.0722 * bb;
    const bgChroma = Math.max(br, bg, bb) - Math.min(br, bg, bb);
    bgMode = bgLum > 0.45 ? "light" : "dark";

    const grad = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = (-lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1]) / 4;
        const gy = (-lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1]) / 4;
        grad[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    const label = new Uint8Array(n);
    const B = 256;
    const buckets: number[][] = Array.from({ length: B }, () => []);
    const quant = (g: number) => Math.min(B - 1, Math.floor(g * 900));
    const mark = (i: number, l: number) => {
      if (!label[i]) {
        label[i] = l;
        buckets[quant(grad[i])].push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      mark(x, 1);
      mark((h - 1) * w + x, 1);
    }
    for (let y = 0; y < h; y++) {
      mark(y * w, 1);
      mark(y * w + w - 1, 1);
    }
    const margin = Math.round(Math.min(w, h) * 0.04);
    for (let y = margin; y < h - margin; y++) {
      for (let x = margin; x < w - margin; x++) {
        const i = y * w + x;
        const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
        const chroma = Math.max(r, g, b) - Math.min(r, g, b);
        const fg = bgMode === "light" ? chroma - bgChroma > 0.09 || lum[i] < 0.38 : lum[i] > bgLum + 0.35 || chroma > 0.18;
        if (fg) mark(i, 2);
      }
    }
    for (let bkt = 0; bkt < B; bkt++) {
      const q = buckets[bkt];
      while (q.length) {
        const i = q.pop()!;
        const l = label[i];
        const x = i % w;
        const grow = (j: number) => {
          if (label[j]) return;
          label[j] = l;
          buckets[Math.max(bkt, quant(grad[j]))].push(j);
        };
        if (x > 0) grow(i - 1);
        if (x < w - 1) grow(i + 1);
        if (i >= w) grow(i - w);
        if (i < n - w) grow(i + w);
      }
    }
    for (let i = 0; i < n; i++) mask[i] = label[i] === 2 ? 1 : 0;
    cleanMask(mask, w, h);
  }
  return { mask, lum, soft, usedAlpha, bgMode };
}

export function maskBounds(mask: Uint8Array, w: number, h: number) {
  let minX = w, maxX = -1, minY = h, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY, count };
}

/* ------------------------------------------------------------------------ */
/* Exact Euclidean distance transform (Felzenszwalb & Huttenlocher)          */
/* ------------------------------------------------------------------------ */

const EDT_INF = 1e12;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distance (px) from every pixel to the nearest `source` pixel. */
export function distanceTransform(source: Uint8Array, w: number, h: number): Float32Array {
  const m = Math.max(w, h);
  const f = new Float64Array(m), d = new Float64Array(m), z = new Float64Array(m + 1);
  const v = new Int32Array(m);
  const tmp = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = source[y * w + x] ? 0 : EDT_INF;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) tmp[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = tmp[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

/** Local mean and standard deviation of `v` inside the mask (integral images, O(n)). */
function maskedStats(v: Float32Array, mask: Uint8Array, w: number, h: number, r: number) {
  const W = w + 1;
  const S = new Float64Array(W * (h + 1));
  const Q = new Float64Array(W * (h + 1));
  const C = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rq = 0, rc = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i]) {
        rs += v[i];
        rq += v[i] * v[i];
        rc += 1;
      }
      const o = (y + 1) * W + x + 1, u = y * W + x + 1;
      S[o] = S[u] + rs;
      Q[o] = Q[u] + rq;
      C[o] = C[u] + rc;
    }
  }
  const mean = new Float32Array(w * h);
  const std = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const a = y1 * W + x1, b = y0 * W + x1, c = y1 * W + x0, d = y0 * W + x0;
      const cnt = C[a] - C[b] - C[c] + C[d];
      if (cnt <= 0) {
        mean[i] = v[i];
        continue;
      }
      const m = (S[a] - S[b] - S[c] + S[d]) / cnt;
      const q = (Q[a] - Q[b] - Q[c] + Q[d]) / cnt;
      mean[i] = m;
      std[i] = Math.sqrt(Math.max(0, q - m * m));
    }
  }
  return { mean, std };
}

/** q-th percentile of `v` over mask pixels (1024-bin histogram). */
function percentile(v: Float32Array, mask: Uint8Array, q: number) {
  const n = v.length;
  let max = 0;
  for (let i = 0; i < n; i++) if (mask[i] && v[i] > max) max = v[i];
  if (max <= 1e-9) return 1;
  const bins = new Uint32Array(1024);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    bins[Math.min(1023, Math.floor((v[i] / max) * 1023))]++;
    total++;
  }
  let acc = 0;
  for (let b = 0; b < 1024; b++) {
    acc += bins[b];
    if (acc >= q * total) return Math.max(1e-6, ((b + 1) / 1024) * max);
  }
  return max;
}

/* ------------------------------------------------------------------------ */
/* Sampling                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Two-pass: a coarse pass locates the subject; only the subject crop is rasterised
 * at analysis resolution, so detail is relative to the subject – not the padding.
 * Both passes use uniform scaling (aspect ratio preserved).
 */
export function sampleFace(img: HTMLImageElement, opts: SampleOptions): FaceSample {
  const maxSize = opts.maxSize ?? 560;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");

  const s0 = Math.min(1, 256 / Math.max(iw, ih));
  const w0 = Math.max(2, Math.round(iw * s0)), h0 = Math.max(2, Math.round(ih * s0));
  canvas.width = w0;
  canvas.height = h0;
  ctx.drawImage(img, 0, 0, w0, h0);
  const m0 = computeMask(ctx.getImageData(0, 0, w0, h0).data, w0, h0);
  const b0 = maskBounds(m0.mask, w0, h0);
  if (b0.count < 30) throw new Error("Portrait mask is empty – check the image (needs alpha or a plain background)");

  const pad = 0.03;
  const bw = (b0.maxX - b0.minX + 1) / s0, bh = (b0.maxY - b0.minY + 1) / s0;
  const sx = Math.max(0, b0.minX / s0 - bw * pad), sy = Math.max(0, b0.minY / s0 - bh * pad);
  const sw = Math.min(iw - sx, bw * (1 + 2 * pad)), sh = Math.min(ih - sy, bh * (1 + 2 * pad));

  const s1 = Math.min(2, maxSize / Math.max(sw, sh)); // uniform → aspect preserved
  const w = Math.max(2, Math.round(sw * s1)), h = Math.max(2, Math.round(sh * s1));
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return sampleFromPixels(ctx.getImageData(0, 0, w, h).data, w, h, opts);
}

/** Pure sampler over RGBA pixels (no DOM) – used by sampleFace and the offline preview. */
export function sampleFromPixels(data: Pixels, w: number, h: number, opts: SampleOptions): FaceSample {
  const depth = opts.depth ?? 0.26;
  const jitter = opts.jitter ?? 0.6;
  const wantAnchors = opts.anchorCount ?? 100;
  const rand = mulberry32(opts.seed ?? 1337);
  const n = w * h;

  const { mask, lum, soft, usedAlpha, bgMode } = computeMask(data, w, h);
  const { minX, maxX, minY, maxY, count: maskCount } = maskBounds(mask, w, h);
  if (maskCount < 100) throw new Error("Portrait mask is empty – check the image (needs alpha or a plain background)");
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const cx = minX + bw / 2, cy = minY + bh / 2;
  const norm = bh; // ONE uniform scale for x and y → aspect preserved
  const aspect = bw / bh;
  const coverage = maskCount / (bh * bh);

  // Is the bottom edge an artificial cut (cutout ends at the shoulders/chest)?
  let bottomRun = 0;
  for (let x = minX; x <= maxX; x++) bottomRun += mask[maxY * w + x];
  const bottomCut = bottomRun > 0.3 * bw;

  // ---- distance transform: distance from each subject pixel to the silhouette edge.
  // Below an artificial bottom cut the image is treated as continuing (no edge there).
  const src = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const cut = bottomCut && y > maxY;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      src[i] = !mask[i] && !cut ? 1 : 0;
    }
  }
  const dt = distanceTransform(src, w, h);
  let dtMax = 1;
  for (let i = 0; i < n; i++) if (mask[i] && dt[i] > dtMax) dtMax = dt[i];

  // ---- local statistics (integral images): fine & medium texture, low-frequency shading
  const rFine = Math.max(1, Math.round(bh * 0.006));
  const rMed = Math.max(3, Math.round(bh * 0.016));
  const rLow = Math.max(6, Math.round(bh * 0.03));
  const fine = maskedStats(lum, mask, w, h, rFine);
  const med = maskedStats(lum, mask, w, h, rMed);
  const low = maskedStats(lum, mask, w, h, rLow);
  const relief = low.mean;

  // ---- structure: gradient of the lightly smoothed luminance (eyes, nostrils, lips, hairline, beard edge …)
  const grad = new Float32Array(n);
  const sm = fine.mean;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const gx = -sm[i - w - 1] - 2 * sm[i - 1] - sm[i + w - 1] + sm[i - w + 1] + 2 * sm[i + 1] + sm[i + w + 1];
      const gy = -sm[i - w - 1] - 2 * sm[i - w] - sm[i - w + 1] + sm[i + w - 1] + 2 * sm[i + w] + sm[i + w + 1];
      grad[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  // interior only: the silhouette edge is handled by its own term below
  for (let i = 0; i < n; i++) if (mask[i] && dt[i] < 1.5) grad[i] *= 0.2;

  // ---- robust normalisation (94th percentile inside the mask → 1.0)
  const nFine = percentile(fine.std, mask, 0.94);
  const nMed = percentile(med.std, mask, 0.94);
  const nGrad = percentile(grad, mask, 0.94);

  // ---- local-contrast-enhanced luminance (unsharp mask against the low-frequency mean)
  const contrast = opts.contrast ?? 0.6;
  const lumC = new Float32Array(n);
  for (let i = 0; i < n; i++) if (mask[i]) lumC[i] = clamp01(lum[i] + contrast * (lum[i] - relief[i]));

  // ---- importance map: where the photograph carries information
  //   detail    = multi-scale local contrast  (beard / hair texture, skin pores, fabric)
  //   structure = gradient magnitude          (feature edges)
  //   tonal     = brightness                  (light skin reads as a surface)
  //   rim       = silhouette band             (clean jaw / neck / shoulder boundary)
  const edge = new Float32Array(n); // normalised structure, reused for anchors & sizing
  const imp = new Float32Array(n);
  const rimPx = Math.max(1.5, bh * 0.004);
  const focus = opts.focus ?? 1;
  let impSum = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const detail = clamp01((0.6 * fine.std[i]) / nFine + (0.4 * med.std[i]) / nMed);
    const structure = clamp01(grad[i] / nGrad);
    edge[i] = structure;
    const Lc = lumC[i];
    let v = 0.04 * (0.3 + 0.7 * Lc) + 0.5 * Math.pow(detail, 0.9) + 0.4 * Math.pow(structure, 0.9) + 0.16 * Lc * Lc;
    if (dt[i] < rimPx) v += 0.3 * (1 - dt[i] / rimPx) + 0.12;
    v = Math.pow(v, focus);
    imp[i] = v;
    impSum += v;
  }

  // ---- density map: expected particles per pixel, capped and re-normalised so Σ ≈ budget
  const total = Math.max(200, opts.count);
  const dens = new Float32Array(n);
  let scale = total / impSum;
  for (let iter = 0; iter < 3; iter++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      const v = Math.min(0.92, imp[i] * scale);
      dens[i] = v;
      sum += v;
    }
    scale *= total / Math.max(1e-6, sum);
  }

  // ---- stippling by serpentine error diffusion (Floyd–Steinberg) with a randomised threshold:
  //      evenly spaced particles whose density follows the map – no clumps, no empty holes
  const chosen: number[] = [];
  const err = new Float32Array(n);
  for (let i = 0; i < n; i++) if (mask[i]) err[i] = dens[i];
  for (let y = minY; y <= maxY; y++) {
    const ltr = ((y - minY) & 1) === 0;
    const x0 = ltr ? minX : maxX, x1 = ltr ? maxX + 1 : minX - 1, step = ltr ? 1 : -1;
    for (let x = x0; x !== x1; x += step) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const v = err[i];
      const on = v >= 0.5 + (rand() - 0.5) * 0.3 ? 1 : 0;
      if (on) chosen.push(i);
      const e = v - on;
      const ahead = i + step, below = i + w;
      if (x + step >= minX && x + step <= maxX && mask[ahead]) err[ahead] += e * 0.4375;
      if (y < maxY) {
        if (mask[below]) err[below] += e * 0.3125;
        const bl = below - step, br = below + step;
        if (x - step >= minX && x - step <= maxX && mask[bl]) err[bl] += e * 0.1875;
        if (x + step >= minX && x + step <= maxX && mask[br]) err[br] += e * 0.0625;
      }
    }
  }

  // ---- attributes
  const count = chosen.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const seeds = new Float32Array(count);
  const scatter = new Float32Array(count * 3);
  const bright = new Float32Array(count);
  const fadeBand = 0.14 * bh;
  const densMean = total / maskCount;
  const rimLightPx = bh * 0.012;
  let zMin = Infinity, zMax = -Infinity;

  // split-tone palette: cool shadows → warm highlights (applied on top of the source hue)
  const COOL = [0.45, 0.65, 1.0], WARM = [1.0, 0.86, 0.62];

  for (let p = 0; p < count; p++) {
    const i = chosen[p];
    const x = i % w, y = (i - x) / w;
    const px = x + 0.5 + (rand() - 0.5) * jitter;
    const py = y + 0.5 + (rand() - 0.5) * jitter;
    const nx = (px - cx) / norm;
    const ny = -(py - cy) / norm;

    // continuous depth: rounded inflation of the silhouette + shading relief + micro detail
    const t = Math.min(1, dt[i] / dtMax);
    const inflate = 0.55 * Math.sqrt(1 - (1 - t) * (1 - t)) + 0.45 * t;
    const L = lum[i];
    const zn = 0.6 * inflate + 0.3 * relief[i] + 0.1 * L;
    const z = depth * (zn - 0.5) + (rand() - 0.5) * depth * 0.03;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
    positions[p * 3] = nx;
    positions[p * 3 + 1] = ny;
    positions[p * 3 + 2] = z;

    // star colour: source hue (normalised) blended with the split tone; brightness from contrast-enhanced luminance
    const Lc = lumC[i];
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    const Ls = 0.1 + 0.9 * Math.pow(Lc, 0.8);
    const inv = 1 / Math.max(L, 0.02);
    const hr = Math.min(2, r * inv), hg = Math.min(2, g * inv), hb = Math.min(2, b * inv);
    const tw = sstep(0.3, 0.92, Lc);
    const tr = COOL[0] + (WARM[0] - COOL[0]) * tw, tg = COOL[1] + (WARM[1] - COOL[1]) * tw, tb = COOL[2] + (WARM[2] - COOL[2]) * tw;
    const isBright = rand() < 0.018 && Lc > 0.45;
    const rimLight = dt[i] < rimLightPx ? 1 + 0.22 * (1 - dt[i] / rimLightPx) : 1;
    // additive light sums up: dense clusters of dark-texture stars (beard, hair) would glow –
    // compensate per star so the *integrated* brightness still follows the photo
    const packing = Math.min(1, Math.pow(densMean / Math.max(0.02, dens[i]), 0.5) + 0.45 * Lc);
    const gain = 0.92 * Ls * rimLight * packing * (isBright ? 1.35 : 1);
    const mixT = 0.42;
    colors[p * 3] = Math.min(1.25, (hr * (1 - mixT) + tr * mixT) * gain);
    colors[p * 3 + 1] = Math.min(1.25, (hg * (1 - mixT) + tg * mixT) * gain);
    colors[p * 3 + 2] = Math.min(1.25, (hb * (1 - mixT) + tb * mixT) * gain);

    // size follows local density: fine stars where detail is dense, medium stars on flat skin
    const E = edge[i];
    const sizeD = Math.min(1.6, Math.max(0.6, Math.pow(densMean / Math.max(0.02, dens[i]), 0.35)));
    let fade = 1;
    if (bottomCut) fade = 0.3 + 0.7 * sstep(0, 1, (maxY - py) / fadeBand);
    sizes[p] = sizeD * (0.72 + 0.35 * Ls + 0.15 * E) * (0.8 + 0.4 * rand()) * (isBright ? 1.7 : 1) * (0.85 + 0.15 * fade);
    alphas[p] = clamp01(0.3 + 0.7 * Math.pow(Ls, 1.1) + 0.1 * E) * soft[i] * fade;
    seeds[p] = rand();
    bright[p] = isBright ? 1 : 0;

    const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), m = 0.5 + rand();
    scatter[p * 3] = Math.sin(ph) * Math.cos(th) * m;
    scatter[p * 3 + 1] = Math.sin(ph) * Math.sin(th) * m;
    scatter[p * 3 + 2] = Math.cos(ph) * m;
  }

  // ---- coarse occupancy grid (normalised bbox space) so constellation lines can avoid the face
  const OCC = 64;
  const occupancy = new Uint8Array(OCC * OCC);
  for (let gy = 0; gy < OCC; gy++) {
    for (let gx = 0; gx < OCC; gx++) {
      const x = minX + Math.floor(((gx + 0.5) / OCC) * bw), y = minY + Math.floor(((gy + 0.5) / OCC) * bh);
      occupancy[gy * OCC + gx] = mask[y * w + x];
    }
  }

  // ---- outward normals from the distance transform (image y flipped to world y)
  let mcx = 0, mcy = 0;
  for (let p = 0; p < count; p++) {
    mcx += positions[p * 3];
    mcy += positions[p * 3 + 1];
  }
  mcx /= count;
  mcy /= count;
  const rimBand = Math.max(1.5, 0.45 * Math.sqrt(maskCount / total));
  const normalAt = (p: number): [number, number] => {
    const i = chosen[p];
    const x = i % w, y = (i - x) / w;
    if (bottomCut && maxY - y <= rimBand + 1) {
      // artificial bottom edge: fan downward, slightly outward
      const ox = ((x - cx) / bw) * 0.6, oy = -1;
      const len = Math.hypot(ox, oy);
      return [ox / len, oy / len];
    }
    const xm = Math.max(0, x - 2), xp = Math.min(w - 1, x + 2), ym = Math.max(0, y - 2), yp = Math.min(h - 1, y + 2);
    let ox = -(dt[y * w + xp] - dt[y * w + xm]);
    let oy = dt[yp * w + x] - dt[ym * w + x];
    let len = Math.hypot(ox, oy);
    if (len < 1e-3) {
      ox = positions[p * 3] - mcx;
      oy = positions[p * 3 + 1] - mcy;
      len = Math.hypot(ox, oy) || 1;
    }
    return [ox / len, oy / len];
  };

  // ---- rim: dense silhouette points (spray sources)
  const rimIdx: number[] = [];
  for (let p = 0; p < count; p++) {
    const i = chosen[p];
    const y = (i - (i % w)) / w;
    if (dt[i] <= rimBand || (bottomCut && maxY - y <= rimBand)) rimIdx.push(p);
  }
  const rim = new Float32Array(rimIdx.length * 3);
  const rimNormals = new Float32Array(rimIdx.length * 2);
  const rimColors = new Float32Array(rimIdx.length * 3);
  rimIdx.forEach((p, k) => {
    rim[k * 3] = positions[p * 3];
    rim[k * 3 + 1] = positions[p * 3 + 1];
    rim[k * 3 + 2] = positions[p * 3 + 2];
    const [ox, oy] = normalAt(p);
    rimNormals[k * 2] = ox;
    rimNormals[k * 2 + 1] = oy;
    rimColors[k * 3] = colors[p * 3];
    rimColors[k * 3 + 1] = colors[p * 3 + 1];
    rimColors[k * 3 + 2] = colors[p * 3 + 2];
  });

  // ---- anchors: spaced silhouette + strong-edge points (constellation link nodes)
  const ac: number[] = [...rimIdx];
  for (let p = 0; p < count; p++) if (edge[chosen[p]] > 0.5 && dt[chosen[p]] > rimBand) ac.push(p);
  for (let k = ac.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [ac[k], ac[j]] = [ac[j], ac[k]];
  }
  const anchorIdx: number[] = [];
  const tryPick = (minDist: number) => {
    const md2 = minDist * minDist;
    for (const p of ac) {
      if (anchorIdx.length >= wantAnchors) break;
      if (anchorIdx.includes(p)) continue;
      const ax = positions[p * 3], ay = positions[p * 3 + 1];
      let ok = true;
      for (const q of anchorIdx) {
        const dx = positions[q * 3] - ax, dy = positions[q * 3 + 1] - ay;
        if (dx * dx + dy * dy < md2) {
          ok = false;
          break;
        }
      }
      if (ok) anchorIdx.push(p);
    }
  };
  tryPick(0.07);
  if (anchorIdx.length < wantAnchors) tryPick(0.045);
  const anchors = new Float32Array(anchorIdx.length * 3);
  const anchorNormals = new Float32Array(anchorIdx.length * 2);
  anchorIdx.forEach((p, k) => {
    anchors[k * 3] = positions[p * 3];
    anchors[k * 3 + 1] = positions[p * 3 + 1];
    anchors[k * 3 + 2] = positions[p * 3 + 2];
    const [ox, oy] = normalAt(p);
    anchorNormals[k * 2] = ox;
    anchorNormals[k * 2 + 1] = oy;
  });

  return {
    count, positions, colors, sizes, alphas, seeds, scatter, bright,
    anchors, anchorNormals, anchorCount: anchorIdx.length,
    rim, rimNormals, rimColors, rimCount: rimIdx.length,
    occupancy, aspect, coverage, depth, usedAlpha, bgMode,
    debug: { maskPixels: maskCount, bbox: [minX, minY, maxX, maxY], analysisSize: [w, h], bottomCut, zRange: [zMin, zMax] },
  };
}

/* ------------------------------------------------------------------------ */
/* Constellation: spray + hero stars + escape + near stars + links + nodes   */
/* ------------------------------------------------------------------------ */

export interface PointSet {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  seeds: Float32Array;
  scatter: Float32Array;
  bright: Float32Array;
  count: number;
}

export interface ConstellationCounts {
  /** dense fine particles dissolving off the silhouette */
  spray: number;
  /** large flared stars (warm gold / blue-white) around the portrait */
  hero: number;
  /** particles that leave the silhouette and return */
  escape: number;
  /** small twinkling stars around the portrait */
  near: number;
}

export interface Constellation {
  spray: PointSet;
  hero: PointSet;
  escape: PointSet;
  stars: PointSet;
  nodes: PointSet;
  linePositions: Float32Array;
  lineColors: Float32Array;
  linePhases: Float32Array;
  lineVertexCount: number;
}

const WARM_STAR: [number, number, number] = [1.0, 0.8, 0.5];
const COOL_STAR: [number, number, number] = [0.76, 0.87, 1.0];

export function buildConstellation(sample: FaceSample, counts: ConstellationCounts, seed = 42): Constellation {
  const rand = mulberry32(seed);
  const A = sample.anchors, AN = sample.anchorNormals, AC = sample.anchorCount;
  const R = sample.rim, RN = sample.rimNormals, RC_ = sample.rimColors, RC = sample.rimCount;
  if (!AC || !RC) throw new Error("No silhouette points found");
  const expo = (mean: number) => -mean * Math.log(1 - rand() * 0.995);
  const OCC = 64, occ = sample.occupancy, asp = sample.aspect;
  /** is a normalised-space point inside the silhouette? */
  const inside = (x: number, y: number) => {
    const gx = Math.floor((x / asp + 0.5) * OCC), gy = Math.floor((0.5 - y) * OCC);
    return gx >= 0 && gy >= 0 && gx < OCC && gy < OCC && occ[gy * OCC + gx] === 1;
  };
  /** does the segment cross the silhouette interior? (sampled) */
  const crossesFace = (ax: number, ay: number, bx: number, by: number) => {
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      if (inside(ax + (bx - ax) * t, ay + (by - ay) * t)) return true;
    }
    return false;
  };

  // --- spray: many tiny particles leaving the silhouette; density decays with distance
  const sp: number[] = [], spC: number[] = [], spS: number[] = [], spA: number[] = [], spSeed: number[] = [], spSc: number[] = [], spB: number[] = [];
  const spDist: number[] = [];
  for (let k = 0; k < counts.spray; k++) {
    const r = Math.floor(rand() * RC);
    const nx = RN[r * 2], ny = RN[r * 2 + 1];
    const d = Math.min(0.8, 0.01 + expo(0.12));
    const tg = (rand() - 0.5) * 0.5 * d;
    sp.push(R[r * 3] + nx * d - ny * tg, R[r * 3 + 1] + ny * d + nx * tg, R[r * 3 + 2] + (rand() - 0.5) * (0.1 + 0.4 * d));
    spDist.push(d);
    const warm = rand() < 0.22;
    const tone = warm ? WARM_STAR : COOL_STAR;
    const m = 0.45 + 0.4 * Math.min(1, d / 0.4); // inherit local colour near the body, drift to the tone further out
    spC.push(RC_[r * 3] * (1 - m) + tone[0] * m, RC_[r * 3 + 1] * (1 - m) + tone[1] * m, RC_[r * 3 + 2] * (1 - m) + tone[2] * m);
    spS.push((0.35 + 0.6 * rand()) * (1 - 0.35 * Math.min(1, d / 0.6)));
    spA.push((0.25 + 0.75 * Math.exp(-d / 0.3)) * (0.5 + 0.5 * rand()));
    spSeed.push(rand());
    spB.push(0);
    spSc.push(nx * (0.3 + 0.7 * rand()), ny * (0.3 + 0.7 * rand()), (rand() - 0.5) * 0.6);
  }

  // --- hero stars: large flared stars, mostly outside the silhouette, a few on its edge
  const he: number[] = [], heC: number[] = [], heS: number[] = [], heA: number[] = [], heSeed: number[] = [], heSc: number[] = [];
  for (let k = 0; k < counts.hero; k++) {
    const r = Math.floor(rand() * RC);
    const nx = RN[r * 2], ny = RN[r * 2 + 1];
    const onEdge = rand() < 0.15;
    const d = onEdge ? rand() * 0.02 : 0.16 + Math.pow(rand(), 1.1) * 0.7;
    const tg = (rand() - 0.5) * 0.7 * d;
    const hx = R[r * 3] + nx * d - ny * tg, hy = R[r * 3 + 1] + ny * d + nx * tg;
    if (!onEdge && inside(hx, hy)) {
      k--;
      continue;
    }
    he.push(hx, hy, R[r * 3 + 2] + (rand() - 0.5) * 0.35);
    const warm = rand() < 0.5;
    const tone = warm ? WARM_STAR : COOL_STAR;
    heC.push(tone[0] * 1.1, tone[1] * 1.1, tone[2] * 1.1);
    heS.push(0.7 + rand() * 1.3);
    heA.push(0.7 + 0.3 * rand());
    heSeed.push(rand());
    heSc.push(nx * (0.4 + rand()), ny * (0.4 + rand()), (rand() - 0.5));
  }

  // --- escape particles: rest just outside the silhouette, travel outward along the normal and return
  const esc: number[] = [], escC: number[] = [], escS: number[] = [], escA: number[] = [], escSeed: number[] = [], escSc: number[] = [];
  const escDist: number[] = [];
  for (let k = 0; k < counts.escape; k++) {
    const r = Math.floor(rand() * RC);
    const nx = RN[r * 2], ny = RN[r * 2 + 1];
    const d = 0.015 + Math.pow(rand(), 1.6) * 0.14;
    const travel = 0.12 + Math.pow(rand(), 1.3) * 0.45;
    const sw = (rand() - 0.5) * 0.25 * d;
    esc.push(R[r * 3] + nx * d - ny * sw, R[r * 3 + 1] + ny * d + nx * sw, R[r * 3 + 2] + (rand() - 0.5) * 0.2);
    escDist.push(d);
    const mix = clamp01(travel / 0.5);
    escC.push(RC_[r * 3] * (1 - mix) + 0.72 * mix, RC_[r * 3 + 1] * (1 - mix) + 0.86 * mix, RC_[r * 3 + 2] * (1 - mix) + 1 * mix);
    escS.push(0.5 + rand() * 0.9);
    escA.push(0.45 + 0.5 * rand());
    escSeed.push(rand());
    const swirlT = (rand() - 0.5) * 0.5;
    escSc.push((nx - ny * swirlT) * travel, (ny + nx * swirlT) * travel, (rand() - 0.5) * 0.5 * travel);
  }

  // --- near stars: small twinkles in a shell following the silhouette, denser above
  const st: number[] = [], stS: number[] = [], stA: number[] = [], stSeed: number[] = [], stSc: number[] = [], stB: number[] = [];
  const stDist: number[] = [];
  let guard = 0;
  while (st.length / 3 < counts.near && guard++ < counts.near * 6) {
    const a = Math.floor(rand() * AC);
    const nx = AN[a * 2], ny = AN[a * 2 + 1];
    if (rand() > (ny > 0.15 ? 0.9 : 0.5)) continue;
    const d = 0.1 + Math.pow(rand(), 1.4) * 0.55;
    const tg = (rand() - 0.5) * 0.5 * d;
    st.push(A[a * 3] + nx * d - ny * tg, A[a * 3 + 1] + ny * d + nx * tg, (rand() - 0.5) * 0.7);
    stDist.push(d);
    const isBright = rand() < 0.12;
    stS.push((0.6 + rand() * 1.0) * (isBright ? 1.5 : 1));
    stA.push(0.35 + rand() * 0.55);
    stSeed.push(rand());
    stB.push(isBright ? 1 : 0);
    stSc.push((rand() - 0.5) * 2, (rand() - 0.5) * 2, 0.5 + rand() * 2);
  }
  const starCount = st.length / 3;

  // --- proximity links (spatial hash) over anchors + escape + near stars
  const nodes: number[] = [], kind: number[] = [], ndist: number[] = [];
  for (let k = 0; k < AC; k++) {
    nodes.push(A[k * 3], A[k * 3 + 1], A[k * 3 + 2]);
    kind.push(0);
    ndist.push(0);
  }
  for (let k = 0; k < counts.escape; k++) {
    nodes.push(esc[k * 3], esc[k * 3 + 1], esc[k * 3 + 2]);
    kind.push(1);
    ndist.push(escDist[k]);
  }
  for (let k = 0; k < starCount; k++) {
    nodes.push(st[k * 3], st[k * 3 + 1], st[k * 3 + 2]);
    kind.push(2);
    ndist.push(stDist[k]);
  }
  const NN = kind.length;
  const cellSize = 0.22;
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number, z: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)},${Math.floor(z / cellSize)}`;
  for (let i = 0; i < NN; i++) {
    const k = keyOf(nodes[i * 3], nodes[i * 3 + 1], nodes[i * 3 + 2]);
    const arr = grid.get(k);
    if (arr) arr.push(i);
    else grid.set(k, [i]);
  }
  const lp: number[] = [], lc: number[] = [], lph: number[] = [];
  const nodePos: number[] = [], nodeS: number[] = [], nodeA: number[] = [], nodeSeed: number[] = [];
  const nodeSeen = new Set<number>();
  const linked = new Set<number>();
  const pushLine = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, ia: number, ib: number) => {
    lp.push(ax, ay, az, bx, by, bz);
    lc.push(0.6 * ia, 0.8 * ia, 1.0 * ia, 0.6 * ib, 0.8 * ib, 1.0 * ib);
    const ph = rand();
    lph.push(ph, ph);
  };
  const maxLinks = Math.round((counts.escape + counts.near) * 1.4);
  let links = 0;
  for (let i = 0; i < NN && links < maxLinks; i++) {
    const x = nodes[i * 3], y = nodes[i * 3 + 1], z = nodes[i * 3 + 2];
    const radius = kind[i] === 0 ? 0.11 : 0.1 + 0.16 * clamp01(ndist[i] / 0.5);
    const maxPer = kind[i] === 2 ? 1 : 2;
    const cxg = Math.floor(x / cellSize), cyg = Math.floor(y / cellSize), czg = Math.floor(z / cellSize);
    const found: [number, number][] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get(`${cxg + dx},${cyg + dy},${czg + dz}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j <= i) continue;
            if (kind[i] === 0 && kind[j] === 0) continue;
            const ddx = nodes[j * 3] - x, ddy = nodes[j * 3 + 1] - y, ddz = nodes[j * 3 + 2] - z;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < radius * radius) found.push([d2, j]);
          }
        }
    found.sort((a, b) => a[0] - b[0]);
    for (let f = 0; f < Math.min(maxPer, found.length); f++) {
      const [d2, j] = found[f];
      const key = i * NN + j;
      if (linked.has(key) || rand() > 0.8) continue;
      if (crossesFace(x, y, nodes[j * 3], nodes[j * 3 + 1])) continue;
      linked.add(key);
      const fade = 1 - Math.sqrt(d2) / radius;
      pushLine(x, y, z, nodes[j * 3], nodes[j * 3 + 1], nodes[j * 3 + 2], 0.35 + 0.5 * fade, 0.3 + 0.4 * fade);
      if (kind[j] !== 0 && !nodeSeen.has(j) && rand() < 0.35) {
        nodeSeen.add(j);
        nodePos.push(nodes[j * 3], nodes[j * 3 + 1], nodes[j * 3 + 2]);
        nodeS.push(1.1 + rand() * 0.9);
        nodeA.push(0.55 + rand() * 0.45);
        nodeSeed.push(rand());
      }
      links++;
    }
  }
  // faint silhouette hints between neighbouring anchors
  for (let k = 0; k < AC; k++) {
    let best = -1, bd = 0.12 * 0.12;
    for (let j = k + 1; j < AC; j++) {
      const dx = A[j * 3] - A[k * 3], dy = A[j * 3 + 1] - A[k * 3 + 1];
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = j;
      }
    }
    if (best >= 0 && rand() < 0.5) pushLine(A[k * 3], A[k * 3 + 1], A[k * 3 + 2], A[best * 3], A[best * 3 + 1], A[best * 3 + 2], 0.3, 0.3);
  }
  // --- macro constellation: hero ↔ 2 nearest heroes (long, polygonal) + hero → nearest anchor
  const HC = counts.hero;
  const heroLinked = new Set<number>();
  for (let i = 0; i < HC; i++) {
    const x = he[i * 3], y = he[i * 3 + 1], z = he[i * 3 + 2];
    const near: [number, number][] = [];
    for (let j = 0; j < HC; j++) {
      if (j === i) continue;
      const dx = he[j * 3] - x, dy = he[j * 3 + 1] - y, dz = he[j * 3 + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 0.6 * 0.6) near.push([d2, j]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let f = 0; f < Math.min(2, near.length); f++) {
      const j = near[f][1];
      const key = Math.min(i, j) * HC + Math.max(i, j);
      if (heroLinked.has(key) || rand() > 0.85) continue;
      if (crossesFace(x, y, he[j * 3], he[j * 3 + 1])) continue;
      heroLinked.add(key);
      pushLine(x, y, z, he[j * 3], he[j * 3 + 1], he[j * 3 + 2], 0.55, 0.55);
    }
    let best = -1, bd = 0.42 * 0.42;
    for (let k = 0; k < AC; k++) {
      const dx = A[k * 3] - x, dy = A[k * 3 + 1] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = k;
      }
    }
    if (best >= 0 && rand() < 0.6 && !crossesFace(x, y, A[best * 3], A[best * 3 + 1])) {
      pushLine(x, y, z, A[best * 3], A[best * 3 + 1], A[best * 3 + 2], 0.5, 0.35);
    }
  }

  const toSet = (pos: number[], col: number[] | null, sz: number[], al: number[], sd: number[], sc: number[], br: number[] | null): PointSet => {
    const c = pos.length / 3;
    let colors: Float32Array;
    if (col) colors = new Float32Array(col);
    else {
      colors = new Float32Array(c * 3);
      for (let i = 0; i < c; i++) {
        colors[i * 3] = 0.74;
        colors[i * 3 + 1] = 0.86;
        colors[i * 3 + 2] = 1;
      }
    }
    let bright: Float32Array;
    if (br) bright = new Float32Array(br);
    else bright = new Float32Array(c);
    return {
      positions: new Float32Array(pos), colors, sizes: new Float32Array(sz), alphas: new Float32Array(al),
      seeds: new Float32Array(sd), scatter: sc.length ? new Float32Array(sc) : new Float32Array(c * 3), bright, count: c,
    };
  };
  const heroBright = new Array(HC).fill(1);

  return {
    spray: toSet(sp, spC, spS, spA, spSeed, spSc, spB),
    hero: toSet(he, heC, heS, heA, heSeed, heSc, heroBright),
    escape: toSet(esc, escC, escS, escA, escSeed, escSc, null),
    stars: toSet(st, null, stS, stA, stSeed, stSc, stB),
    nodes: toSet(nodePos, null, nodeS, nodeA, nodeSeed, [], null),
    linePositions: new Float32Array(lp),
    lineColors: new Float32Array(lc),
    linePhases: new Float32Array(lph),
    lineVertexCount: lp.length / 3,
  };
}

/** Distant background starfield (world space, independent of the portrait). */
export function buildStarfield(count: number, seed = 7) {
  const rand = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const seeds = new Float32Array(count);
  const bright = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const fg = rand() < 0.08;
    positions[i * 3] = (rand() - 0.5) * 30;
    positions[i * 3 + 1] = (rand() - 0.5) * 18;
    positions[i * 3 + 2] = fg ? 0.5 + rand() * 2.5 : -2 - rand() * 12;
    const warm = rand() < 0.18;
    const tone = warm ? WARM_STAR : COOL_STAR;
    colors[i * 3] = tone[0];
    colors[i * 3 + 1] = tone[1];
    colors[i * 3 + 2] = tone[2];
    sizes[i] = fg ? 1.6 + rand() * 1.6 : 0.5 + rand() * 1.1;
    alphas[i] = fg ? 0.1 + rand() * 0.1 : 0.25 + rand() * 0.6;
    seeds[i] = rand();
    bright[i] = !fg && rand() < 0.04 ? 1 : 0;
  }
  return { positions, colors, sizes, alphas, seeds, bright, count };
}
