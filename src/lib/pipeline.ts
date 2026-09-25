import sharp from "sharp";
import {
  bilateralRGB,
  clamp255,
  detectPixelBlock,
  laplacianVariance,
  nearestGray,
  rgbToYPlane,
  richardsonLucyY,
  totalVariation,
  transferYToRGB,
  unsharpRGBLuma,
  clamp01,
} from "./algorithms";
import type { EnhanceParams, EnhanceReport, OutputFormat, StepTiming } from "./types";

const MAX_IN_SIDE = 3200; // inputs are pre-capped to keep memory/time bounded
const MAX_OUT_MP = 24; // output pixel cap
const RL_MAX_MP = 6; // above this, deconvolution is skipped for safety
const BILATERAL_MAX_MP = 4.5;

const MIME: Record<OutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

interface RawRGB {
  rgb: Float32Array;
  w: number;
  h: number;
}

function toRGBFloat(data: Buffer, w: number, h: number, channels: number): Float32Array {
  const out = new Float32Array(w * h * 3);
  const n = w * h;
  if (channels >= 3) {
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      out[p] = data[i * channels];
      out[p + 1] = data[i * channels + 1];
      out[p + 2] = data[i * channels + 2];
    }
  } else {
    // grayscale (with or without alpha) — replicate
    for (let i = 0, p = 0; i < n; i++, p += 3) {
      const v = data[i * channels];
      out[p] = v;
      out[p + 1] = v;
      out[p + 2] = v;
    }
  }
  return out;
}

function rgbToU8(rgb: Float32Array): Uint8Array {
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) {
    const v = rgb[i];
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v | 0;
  }
  return out;
}

async function decodeRGB(buf: Buffer, maxSide?: number): Promise<RawRGB> {
  let img = sharp(buf).rotate().flatten({ background: "#ffffff" });
  if (maxSide) {
    const meta = await sharp(buf).metadata();
    const mw = meta.width ?? 0;
    const mh = meta.height ?? 0;
    const scale = Math.min(1, maxSide / Math.max(1, mw, mh));
    if (scale < 1) {
      img = img.resize(
        Math.max(1, Math.round(mw * scale)),
        Math.max(1, Math.round(mh * scale)),
        { kernel: "lanczos3", fit: "fill" }
      );
    }
  }
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return {
    rgb: toRGBFloat(data, info.width, info.height, info.channels),
    w: info.width,
    h: info.height,
  };
}

