import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d9488"/>
      <stop offset="0.55" stop-color="#f59e0b"/>
      <stop offset="1" stop-color="#e11d48"/>
    </linearGradient>
  </defs>
  <rect width="480" height="480" fill="url(#bg)"/>
  <circle cx="118" cy="132" r="66" fill="#fef3c7" opacity="0.92"/>
  <circle cx="332" cy="104" r="42" fill="#fafaf9" opacity="0.85"/>
  <circle cx="404" cy="200" r="18" fill="#052e16" opacity="0.7"/>
  <polygon points="240,286 330,436 150,436" fill="#1c1917" opacity="0.82"/>
  <rect x="52" y="318" width="118" height="94" rx="12" fill="#064e3b" opacity="0.78"/>
  <line x1="40" y1="56" x2="440" y2="56" stroke="#ffffff" stroke-width="1" opacity="0.9"/>
  <line x1="40" y1="66" x2="440" y2="66" stroke="#ffffff" stroke-width="2" opacity="0.9"/>
  <line x1="40" y1="78" x2="440" y2="78" stroke="#ffffff" stroke-width="3" opacity="0.9"/>
  <text x="240" y="240" font-family="DejaVu Sans, sans-serif" font-size="46" font-weight="bold" fill="#ffffff" text-anchor="middle">CLARITY 42</text>
  <text x="240" y="272" font-family="DejaVu Sans, sans-serif" font-size="15" fill="#ffffff" text-anchor="middle">The quick brown fox jumps over 1234567890</text>
</svg>`;

export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") ?? "pixelated";
  try {
    const base = () =>
      sharp(Buffer.from(SVG)).resize(480, 480, { fit: "fill" }).flatten({ background: "#ffffff" });
    let out: Buffer;
    if (kind === "pixelated") {
      const small = await base().resize(56, 56, { fit: "fill", kernel: "lanczos3" }).png().toBuffer();
      out = await sharp(small)
        .resize(480, 480, { fit: "fill", kernel: "nearest" })
        .png()
        .toBuffer();
    } else if (kind === "blurred") {
      out = await base().blur(2.6).png().toBuffer();
    } else {
      return Response.json({ error: "Unknown sample kind. Use ?kind=pixelated|blurred." }, { status: 400 });
    }
    return new Response(new Uint8Array(out), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="sample-${kind}.png"`,
      },
    });
  } catch {
    return Response.json({ error: "Sample generation failed." }, { status: 500 });
  }
}
