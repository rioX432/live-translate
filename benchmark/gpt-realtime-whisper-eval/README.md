# GPT-Realtime-Whisper Evaluation Bench

Scaffold for Issue [#698](https://github.com/rioX432/live-translate/issues/698):
evaluate the cloud streaming model `gpt-realtime-whisper` (OpenAI, released
2026-05-07) against the offline STT engines that already power live-translate.

The bench is intentionally separated from the cross-engine STT runner under
`benchmark/run.ts` because gpt-realtime-whisper requires a paid API key, a live
WebSocket connection, and a different audio format (24 kHz PCM16 vs the
16 kHz fixtures used elsewhere). Keeping it in its own folder makes it easy to
skip in CI and keeps the cost story isolated.

## Why we need this bench

Live-translate's Core Value #1 is **offline-by-default translation**. Cloud
STT is therefore opt-in only — but if its Japanese accuracy is dramatically
better than the best local engine, it may still be worth wiring as an optional
boost (parallel to the Microsoft Translator / Google Translate rotation
already supported on the translation side).

Per the Phase 3 decision gate in #698:

- If `JA CER(gpt-realtime-whisper) >= best_local_CER - 2.0pp` (i.e. less than
  2 percentage points of improvement) → **won't-do**, close the issue.
- Otherwise → **design** an opt-in cloud STT mode in a follow-up issue.

## What this bench measures

| Metric | Why |
|---|---|
| JA CER | The decision gate metric. Computed via the existing `wer.ts` utility so the number is directly comparable to other engine baselines. |
| EN WER | Sanity check that the cloud path is not worse on EN. |
| TTFD (time-to-first-delta) | Per OpenAI's documentation, gpt-realtime-whisper streams partial transcripts. TTFD is the more useful real-time metric than `total_ms`. |
| Total wall-clock per clip | End-to-end latency reference. |
| Projected monthly USD | 4 h/day x 22 days/month at the documented $0.017/min price. |

## Prerequisites

1. **API key**: `OPENAI_API_KEY` env var. Without it the runner logs a clean
   skip message and exits 0 so it can live in CI without flaking.
2. **Test audio**: the same 16 kHz mono WAV fixtures used by the other STT
   engines. Generate them from `benchmark/`:
   ```bash
   npm run stt:generate-testset
   ```
   This populates `benchmark/testset/stt-audio/` (gitignored, ~3 MB).
3. **Node 22+ / Electron 33+** — the runner uses the platform `WebSocket`
   constructor (no extra dependency).

### Audio data sources for extension

The bundled manifest under `benchmark/testset/stt-manifest.jsonl` is the
authoritative fixture set for all STT engines in this repo. To strengthen the
JA evaluation beyond the bundled 20 clips, two public corpora are recommended:

| Corpus | License | Notes |
|---|---|---|
| [Common Voice 17 (ja)](https://commonvoice.mozilla.org/ja/datasets) | CC0 | Read speech, varied speakers; good for CER baseline. |
| [ReazonSpeech v2 small](https://research.reazon.jp/projects/ReazonSpeech/) | CDLA-Sharing | Spontaneous TV speech; closer to live-translate's real workload. |

If you add new audio, append entries to `stt-manifest.jsonl` with
`language: "ja"` and the same `domain` taxonomy
(`casual`/`business`/`technical`) so the existing per-domain breakdown
keeps working.

## Run

```bash
cd benchmark
OPENAI_API_KEY=sk-... npx tsx --expose-gc \
  gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts

# JA only
OPENAI_API_KEY=sk-... npx tsx --expose-gc \
  gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts --language ja

# Try the lowest-latency tier
OPENAI_API_KEY=sk-... npx tsx --expose-gc \
  gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts --latency minimal

# Quick smoke (first 5 clips)
OPENAI_API_KEY=sk-... npx tsx --expose-gc \
  gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts --limit 5
```

## Output

Results land in `gpt-realtime-whisper-eval/results/` (gitignored):

- `gpt-realtime-whisper-<tier>-<ts>.json` — raw per-clip results
- `gpt-realtime-whisper-<tier>-<ts>.md` — summary table with cost projection

Paste the contents of the markdown report into `RESULTS.md` along with the
local-engine numbers it should be compared against, then make the Phase 3
decision.

## Caveats

- **Linear resampling 16k → 24k** is used because the Realtime endpoint
  requires 24 kHz input. This may slightly affect absolute accuracy compared
  to native 24 kHz recordings, but since every cloud call sees the same
  resampled signal, the **comparison across cloud runs is internally
  consistent**. If you want to compare cloud-vs-local *exactly* on the same
  signal, run the local engines on the same resampled WAV files (out of scope
  for the current scaffold).
- **No streaming-partial chunk timing**: we measure TTFD relative to a single
  `input_audio_buffer.commit` event. The runner does not yet simulate
  real-time microphone chunking; if we need streaming-relative latency
  numbers, extend the runner to send PCM in ~100 ms increments and timestamp
  each `delta`.
- **`gpt-realtime-whisper` is a successor to whisper-1**, not the same as
  `gpt-4o-transcribe`. Do not conflate the two when reading external
  benchmarks.

## Implementation notes

- `realtime-client.ts` — WebSocket-based session implementation. The
  `buildSessionUpdate` function is exported and unit-tested so the documented
  schema can change without touching the runner.
- `audio.ts` — local WAV reader + linear resampler. No ffmpeg dependency.
- `cost.ts` — pure helpers for the monthly USD projection.
- `bench-gpt-realtime-whisper.ts` — CLI runner; emits the JSON/MD reports.

All TypeScript files type-check via the existing `benchmark/tsconfig.json`,
and all unit tests run under the root `vitest` config.
