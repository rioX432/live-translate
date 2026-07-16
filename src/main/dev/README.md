# Shadow measurement harness (dev only) — #730

Runs the JA⇄EN audio testset through the Local-first cascade and the cloud realtime
e2e path side by side, and writes a `ShadowReport` (latency p50/p95, first-subtitle
latency, cost, offline completeness, revision stability, busy/error rates).

This is the "第0歩" measurement: it exists so the investment decision between
cascade modernization (#725) and local e2e (#724) rests on measured numbers.

## Running

```bash
npm run shadow:ja-en           # cascade only, no API key needed, no cost
npm run shadow:ja-en:cloud     # + gpt-realtime-translate (BYOK — costs real money)
```

The app opens no windows and quits when the report is written.

| Env var | Default | Meaning |
|---|---|---|
| `LT_SHADOW_JA_EN` | — | `1` enables the harness (set by the npm scripts) |
| `LT_SHADOW_CLOUD` | — | `1` adds the cloud path. Requires `openaiApiKey` in settings |
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
- **`ありがとうございます` measures as an empty segment.** Production's
  `filterWhisperHallucination` drops thank-you phrases as Whisper hallucinations.
  The harness reproduces production behavior faithfully; this is not a harness bug.
