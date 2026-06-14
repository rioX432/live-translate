# Conversational JA<->EN Benchmark Results

This file aggregates results from `bench-translators.ts` runs. Each entry
should cite the timestamped JSON / MD report under `results/` so the raw
data is reproducible.

## Methodology Notes

- **Dataset**: 25 utterances under `data/utterances.json`, 15 JA -> EN and
  10 EN -> JA. Representative paraphrases of public DroidKaigi 2025,
  RubyKaigi 2025, and Kaigi on Rails 2025 talk themes. See `README.md` for
  the full ethics statement.
- **Quality metric**: chrF (character n-gram F-score, 0-100). See "Open
  Items" below for the COMET-22 swap-in plan.
- **Latency**: wall-clock per-sentence, reported as p50 / p95 / p99.
  Includes the first call after `initialize()`, so cold-start cost is
  visible in p99 for local-LLM engines.
- **Subjective score**: 10-sample 1-5 manual rating sheet emitted as
  `conversational-human-eval-<ts>.csv` per run.

## Runs

> Populate this section after each bench run by pasting the contents of
> `results/conversational-ja-en-<timestamp>.md` and adding any human
> subjective notes.

### Pending: first reference run

No reference run has been executed in CI yet. To produce one:

```bash
cd benchmark
npx tsx --expose-gc conversational-ja-en/bench-translators.ts \
  --engines hunyuan-mt-15,hunyuan-mt
# add ,microsoft when AZURE/MICROSOFT_TRANSLATOR_KEY is available
```

## Open Items

- **COMET-22 integration** — The issue specifies COMET-22 as the quality
  metric. The Unbabel reference implementation is PyTorch-only, and no
  battle-tested Node.js ONNX path exists today. Until that lands we use
  chrF; see the TODO in `metrics.ts`. Track in a follow-up issue once a
  candidate ONNX export is verified.
- **LFM2 adapter** — `bench-translators.ts` lists `lfm2` in its engine
  catalog but the supporting bench adapter under `benchmark/src/engines/`
  is not yet implemented. Add `benchmark/src/engines/lfm2.ts` mirroring the
  existing app-side `LFM2Translator.ts` and the bench script will pick it
  up automatically.
- **Dataset growth** — 25 utterances is a sanity-check size; if we promote
  this benchmark to a gating signal for default-engine decisions, grow to
  ~100 utterances and re-run.
