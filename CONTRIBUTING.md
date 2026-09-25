# Contributing to PixelRevive

Thanks for your interest in improving PixelRevive! Contributions are welcome —
bug fixes, new restoration algorithms, UI polish, and documentation are all
fair game.

## Getting started

```bash
git clone https://github.com/<your-name>/pixelrevive.git
cd pixelrevive
npm install
npm run dev
```

Open http://localhost:3000 and you should see the studio UI.

## Project layout

```
src/
├── lib/
│   ├── algorithms.ts   # pure DSP kernels (no I/O) — the heart of the app
│   ├── pipeline.ts     # sharp orchestration + mode routing + report
│   └── types.ts        # shared types (EnhanceMode, EnhanceReport, ...)
├── app/
│   ├── page.tsx        # the studio UI (client component)
│   └── api/enhance/    # POST endpoint wrapping the pipeline
└── components/
    └── comparison-slider.tsx  # before/after wipe viewer
```

## Guidelines

- **Keep `algorithms.ts` pure.** No `sharp`, no DOM, no I/O — kernels take
  `Float32Array` buffers in and return buffers out. This keeps them unit-testable.
- **Mind the budget.** Restoration runs on a request thread. Any new pass
  should state its complexity and respect the existing megapixel gates
  (`RL_MAX_MP`, `BILATERAL_MAX_MP`) or add its own.
- **Be honest in the UI.** Don't promise "100% recovery" — pixelation and blur
  destroy information. Measure and report what improved instead.
- Run `npm run lint` and `npm run build` before opening a PR.

## Reporting bugs

Open an issue with: the input image (or a synthetic repro), the exact mode /
strength / upscale settings, the `X-Process-Report` header from the response
(visible in DevTools → Network), and what you expected vs. got.

## License

By contributing, you agree that your contributions will be licensed under the
MIT License that covers this project.
