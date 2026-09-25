/**
 * Pure signal-processing kernels for image restoration.
 * All functions operate on flat Float32Array buffers (RGB interleaved 0-255
 * or single-channel luma planes) so they can be chained without re-allocation
 * surprises. No sharp / DOM dependencies — fully unit-testable.
 */

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Extract a Rec.601 luma plane from an interleaved RGB buffer. */
export function rgbToYPlane(rgb: Float32Array, w: number, h: number): Float32Array {
  const n = w * h;
  const y = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    y[i] = 0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2];
  }
  return y;
}

/**
 * Nearest-neighbour downsample of the luma plane. `nearest` (as opposed to
 * averaging) is deliberate: averaging destroys exactly the hard block edges
 * and high frequencies we want to measure.
 */
export function nearestGray(
  rgb: Float32Array,
  w: number,
  h: number,
  maxSide: number
): { g: Float32Array; w: number; h: number; step: number } {
  const step = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
  if (step === 1) return { g: rgbToYPlane(rgb, w, h), w, h, step: 1 };
  const nw = Math.max(1, Math.floor(w / step));
  const nh = Math.max(1, Math.floor(h / step));
  const g = new Float32Array(nw * nh);
  const half = step >> 1;
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, y * step + half);
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, x * step + half);
      const i = (sy * w + sx) * 3;
      g[y * nw + x] = 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
    }
  }
  return { g, w: nw, h: nh, step };
}

/** Variance of the 4-neighbour Laplacian — a standard sharpness proxy. */
export function laplacianVariance(g: Float32Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    const off = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = off + x;
      const l = -4 * g[i] + g[i - 1] + g[i + 1] + g[i - w] + g[i + w];
      sum += l;
      sum2 += l * l;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return Math.max(0, sum2 / n - mean * mean);
}

/**
 * Total variation per pixel (mean |Δx| + |Δy|) — robust perceived-detail
 * measure that, unlike Laplacian variance, does not blow up on the hard
 * mosaic steps of pixelated inputs.
 */
