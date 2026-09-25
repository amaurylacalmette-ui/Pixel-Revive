"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Clock,
  Download,
  Droplets,
  Focus,
  Grid3x3,
  ImagePlus,
  Info,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ComparisonSlider } from "@/components/comparison-slider";
import type { EnhanceMode, EnhanceReport, OutputFormat } from "@/lib/types";

const MODES: { id: EnhanceMode; label: string; desc: string; icon: typeof Wand2 }[] = [
  { id: "auto", label: "Auto", desc: "Detect & fix", icon: Wand2 },
  { id: "depixelate", label: "Depixelate", desc: "Mosaic / low-res", icon: Grid3x3 },
  { id: "unblur", label: "Unblur", desc: "Soft / gaussian blur", icon: Droplets },
  { id: "sharpen", label: "Sharpen", desc: "Detail boost", icon: Focus },
];

const STAGES = [
  "Analyzing artifacts…",
  "Reconstructing detail…",
  "Rebuilding edges…",
  "Refining & encoding…",
];

const EXT: Record<OutputFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const [mode, setMode] = useState<EnhanceMode>("auto");
  const [strength, setStrength] = useState(60);
  const [upscale, setUpscale] = useState(1);
  const [format, setFormat] = useState<OutputFormat>("png");

  const [processing, setProcessing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [report, setReport] = useState<EnhanceReport | null>(null);
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<{ before?: string; after?: string }>({});

  const revokeAll = () => {
    if (urlRef.current.before) URL.revokeObjectURL(urlRef.current.before);
    if (urlRef.current.after) URL.revokeObjectURL(urlRef.current.after);
    urlRef.current = {};
  };

  useEffect(() => {
    return () => revokeAll();
  }, []);

  const applyFile = useCallback(
    (f: File) => {
      if (!f.type.startsWith("image/")) {
        toast({
          title: "Unsupported file",
          description: "Please choose an image file (PNG, JPEG, WebP, …).",
          variant: "destructive",
        });
        return;
      }
      if (f.size > 25 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Maximum upload size is 25 MB.",
          variant: "destructive",
        });
        return;
      }
      if (urlRef.current.before) URL.revokeObjectURL(urlRef.current.before);
      if (urlRef.current.after) URL.revokeObjectURL(urlRef.current.after);
      urlRef.current = { before: URL.createObjectURL(f) };
      setFile(f);
      setBeforeUrl(urlRef.current.before ?? null);
      setAfterUrl(null);
      setReport(null);
      setSplit(50);
      setZoom(null);
    },
    [toast]
  );

  useEffect(() => {
    if (!beforeUrl) {
      setDims(null);
      return;
    }
    const img = new window.Image();
    img.onload = () => setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = beforeUrl;
  }, [beforeUrl]);

  useEffect(() => {
    if (!processing) return;
    setElapsed(0);
    const t0 = performance.now();
    const iv = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    return () => clearInterval(iv);
  }, [processing]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0];
      if (f && f.type.startsWith("image/")) applyFile(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [applyFile]);

  const clearFile = () => {
    revokeAll();
    setFile(null);
    setBeforeUrl(null);
    setAfterUrl(null);
    setReport(null);
    setDims(null);
  };

  const restore = async () => {
    if (!file || processing) return;
    setProcessing(true);
    setReport(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("mode", mode);
      fd.append("strength", String(strength));
      fd.append("upscale", String(upscale));
      fd.append("format", format);
      const res = await fetch("/api/enhance", { method: "POST", body: fd });
      if (!res.ok) {
        let msg = `Processing failed (HTTP ${res.status}).`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      const repRaw = res.headers.get("X-Process-Report");
      const rep: EnhanceReport | null = repRaw ? JSON.parse(decodeURIComponent(repRaw)) : null;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (urlRef.current.after) URL.revokeObjectURL(urlRef.current.after);
      urlRef.current.after = url;
      setAfterUrl(url);
      setReport(rep);
      setSplit(50);
      const total = rep ? (rep.steps.reduce((a, s) => a + s.ms, 0) / 1000).toFixed(1) : "?";
      toast({ title: "Restoration complete", description: `${total}s · ${rep?.analysis.decision ?? ""}` });
    } catch (e) {
      toast({
        title: "Could not restore image",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const download = () => {
    if (!afterUrl || !file) return;
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    const a = document.createElement("a");
    a.href = afterUrl;
    a.download = `${base}-restored.${EXT[format]}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const loadSample = async (kind: "pixelated" | "blurred") => {
    try {
      const res = await fetch(`/api/sample?kind=${kind}`);
      if (!res.ok) throw new Error("sample fetch failed");
      const blob = await res.blob();
      applyFile(new File([blob], `sample-${kind}.png`, { type: "image/png" }));
    } catch {
      toast({ title: "Could not load the sample image.", variant: "destructive" });
    }
  };

  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(elapsed / 1.2))];
  const totalMs = report ? report.steps.reduce((a, s) => a + s.ms, 0) : 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0e13] text-zinc-100">
      {/* ---------- header ---------- */}
      <header className="border-b border-white/10 bg-[#0b0e13]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/20">
            <Wand2 className="h-5 w-5 text-emerald-950" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-bold leading-tight tracking-tight sm:text-lg">
              PixelRevive
            </h1>
            <p className="text-[11px] text-zinc-400 sm:text-xs">
              Depixelate · Unblur · Enhance — reconstruction studio
            </p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300 sm:flex">
            <Zap className="h-3 w-3" aria-hidden="true" /> Local in-memory processing
          </span>
        </div>
      </header>

      {/* ---------- main ---------- */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          {/* ===== controls ===== */}
          <aside className="space-y-4">
            {/* image input */}
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4" aria-label="Image source">
              <Label className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Image
              </Label>
              {!file || !beforeUrl ? (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload an image — click, drag & drop, or paste from clipboard"
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) applyFile(f);
                  }}
                  className={`flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
                    dragOver
                      ? "border-emerald-400 bg-emerald-400/10"
                      : "border-white/15 hover:border-emerald-400/50 hover:bg-white/[0.04]"
                  }`}
                >
                  <ImagePlus className="h-8 w-8 text-zinc-400" aria-hidden="true" />
                  <p className="text-sm font-medium">Drop an image, click, or paste</p>
                  <p className="text-xs text-zinc-500">PNG · JPEG · WebP · up to 25 MB</p>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
                  <img
                    src={beforeUrl}
                    alt="Selected image preview"
                    className="h-12 w-12 rounded-md object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-zinc-500">
                      {dims ? `${dims.w} × ${dims.h} px · ` : ""}
                      {fmtBytes(file.size)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove image"
                    onClick={clearFile}
                    className="h-8 w-8 text-zinc-400 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label="Choose image file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) applyFile(f);
                  e.target.value = "";
                }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500">Try a sample:</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-white/15 px-2.5 text-xs hover:bg-white/10"
                  onClick={() => loadSample("pixelated")}
                >
                  Pixelated
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-white/15 px-2.5 text-xs hover:bg-white/10"
                  onClick={() => loadSample("blurred")}
                >
                  Blurred
                </Button>
              </div>
            </section>

            {/* mode */}
            <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4" aria-label="Restoration mode">
              <Label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Restoration mode
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((m) => {
                  const Icon = m.icon;
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMode(m.id)}
                      className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-all ${
                        active
                          ? "border-emerald-400/70 bg-emerald-400/10 shadow-sm shadow-emerald-500/10"
                          : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.05]"
                      }`}
                    >
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-emerald-300" : "text-zinc-400"}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className={`block text-sm font-semibold ${active ? "text-emerald-200" : ""}`}>
                          {m.label}
                        </span>
                        <span className="block truncate text-[11px] text-zinc-500">{m.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* parameters */}
            <section className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4" aria-label="Parameters">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Strength
                  </Label>
                  <span className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-0.5 text-xs font-semibold text-emerald-300">
                    {strength}
                  </span>
                </div>
                <Slider
                  value={[strength]}
                  onValueChange={(v) => setStrength(v[0] ?? 60)}
                  min={0}
                  max={100}
                  step={1}
                  aria-label="Processing strength"
                />
                <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                  <span>gentle</span>
                  <span>aggressive</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Upscale
                  </Label>
                  <Select value={String(upscale)} onValueChange={(v) => setUpscale(Number(v))}>
                    <SelectTrigger aria-label="Upscale factor" className="border-white/10 bg-white/[0.04]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1× — keep size</SelectItem>
                      <SelectItem value="2">2× — double</SelectItem>
                      <SelectItem value="4">4× — quadruple</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Format
                  </Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as OutputFormat)}>
                    <SelectTrigger aria-label="Output format" className="border-white/10 bg-white/[0.04]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="png">PNG — lossless</SelectItem>
                      <SelectItem value="jpeg">JPEG — small</SelectItem>
                      <SelectItem value="webp">WebP — smallest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <Button
              size="lg"
              disabled={!file || processing}
              onClick={restore}
              className="h-12 w-full bg-emerald-500 text-base font-bold text-emerald-950 shadow-lg shadow-emerald-500/25 transition-all hover:bg-emerald-400 disabled:opacity-40"
            >
              {processing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" /> Restoring…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-5 w-5" aria-hidden="true" /> Restore image
                </>
              )}
            </Button>

            {/* engine report */}
            {report && (
              <motion.section
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                aria-label="Engine report"
              >
                <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-300">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
                  {report.analysis.decision}
                </p>
                <div className="mt-3 space-y-1">
                  {report.steps.map((s) => (
                    <div key={s.name} className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-zinc-500">{s.name}</span>
                      <span className="text-zinc-400">{s.ms} ms</span>
                    </div>
                  ))}
                </div>
                {report.notes.length > 0 && (
                  <ul className="mt-2 space-y-1 border-t border-white/10 pt-2">
                    {report.notes.map((n, i) => (
                      <li key={i} className="text-[11px] leading-snug text-zinc-500">
                        • {n}
                      </li>
                    ))}
                  </ul>
                )}
              </motion.section>
            )}
          </aside>

          {/* ===== viewer ===== */}
          <section className="flex min-w-0 flex-col gap-4" aria-label="Image viewer">
            <div className="relative h-[min(62vh,640px)] overflow-auto rounded-xl border border-white/10 bg-[#0d1016]">
              {!beforeUrl ? (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <ImagePlus className="h-10 w-10 text-zinc-500" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-300">Nothing loaded yet</p>
                    <p className="mt-1 max-w-sm text-sm text-zinc-500">
                      Drop a pixelated or blurry image on the left — or load a sample and watch the
                      reconstruction happen live.
                    </p>
                  </div>
                </div>
              ) : afterUrl ? (
                <div
                  className={zoom == null ? "h-full w-full" : "flex min-h-full min-w-full"}
                  style={zoom == null ? undefined : { height: (dims?.h ?? 0) * zoom }}
                >
                  <div
                    className={zoom == null ? "h-full w-full" : "m-auto"}
                    style={zoom == null ? undefined : { width: (dims?.w ?? 0) * zoom, height: (dims?.h ?? 0) * zoom }}
                  >
                    <ComparisonSlider
                      beforeUrl={beforeUrl}
                      afterUrl={afterUrl}
                      split={split}
                      onSplitChange={setSplit}
                      beforeAlt="Original image"
                      afterAlt="Restored image"
                    />
                  </div>
                </div>
              ) : (
                <div className="relative h-full w-full">
                  <img
                    src={beforeUrl}
                    alt="Original image awaiting restoration"
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                  <span className="absolute left-3 top-3 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-semibold tracking-wider text-white/90 backdrop-blur">
                    BEFORE
                  </span>
                </div>
              )}

              {processing && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-[3px]">
                  <Loader2 className="h-9 w-9 animate-spin text-emerald-300" aria-hidden="true" />
                  <p className="text-sm font-medium text-zinc-200">{stage}</p>
                  <p className="font-mono text-xs text-zinc-400">{elapsed.toFixed(1)}s</p>
                  <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-400" />
                  </div>
                </div>
              )}
            </div>

            {/* viewer toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              {dims && afterUrl && (
                <div className="flex overflow-hidden rounded-lg border border-white/10" role="group" aria-label="Zoom level">
                  {[
                    { label: "Fit", v: null },
                    { label: "1:1", v: 1 },
                    { label: "2×", v: 2 },
                  ].map((z) => (
                    <button
                      key={z.label}
                      type="button"
                      aria-pressed={zoom === z.v}
                      onClick={() => setZoom(z.v)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        zoom === z.v
                          ? "bg-emerald-500/20 text-emerald-200"
                          : "bg-white/[0.02] text-zinc-400 hover:bg-white/[0.06]"
                      }`}
                    >
                      {z.label}
                    </button>
                  ))}
                </div>
              )}
              {afterUrl && (
                <button
                  type="button"
                  onClick={() => setSplit(50)}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-white/[0.06]"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Re-center divider
                </button>
              )}
              <span className="hidden text-[11px] text-zinc-600 sm:block">
                {afterUrl ? "Drag the divider — or focus it and use ← → keys" : "Upload an image to begin"}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {afterUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearFile}
                    className="h-9 border-white/15 text-xs hover:bg-white/10"
                  >
                    Clear
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={download}
                  disabled={!afterUrl}
                  className="h-9 bg-emerald-500 px-4 text-xs font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-40"
                >
                  <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Download{format === "jpeg" ? " JPG" : ` ${format.toUpperCase()}`}
                </Button>
              </div>
            </div>

            {/* metrics */}
            {report && afterUrl && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-2 gap-3 lg:grid-cols-4"
              >
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    <Activity className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Detail energy
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-zinc-200">
                    {report.metrics.detailBefore.toFixed(1)} → {report.metrics.detailAfter.toFixed(1)}
                  </p>
                  <p
                    className={`text-xs font-medium ${
                      report.metrics.detailGainPct >= 0 ? "text-emerald-300" : "text-amber-400"
                    }`}
                  >
                    {report.metrics.detailGainPct >= 0 ? "+" : ""}
                    {report.metrics.detailGainPct}% at original scale
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    <Grid3x3 className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Pixelation
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-zinc-200">
                    {Math.round(report.metrics.pixelStrengthBefore * 100)}% →{" "}
                    {Math.round(report.metrics.pixelStrengthAfter * 100)}%
                  </p>
                  <p className="text-xs text-zinc-500">
                    {report.analysis.pixelBlock > 0
                      ? `grid: ~${report.analysis.pixelBlock}px blocks`
                      : "no grid detected"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    <Clock className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Engine time
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-zinc-200">
                    {(totalMs / 1000).toFixed(2)} s
                  </p>
                  <p className="text-xs text-zinc-500">{report.steps.length} pipeline steps</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    <Zap className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Output
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-zinc-200">
                    {report.output.width} × {report.output.height}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {report.output.scale}× scale · {report.output.format.toUpperCase()}
                  </p>
                </div>
              </motion.div>
            )}
          </section>
        </div>
      </main>

      {/* ---------- footer ---------- */}
      <footer className="mt-auto border-t border-white/10 bg-[#0b0e13]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
          <p className="max-w-3xl text-[11px] leading-relaxed text-zinc-500">
            PixelRevive rebuilds plausible detail from degraded images using deconvolution and
            edge-aware super-sampling. Honest physics: no software can recover{" "}
            <span className="text-zinc-300">100%</span> of information truly destroyed by heavy
            pixelation — results are best-effort reconstructions, and tools claiming perfection are
            overstating.
          </p>
          <p className="text-[11px] text-zinc-600 sm:ml-auto sm:shrink-0">
            Images stay in memory · nothing is stored
          </p>
        </div>
      </footer>
    </div>
  );
}