async function resizeRGB(
  rgb: Float32Array,
  w: number,
  h: number,
  tW: number,
  tH: number,
  kernel: "lanczos3" | "nearest" = "lanczos3",
  ioOffset = 0
): Promise<RawRGB> {
  const u8 = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) {
    const v = rgb[i] + ioOffset;
    u8[i] = v < 0 ? 0 : v > 255 ? 255 : v | 0;
  }
  const { data, info } = await sharp(u8, {
    raw: { width: w, height: h, channels: 3 },
  })
    .resize(tW, tH, { kernel, fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Float32Array(info.width * info.height * 3);
  for (let i = 0; i < out.length; i++) out[i] = data[i] - ioOffset;
  return { rgb: out, w: info.width, h: info.height };
}

/**
 * Iterative back-projection (IBP): enforce consistency between the upscaled
 * image and the observed low-resolution blocks. Each iteration downscales the
 * current estimate, measures the residual against the true low-res data, and
 * projects the (upscaled) residual back. This re-synthesizes crisp,
 * block-consistent edges that plain interpolation leaves blurry — without
 * the ringing of aggressive unsharp masking.
 */
async function backProject(
  lowBuf: Buffer,
  up: RawRGB,
  lowW: number,
  lowH: number,
  iterations: number
): Promise<RawRGB> {
  const low = await decodeRawResize(lowBuf, lowW, lowH);
  const cur: RawRGB = { rgb: up.rgb.slice(), w: up.w, h: up.h };
  for (let it = 0; it < iterations; it++) {
    const back = await resizeRGB(cur.rgb, cur.w, cur.h, lowW, lowH);
    const n = lowW * lowH * 3;
    const err = new Float32Array(n);
    for (let i = 0; i < n; i++) err[i] = low.rgb[i] - back.rgb[i];
    const errUp = await resizeRGB(err, lowW, lowH, cur.w, cur.h, "lanczos3", 128);
    for (let i = 0; i < cur.rgb.length; i++) {
      cur.rgb[i] = clamp255(cur.rgb[i] + 1.15 * errUp.rgb[i]);
    }
  }
  return cur;
}

export async function runEnhance(
  input: Buffer,
  params: EnhanceParams
): Promise<{ buffer: Uint8Array; contentType: string; report: EnhanceReport }> {
  const steps: StepTiming[] = [];
  const notes: string[] = [];
  const track = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const s = performance.now();
    const r = await fn();
    steps.push({ name, ms: Math.round(performance.now() - s) });
    return r;
  };

  const s = Math.min(1, Math.max(0, params.strength / 100));

  // ---------- decode ----------
  const meta = await sharp(input).metadata(); // throws on invalid images
  if (!meta.width || !meta.height) throw new Error("Unsupported or corrupt image file.");
  const origW = meta.width;
  const origH = meta.height;
  let work = await track("decode+orient", () => decodeRGB(input, MAX_IN_SIDE));
  const inW = work.w;
  const inH = work.h;
  if (Math.max(origW, origH) > MAX_IN_SIDE) {
    notes.push(`Input resized from ${origW}×${origH} to ${inW}×${inH} for processing.`);
  }

  // ---------- analysis ----------
  const grayGrid = await track("analyze:blocks", () => nearestGray(work.rgb, work.w, work.h, 640));
  const detA = detectPixelBlock(grayGrid.g, grayGrid.w, grayGrid.h);
  // detection runs on the downsampled grid — scale the block size back to
  // original resolution before the pipeline uses it
  const det = {
    block: detA.block > 0 ? detA.block * grayGrid.step : 0,
    strength: detA.strength,
  };
  const gray1000 = await track("analyze:sharpness", () => nearestGray(work.rgb, work.w, work.h, 1000));
  const sharpBefore = laplacianVariance(gray1000.g, gray1000.w, gray1000.h);
  const detailBefore = totalVariation(gray1000.g, gray1000.w, gray1000.h);
  const blurLikelihood = clamp01((350 - sharpBefore) / 300);

  const pixelated = det.block >= 3 && det.strength > 0.18;
  const blurry = blurLikelihood > 0.35;

  let decision = "";
  let u = params.upscale;
  let outW = work.w;
  let outH = work.h;

  // ---------- pipelines ----------
  const doDepixelate = async () => {
    const block = det.block;
    if (!block) {
      decision = "No pixel grid detected — applied edge-preserving reconstruction & sharpening";
      notes.push("Depixelate mode forced, but no mosaic pattern was found in this image.");
      if (u > 1) {
        const target = await track("upscale", () =>
          resizeRGB(work.rgb, work.w, work.h, Math.round(work.w * u), Math.round(work.h * u))
        );
        work = target;
      }
      const mp = (work.w * work.h) / 1e6;
      if (mp <= BILATERAL_MAX_MP && s > 0.15) {
        work.rgb = await track("bilateral", () =>
          bilateralRGB(work.rgb, work.w, work.h, 2, 10 + 20 * s)
        );
      }
      await track("sharpen", () => {
        unsharpRGBLuma(work.rgb, work.w, work.h, 0.9, 0.3 + 0.75 * s);
        unsharpRGBLuma(work.rgb, work.w, work.h, 1.9, 0.1 + 0.42 * s);
      });
    } else {
      decision = `Detected ~${block.toFixed(1)}px pixel blocks — block-aware reconstruction applied`;
      const lowW = Math.max(8, Math.round(work.w / block));
      const lowH = Math.max(8, Math.round(work.h / block));
      let lowBuf = await track("grid-downscale", () =>
        sharp(input)
          .rotate()
          .flatten({ background: "#ffffff" })
          .resize(lowW, lowH, { kernel: "lanczos3", fit: "fill" })
          .png()
          .toBuffer()
      );
      // median cleanup only for large true-res reconstructions at high
      // strength — at tiny true resolutions it destroys genuine detail
      if (s > 0.6 && Math.min(lowW, lowH) >= 120) {
        lowBuf = await track("median-clean", () => sharp(lowBuf).median(3).png().toBuffer());
      }
      // cap output resolution
      while (Math.round(work.w * u) * Math.round(work.h * u) > MAX_OUT_MP * 1e6 && u > 1) {
        u = u / 2;
      }
      if (Math.round(work.w * u) * Math.round(work.h * u) > MAX_OUT_MP * 1e6) {
        notes.push("Output scale capped to respect the 24 MP limit.");
      }
      outW = Math.min(6000, Math.round(work.w * u));
      outH = Math.min(6000, Math.round(work.h * u));
      const uEff = outW / work.w;
      work = await track("super-sample", () => decodeRawResize(lowBuf, outW, outH));
      work = await track("back-projection", () =>
        backProject(lowBuf, work, lowW, lowH, 2 + Math.round(2 * s + 2 * Math.log2(Math.max(1, uEff))))
      );
      const mp = (outW * outH) / 1e6;
      if (s > 0.15 && mp <= BILATERAL_MAX_MP) {
        work.rgb = await track("bilateral", () =>
          bilateralRGB(work.rgb, work.w, work.h, mp > 2 ? 2 : 3, 10 + 16 * s)
        );
      }
      // scale-aware edge synthesis: edge width grows with the upscale factor
      await track("edge-synthesis", () => {
        unsharpRGBLuma(work.rgb, work.w, work.h, 0.6 * uEff, 0.5 + 1.0 * s);
        unsharpRGBLuma(work.rgb, work.w, work.h, 1.6 * uEff, 0.15 + 0.5 * s);
      });
    }
  };

  const doUnblur = async () => {
    decision = blurry
      ? "Blur detected — Richardson-Lucy deconvolution applied"
      : "Unblur mode forced — Richardson-Lucy deconvolution applied";
    const mp = (work.w * work.h) / 1e6;
    if (mp <= RL_MAX_MP) {
      const sigma = 0.8 + 1.7 * s;
      const budget = 26;
      const iters = Math.min(30, Math.max(4, Math.round((budget * (0.45 + 0.55 * s)) / Math.max(1, mp))));
      await track("deconvolution", () => {
        const y = rgbToYPlane(work.rgb, work.w, work.h);
        const y2 = richardsonLucyY(y, work.w, work.h, sigma, iters);
        transferYToRGB(work.rgb, y2, y);
      });
      notes.push(`Deconvolution: σ≈${sigma.toFixed(1)} px, ${iters} iterations.`);
    } else {
      notes.push("Image too large for full deconvolution — applied high-frequency enhancement instead.");
    }
    if (u > 1) {
      while (Math.round(work.w * u) * Math.round(work.h * u) > MAX_OUT_MP * 1e6 && u > 1) u = u / 2;
      outW = Math.min(6000, Math.round(work.w * u));
      outH = Math.min(6000, Math.round(work.h * u));
      work = await track("upscale", () => resizeRGB(work.rgb, work.w, work.h, outW, outH));
      await track("sharpen", () => unsharpRGBLuma(work.rgb, work.w, work.h, 0.9, 0.2 + 0.35 * s));
    } else {
      outW = work.w;
      outH = work.h;
      await track("sharpen", () => unsharpRGBLuma(work.rgb, work.w, work.h, 0.9, 0.15 + 0.35 * s));
    }
  };

  const doSharpen = async (light: boolean) => {
    decision = light
      ? "No significant degradation found — applied light enhancement"
      : "Sharpen mode — multi-scale detail enhancement applied";
    if (u > 1) {
      while (Math.round(work.w * u) * Math.round(work.h * u) > MAX_OUT_MP * 1e6 && u > 1) u = u / 2;
      outW = Math.min(6000, Math.round(work.w * u));
      outH = Math.min(6000, Math.round(work.h * u));
      work = await track("upscale", () => resizeRGB(work.rgb, work.w, work.h, outW, outH));
    } else {
      outW = work.w;
      outH = work.h;
    }
    const a1 = light ? 0.35 : 0.3 + 0.7 * s;
    const a2 = light ? 0.15 : 0.1 + 0.4 * s;
    await track("sharpen", () => {
      unsharpRGBLuma(work.rgb, work.w, work.h, 0.9, a1);
      unsharpRGBLuma(work.rgb, work.w, work.h, 1.9, a2);
    });
  };

  if (params.mode === "depixelate") await doDepixelate();
  else if (params.mode === "unblur") await doUnblur();
  else if (params.mode === "sharpen") await doSharpen(false);
  else {
    // auto
    if (pixelated) await doDepixelate();
    else if (blurry) await doUnblur();
    else await doSharpen(true);
  }

  // ---------- post metrics ----------
  // Detail energy is measured at the INPUT scale: the output is scaled back
  // down before measuring, so the number answers "how much perceived detail
  // survives when the restored image is viewed at the original size".
  let meas = work;
  if (work.w !== inW || work.h !== inH) {
    meas = await resizeRGB(work.rgb, work.w, work.h, inW, inH);
  }
  const grayAfter = await track("metrics", () => nearestGray(meas.rgb, meas.w, meas.h, 1000));
  const detailAfter = totalVariation(grayAfter.g, grayAfter.w, grayAfter.h);
  const grayAfter640 = await track("metrics:blocks", () => nearestGray(meas.rgb, meas.w, meas.h, 640));
  const detAfterA = detectPixelBlock(grayAfter640.g, grayAfter640.w, grayAfter640.h);
  const detAfter = {
    strength: detAfterA.block > 0 ? detAfterA.strength : 0,
  };
  const gain = detailBefore > 0.01 ? ((detailAfter - detailBefore) / detailBefore) * 100 : 0;

  // ---------- encode ----------
  const buffer = await track("encode", async () => {
    const raw = sharp(rgbToU8(work.rgb), {
      raw: { width: work.w, height: work.h, channels: 3 },
    });
    if (params.format === "png") return raw.png({ compressionLevel: 7 }).toBuffer();
    if (params.format === "jpeg") return raw.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    return raw.webp({ quality: 90 }).toBuffer();
  });

  const report: EnhanceReport = {
    analysis: {
      pixelBlock: Number(det.block.toFixed(2)),
      pixelStrength: Number(det.strength.toFixed(3)),
      blurLikelihood: Number(blurLikelihood.toFixed(3)),
      laplacianVarBefore: Math.round(sharpBefore),
      decision,
    },
    metrics: {
      detailBefore: Number(detailBefore.toFixed(2)),
      detailAfter: Number(detailAfter.toFixed(2)),
      detailGainPct: Math.round(gain),
      pixelStrengthBefore: Number(det.strength.toFixed(3)),
      pixelStrengthAfter: Number(detAfter.strength.toFixed(3)),
    },
    output: {
      width: work.w,
      height: work.h,
      scale: Number((work.w / inW).toFixed(2)),
      format: params.format,
    },
    steps,
    notes,
  };

  return { buffer: new Uint8Array(buffer), contentType: MIME[params.format], report };
}

/** Resize an intermediate low-res buffer up to target dims, return raw RGB. */
async function decodeRawResize(buf: Buffer, tW: number, tH: number): Promise<RawRGB> {
  const { data, info } = await sharp(buf)
    .resize(tW, tH, { kernel: "lanczos3", fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    rgb: toRGBFloat(data, info.width, info.height, info.channels),
    w: info.width,
    h: info.height,
  };
}
