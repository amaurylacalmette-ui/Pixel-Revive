export type EnhanceMode = "auto" | "depixelate" | "unblur" | "sharpen";
export type OutputFormat = "png" | "jpeg" | "webp";

export interface EnhanceParams {
  /** Restoration mode. "auto" analyzes the image and picks a pipeline. */
  mode: EnhanceMode;
  /** Processing strength, 0-100. */
  strength: number;
  /** Output scale factor relative to the uploaded image (1, 2 or 4). */
  upscale: number;
  /** Encoded output format. */
  format: OutputFormat;
}

export interface StepTiming {
  name: string;
  ms: number;
}

export interface EnhanceReport {
  analysis: {
    /** Detected pixelation block size in px (0 = none detected). */
    pixelBlock: number;
    /** 0..1 — how dominant the pixel-grid artifact is. */
    pixelStrength: number;
    /** 0..1 — likelihood the image suffers from Gaussian-ish blur. */
    blurLikelihood: number;
    /** Variance of the Laplacian on the input (higher = sharper). */
    laplacianVarBefore: number;
    /** Human-readable explanation of the chosen pipeline. */
    decision: string;
  };
  metrics: {
    /** Total-variation detail energy, measured at the input scale. */
    detailBefore: number;
    detailAfter: number;
    detailGainPct: number;
    pixelStrengthBefore: number;
    pixelStrengthAfter: number;
  };
  output: {
    width: number;
    height: number;
    scale: number;
    format: OutputFormat;
  };
  steps: StepTiming[];
  notes: string[];
}
