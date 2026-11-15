# Shadow measurement harness (dev only) — #730

Runs the JA⇄EN audio testset through the local cascade (whisper.cpp + HY-MT1.5) and
writes a `ShadowReport` (latency p50/p95, first-subtitle latency, revision stability,
busy/error rates). Refused in packaged builds (`!app.isPackaged`).

The cloud realtime paths this harness used to measure were removed with the move to a
local-only pipeline; see `docs/research/local-only-removed-cloud.md` for how to read
that code from Git history.

## Running

```bash
npm run shadow:ja-en           # cascade only, no network access beyond model download
```

The app opens no windows and quits when the report is written.

| Env var | Default | Meaning |
|---|---|---|
| `LT_SHADOW_JA_EN` | — | `1` enables the harness (set by the npm scripts) |
| `LT_SHADOW_LIMIT` | all | Measure only the first N utterances (smoke runs) |
| `LT_SHADOW_OUT` | `benchmark/results/shadow-ja-en.json` | Report path |

## Prerequisites

The audio testset (`benchmark/testset/stt-audio/`) is gitignored. Regenerate it with
`npm run bench:stt:generate` if it is missing.

## Why it runs inside Electron

The cascade's real engines need `utilityProcess` (the shared slm-worker pool) and
`app.getPath('userData')` (model resolution). The `benchmark/` package runs under
plain tsx and keeps its own separate copies of the engines — measuring those would
prove nothing about the code that actually ships.

## Gotchas found by running it

- **The STT variant must be bilingual.** `WhisperLocalEngine`'s own default is
  kotoba-whisper-v2.0, which is JA-only and returns nothing for English — it
  silently zeroes out half of a JA⇄EN comparison. The harness defaults to
  `large-v3-turbo`.
- **Both paths are warmed before measuring.** Lazy model load and Metal shader
  compilation otherwise land entirely on the first utterance (measured: 16.3s vs a
  2.2s steady-state median), producing a p95 that describes startup, not the path.
- **A thank-you phrase spoken on its own is kept.** `filterWhisperHallucination`
  no longer drops greetings and thanks, since they are real meeting turns; audio
  too quiet to be speech is rejected by the energy gate before STT instead.