export function totalVariation(g: Float32Array, w: number, h: number): number {
  if (w < 2 || h < 2) return 0;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) {
      const i = off + x;
      const dx = x + 1 < w ? Math.abs(g[i + 1] - g[i]) : 0;
      const dy = y + 1 < h ? Math.abs(g[i + w] - g[i]) : 0;
      sum += dx + dy;
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Detect the pixel-block size of a mosaic/pixelated image.
 *
 * Method (phase-free, works with non-integer block ratios):
 *  1. Collect spacings between consecutive strong step-edges along sampled
 *     rows and columns. In a pixelated image, block boundaries recur every
 *     `b` pixels, so these spacings cluster at integer multiples of b —
 *     even when individual boundaries merge or drift (non-integer ratios).
 *  2. For every candidate block size b (2…48 in 0.25 px steps), score how
 *     many spacings are integer multiples of b (±14%). The largest passing
 *     candidate wins (small divisors always alias; the true block is the
 *     largest base all spacings share).
 *  3. Require agreement between horizontal and vertical scans — real mosaics
 *     are isotropic; random flat regions and striped textures are not.
 */
function boundaryDiffs(
  g: Float32Array,
  w: number,
  h: number,
  horizontal: boolean,
  maxBlocks: number
): number[] {
  const diffs: number[] = [];
  const lines = horizontal ? h : w;
  const lineStep = Math.max(1, Math.floor(lines / 48));
  const len = horizontal ? w : h;
  for (let l = Math.floor(lineStep / 2); l < lines; l += lineStep) {
    let prev = -1;
    for (let i = 0; i < len - 1; i++) {
      const a = horizontal ? g[l * w + i] : g[i * w + l];
      const b = horizontal ? g[l * w + i + 1] : g[(i + 1) * w + l];
      if (Math.abs(b - a) >= 6) {
        if (prev >= 0) {
          const d = i - prev;
          if (d >= 2 && d <= maxBlocks * 2) diffs.push(d);
        }
        prev = i;
      }
    }
  }
  return diffs;
}

function clusterScore(diffs: number[], b: number): number {
  let match = 0;
  // Tolerance is deliberately tight (±0.75px min): boundary positions of a
  // real grid jitter ≤ 1px from rounding drift, while uniformly-random
  // spacings can only match ≈ 2·tol/b of the time — well below the 0.7
  // acceptance threshold for every b ≥ 3.25. This is what separates a true
  // mosaic from smooth gradients, blur, or sharpening ringing.
  const tol = Math.max(0.75, 0.09 * b);
  for (const d of diffs) {
    const k = Math.round(d / b);
    if (k >= 1 && Math.abs(d - k * b) <= tol) match++;
  }
  return match / diffs.length;
}

export function detectPixelBlock(
  g: Float32Array,
  w: number,
  h: number
): { block: number; strength: number } {
  if (w < 40 || h < 40) return { block: 0, strength: 0 };

  const scan = (horizontal: boolean): { b: number; sc: number } | null => {
    const maxBlocks = Math.min(48, Math.floor((horizontal ? w : h) / 6));
    const diffs = boundaryDiffs(g, w, h, horizontal, maxBlocks);
    if (diffs.length < 30) return null;
    let best: { b: number; sc: number } | null = null;
    for (let b = 3.25; b <= maxBlocks + 0.001; b += 0.25) {
      const sc = clusterScore(diffs, b);
      if (sc < 0.7) continue;
      // keep the highest-scoring candidate; prefer the larger b on near-ties
      if (!best || sc > best.sc + 0.02 || (sc > best.sc - 0.02 && b > best.b)) {
        best = { b, sc };
      }
    }
    return best;
  };

  const H = scan(true);
  const V = scan(false);
  if (H && V && Math.abs(H.b - V.b) <= 1.5) {
    const block = (H.b + V.b) / 2;
    const sc = Math.min(H.sc, V.sc);
    return { block, strength: clamp01((sc - 0.55) / 0.4) };
  }
  const single = H && H.sc >= 0.8 ? H : V && V.sc >= 0.8 ? V : null;
  if (single) {
    return { block: single.b, strength: clamp01((single.sc - 0.6) / 0.4) * 0.8 };
  }
  return { block: 0, strength: 0 };
}

export function gaussianKernel1d(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

/** Single-direction convolution with clamped edges. */
export function convolve1D(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  k: Float32Array,
  horizontal: boolean
): void {
  const r = (k.length - 1) >> 1;
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      const off = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let j = -r; j <= r; j++) {
          let xx = x + j;
          if (xx < 0) xx = 0;
          else if (xx >= w) xx = w - 1;
          acc += src[off + xx] * k[j + r];
        }
        dst[off + x] = acc;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      const off = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let j = -r; j <= r; j++) {
          let yy = y + j;
          if (yy < 0) yy = 0;
          else if (yy >= h) yy = h - 1;
          acc += src[yy * w + x] * k[j + r];
        }
        dst[off + x] = acc;
      }
    }
  }
}

/** Gaussian blur of a luma plane (separable, O(N·k)). */
export function gaussBlurY(y: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const k = gaussianKernel1d(sigma);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  convolve1D(y, tmp, w, h, k, true);
  convolve1D(tmp, out, w, h, k, false);
  return out;
}

/**
 * Richardson-Lucy deconvolution with a Gaussian PSF (the classic blind-ish
 * deblur workhorse). Because the Gaussian kernel is separable, every
 * iteration costs 4 separable passes instead of a full 2-D convolution.
 * Runs on the luma plane only — fast and free of colour fringing.
 */
export function richardsonLucyY(
  observed: Float32Array,
  w: number,
  h: number,
  sigma: number,
  iterations: number
): Float32Array {
  const n = w * h;
  const k = gaussianKernel1d(sigma);
  const kf = k.slice().reverse();
  let est = observed.slice();
  const tmp = new Float32Array(n);
  const conv = new Float32Array(n);
  const ratio = new Float32Array(n);
  const corr = new Float32Array(n);

  for (let it = 0; it < iterations; it++) {
    convolve1D(est, tmp, w, h, k, true);
    convolve1D(tmp, conv, w, h, k, false);
    for (let i = 0; i < n; i++) {
      ratio[i] = observed[i] / Math.max(conv[i], 0.35);
    }
    convolve1D(ratio, tmp, w, h, kf, true);
    convolve1D(tmp, corr, w, h, kf, false);
    for (let i = 0; i < n; i++) {
      est[i] = clamp255(est[i] * corr[i]);
    }
  }
  return est;
}

