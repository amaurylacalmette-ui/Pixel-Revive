import { runEnhance } from "@/lib/pipeline";
import type { EnhanceMode, EnhanceParams, OutputFormat } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: EnhanceMode[] = ["auto", "depixelate", "unblur", "sharpen"];
const FORMATS: OutputFormat[] = ["png", "jpeg", "webp"];
const UPSCALES = [1, 2, 4];
const MAX_UPLOAD = 25 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File)) {
      return Response.json({ error: 'No image provided (expected form field "image").' }, { status: 400 });
    }
    if (file.size === 0) {
      return Response.json({ error: "The uploaded file is empty." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD) {
      return Response.json({ error: "Image exceeds the 25 MB upload limit." }, { status: 413 });
    }

    const modeRaw = String(form.get("mode") ?? "auto") as EnhanceMode;
    const formatRaw = String(form.get("format") ?? "png") as OutputFormat;
    const upscaleRaw = Number(form.get("upscale") ?? 1);
    const strengthRaw = Number(form.get("strength") ?? 60);

    const params: EnhanceParams = {
      mode: MODES.includes(modeRaw) ? modeRaw : "auto",
      format: FORMATS.includes(formatRaw) ? formatRaw : "png",
      upscale: UPSCALES.includes(upscaleRaw) ? upscaleRaw : 1,
      strength: Number.isFinite(strengthRaw) ? Math.min(100, Math.max(0, Math.round(strengthRaw))) : 60,
    };

    const input = Buffer.from(await file.arrayBuffer());
    const { buffer, contentType, report } = await runEnhance(input, params);

    // Copy into a standalone ArrayBuffer-backed Uint8Array (BodyInit-compatible).
    const body = new Uint8Array(buffer);
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "no-store",
        "X-Process-Report": encodeURIComponent(JSON.stringify(report)),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed.";
    const isBadInput = /input|unsupported|corrupt|premature|invalid|decode/i.test(message);
    return Response.json({ error: isBadInput ? `Could not read this image: ${message}` : message }, {
      status: isBadInput ? 400 : 500,
    });
  }
}
