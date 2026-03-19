# Translation Quality Benchmark

Standalone benchmark framework to compare translation engines: OPUS-MT vs TranslateGemma 4B vs Google Translate.

## Prerequisites

- Node.js 20+
- For Google Translate: `GOOGLE_TRANSLATE_API_KEY` env var
- For TranslateGemma: GGUF model file in `models/`

## Setup

```bash
cd benchmark
npm install
```

### TranslateGemma Model Download

```bash
# Option 1: huggingface-cli
huggingface-cli download google/translategemma-4b-it-GGUF \
  translategemma-4b-it-Q4_K_M.gguf \
  --local-dir models

# Option 2: wget
wget -P models/ https://huggingface.co/google/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it-Q4_K_M.gguf
```

## Usage

```bash
# Run all engines
npx tsx --expose-gc run.ts

# Run specific engines
npx tsx --expose-gc run.ts --engines google
npx tsx --expose-gc run.ts --engines opus-mt
npx tsx --expose-gc run.ts --engines translate-gemma
npx tsx --expose-gc run.ts --engines google,opus-mt

# Run specific direction only
npx tsx --expose-gc run.ts --engines google --direction ja-en
```

The `--expose-gc` flag enables accurate memory measurement via forced GC between runs.

## Output

Results are written to `results/` (gitignored):

- **`benchmark-<timestamp>.json`** — Raw results with per-sentence latency
- **`benchmark-<timestamp>.md`** — Markdown summary with comparison tables
- **`human-eval-<timestamp>.csv`** — Side-by-side outputs for manual quality scoring (1-5)

### Human Evaluation

Open the CSV in a spreadsheet. For each sentence, rate each engine's output on 1-5:

| Score | Meaning |
|---|---|
| 5 | Perfect or near-perfect translation |
| 4 | Minor issues but meaning is clear |
| 3 | Understandable but awkward |
| 2 | Partially correct, some meaning lost |
| 1 | Incorrect or unintelligible |

## Test Set

`testset/ja-en-100.jsonl` contains 100 sentence pairs:
- ~50 JA→EN, ~50 EN→JA
- Domains: casual (~34), business (~33), technical (~33)
- Lengths: short <20 chars (~34), medium 20-60 (~33), long 60+ (~33)
- Edge cases: proper nouns, numbers, keigo, code-switching
