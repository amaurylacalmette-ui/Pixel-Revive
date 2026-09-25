"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

interface ComparisonSliderProps {
  beforeUrl: string;
  afterUrl: string;
  split: number;
  onSplitChange: (v: number) => void;
  beforeAlt: string;
  afterAlt: string;
}

/**
 * Draggable before/after wipe viewer. The "after" image fills the frame and
 * the "before" image is clipped to the left of the divider via clip-path, so
 * both stay perfectly aligned regardless of zoom level.
 */
export function ComparisonSlider({
  beforeUrl,
  afterUrl,
  split,
  onSplitChange,
  beforeAlt,
  afterAlt,
}: ComparisonSliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const update = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
    onSplitChange(Math.min(100, Math.max(0, pct)));
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientX);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) update(e.clientX);
  };

  const stop = () => {
    dragging.current = false;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") {
      onSplitChange(Math.max(0, split - step));
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      onSplitChange(Math.min(100, split + step));
      e.preventDefault();
    }
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Before and after comparison — drag or use arrow keys"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split)}
      tabIndex={0}
      className="relative h-full w-full cursor-ew-resize touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={handleKeyDown}
    >
      <img
        src={afterUrl}
        alt={afterAlt}
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      >
        <img
          src={beforeUrl}
          alt={beforeAlt}
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
      </div>

      {/* divider */}
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${split}%` }}>
        <div className="absolute inset-y-0 -left-px w-0.5 bg-white/90 shadow-[0_0_12px_rgba(0,0,0,0.6)]" />
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-zinc-300/60 bg-white/95 p-1.5 shadow-lg backdrop-blur">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#18181b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3 4 7l4 4" />
            <path d="M4 7h16" />
            <path d="m16 21 4-4-4-4" />
            <path d="M20 17H4" />
          </svg>
        </div>
      </div>

      <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-semibold tracking-wider text-white/90 backdrop-blur">
        BEFORE
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-emerald-500/85 px-2 py-0.5 text-[11px] font-semibold tracking-wider text-emerald-950 backdrop-blur">
        AFTER
      </span>
    </div>
  );
}