/**
 * Write a new luma plane back into an RGB buffer by transferring the per-pixel
 * luma delta equally to R, G and B (keeps chroma stable, avoids the ringing
 * of a full YCbCr round-trip on 8-bit data).
 */
export function transferYToRGB(rgb: Float32Array, newY: Float32Array, oldY: Float32Array): void {
  for (let i = 0, p = 0; i < newY.length; i++, p += 3) {
    const d = newY[i] - oldY[i];
    if (d !== 0) {
      rgb[p] = clamp255(rgb[p] + d);
      rgb[p + 1] = clamp255(rgb[p + 1] + d);
      rgb[p + 2] = clamp255(rgb[p + 2] + d);
    }
  }
}

/** Unsharp mask applied on the luma channel only (no colour shifts). */
export function unsharpRGBLuma(
  rgb: Float32Array,
  w: number,
  h: number,
  sigma: number,
  amount: number
): void {
  if (amount <= 0.001) return;
  const y = rgbToYPlane(rgb, w, h);
  const blurred = gaussBlurY(y, w, h, sigma);
  for (let i = 0, p = 0; i < y.length; i++, p += 3) {
    const d = (y[i] - blurred[i]) * amount;
    if (d !== 0) {
      rgb[p] = clamp255(rgb[p] + d);
      rgb[p + 1] = clamp255(rgb[p + 1] + d);
      rgb[p + 2] = clamp255(rgb[p + 2] + d);
    }
  }
}

/**
 * Edge-preserving smoothing (bilateral filter, two-pass separable
 * approximation with the range term taken on luma). Flattens residual block
 * staircase artifacts while keeping real edges crisp.
 */
export function bilateralRGB(
  rgb: Float32Array,
  w: number,
  h: number,
  radius: number,
  sigmaColor: number
): Float32Array {
  const n = w * h;
  const y = rgbToYPlane(rgb, w, h);
  const lut = new Float32Array(256);
  for (let d = 0; d < 256; d++) {
    lut[d] = Math.exp(-(d * d) / (2 * sigmaColor * sigmaColor));
  }
  const tmp = new Float32Array(n * 3);
  const out = new Float32Array(n * 3);

  for (let pos = 0; pos < n; pos++) {
    const cy = pos % w;
    const cx = (pos - cy) / w;
    const ci = pos * 3;
    const yc = y[pos];
    let wsum = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let d = -radius; d <= radius; d++) {
      let xx = cy + d;
      if (xx < 0) xx = 0;
      else if (xx >= w) xx = w - 1;
      const j = (cx * w + xx) * 3;
      const dj = y[cx * w + xx] - yc;
      const wt = lut[Math.min(255, Math.abs(dj) | 0)];
      wsum += wt;
      sr += wt * rgb[j];
      sg += wt * rgb[j + 1];
      sb += wt * rgb[j + 2];
    }
    tmp[ci] = sr / wsum;
    tmp[ci + 1] = sg / wsum;
    tmp[ci + 2] = sb / wsum;
  }

  for (let pos = 0; pos < n; pos++) {
    const cy = pos % w;
    const cx = (pos - cy) / w;
    const ci = pos * 3;
    const yc = y[pos];
    let wsum = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let d = -radius; d <= radius; d++) {
      let yy = cx + d;
      if (yy < 0) yy = 0;
      else if (yy >= h) yy = h - 1;
      const j = (yy * w + cy) * 3;
      const dj = y[yy * w + cy] - yc;
      const wt = lut[Math.min(255, Math.abs(dj) | 0)];
      wsum += wt;
      sr += wt * tmp[j];
      sg += wt * tmp[j + 1];
      sb += wt * tmp[j + 2];
    }
    out[ci] = sr / wsum;
    out[ci + 1] = sg / wsum;
    out[ci + 2] = sb / wsum;
  }
  return out;
}
