# Conversational JA<->EN Translation Benchmark

Compares the four translator engines on conversational tech-meeting utterances:

| Engine | Adapter | Notes |
|--------|---------|-------|
| LFM2 | `../src/engines/` (not yet wired) | Tier 1 candidate; pending dedicated adapter |
| HY-MT1.5 1.8B | `../src/engines/hunyuan-mt-15.ts` | Current default |
| Hunyuan-MT 7B | `../src/engines/hunyuan-mt.ts` | Quality default |
| Microsoft Translator (Azure) | `../src/engines/microsoft.ts` | Online rotation reference |

## Why a Conversational Set?

The current promotion of HY-MT1.5 to default is grounded in FLORES-200 numbers,
which use written (not spoken) sentences. JA<->EN meeting subtitles are the
core use case of live-translate, so we want spoken-style data to verify the
ranking. See issue #706 for the full rationale.

## Dataset

- `data/utterances.json` — 25 utterances (15 JA, 10 EN) representative of public
  tech-conference talks (DroidKaigi 2025, RubyKaigi 2025, Kaigi on Rails 2025)
- `data/reference-translations.json` — human reference translation per utterance

### Data Ethics

The dataset entries are **representative paraphrases inspired by the public
themes of the cited conferences**, not verbatim quotes of any specific talk.
The `source_inspiration` field on each utterance links to the conference site
that informed the wording. References are original human translations authored
by the live-translate project for benchmarking.

This conservative framing avoids unverified attribution to specific speakers
while still grounding the dataset in real conference discourse. If you want to
extend the dataset with verbatim quotes, please verify each excerpt against the
official conference video/transcript and update `source_kind` to
`verbatim-quote` with a direct URL.

The dataset is small (25 sentences) by design — it is a complement to the
existing 100-sentence `../testset/ja-en-100.jsonl`, not a replacement.

## Metrics

- **Quality (chrF)** — character n-gram F-score (sacreBLEU defaults: n=6,
  beta=2). chrF is reported in the 0-100 range. Higher is better.
- **Latency** — wall-clock latency per sentence; p50 / p95 / p99 are reported.
- **Subjective score (manual)** — `results/conversational-human-eval-*.csv`
  contains the first 10 sentences with each engine's output side-by-side for
  manual 1-5 scoring.

> **Why chrF, not COMET-22?**
> Issue #706 specifies COMET-22 (Unbabel/wmt22-comet-da, ~600MB ONNX) as the
> target quality metric. The official Unbabel COMET implementation is
> PyTorch-only today, and a stable Node.js ONNX inference path is not yet
> available. We use chrF as a tractable proxy and have left a TODO in
> `metrics.ts` to swap in COMET-22 once the inference pipeline lands.
> `RESULTS.md` makes the limitation explicit so future readings of the numbers
> are not confused.

## Prerequisites

```bash
cd benchmark
npm install
```

Model files for local engines (downloaded once into `../models/`):

```bash
# HY-MT1.5 1.8B (~1 GB)
huggingface-cli download tencent/HY-MT1.5-GGUF \
  HY-MT1.5-1.8B-Q4_K_M.gguf \
  --local-dir models

# Hunyuan-MT 7B (~4 GB)
huggingface-cli download tencent/Hunyuan-MT-GGUF \
  Hunyuan-MT-7B-q4_k_m.gguf \
  --local-dir models
```

For Microsoft Translator, set either of:

```bash
# Preferred (named for the new conversational bench):
export MICROSOFT_TRANSLATOR_KEY=...
export MICROSOFT_TRANSLATOR_REGION=japaneast

# Compatible (same keys as benchmark/src/engines/microsoft.ts):
export AZURE_TRANSLATOR_KEY=...
export AZURE_TRANSLATOR_REGION=japaneast
```

If a key is missing, the Microsoft engine is **skipped gracefully** rather
than failing the run.

## Run

```bash
cd benchmark

# Run all available engines, both directions
npx tsx --expose-gc conversational-ja-en/bench-translators.ts

# Run a subset
npx tsx --expose-gc conversational-ja-en/bench-translators.ts \
  --engines hunyuan-mt-15,microsoft

# Run a single direction
npx tsx --expose-gc conversational-ja-en/bench-translators.ts \
  --direction ja-en
```

## Output

Results land in `conversational-ja-en/results/` (gitignored via the project
`.gitignore`):

- `conversational-ja-en-<ts>.json` — raw per-sentence results
- `conversational-ja-en-<ts>.md` — summary table
- `conversational-human-eval-<ts>.csv` — 10-sentence subjective scoring sheet

## Future Work

- Wire an `LFM2Bench` adapter under `benchmark/src/engines/lfm2.ts` so the
  Tier 1 candidate can be evaluated alongside the others. The current bench
  script lists `lfm2` in the engine catalog but emits a clear "not yet wired"
  warning and skips it.
- Replace chrF with COMET-22 once an ONNX or pure-JS inference path is
  validated. Track via the TODO in `metrics.ts`.
- Grow the dataset beyond 25 utterances if statistical significance becomes a
  concern. Per the issue, this benchmark is intentionally a small,
  fast-to-run quality sanity check, not a full WMT24++ reproduction.
