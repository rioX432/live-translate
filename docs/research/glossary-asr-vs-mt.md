# Glossary terms: ASR stage vs translation stage

**Decision:** apply the glossary at both stages by default — Qwen3-ASR context,
alias replacement on the transcript, and the terms in the Hy-MT2 prompt
(condition d3 below). It is the only condition that got every term right in
both the transcript and the translation on held-out sentences (22/22 and
22/22), for about +40 ms of ASR time per utterance. The cost is that look-alike
ordinary words can be pulled toward a term (1 of 12 control utterances).

## Question

A user registers a term (for example アビィ → Avvy). Where should the app use it?

- **ASR stage**
  - Give the terms to Qwen3-ASR as context, so it spells them correctly.
  - Rewrite known misrecognitions ("Heard as" aliases) in the transcript.
- **Translation stage:** list the terms that occur in the sentence in the
  Hy-MT2 prompt (`Reference the following translations:` in the official
  template).

A translation-stage glossary cannot help when ASR never wrote the term, because
the prompt only lists terms found in the transcript.

## Setup

| Item | Value |
|---|---|
| Machine | Apple M3 Pro, 36 GB, macOS 26.7.2 |
| ASR | Qwen3-ASR 0.6B 8-bit MLX through the resident Swift helper (the product helper, built with `scripts/build-qwen3-asr-helper.sh`) |
| MT | Hy-MT2 1.8B Q4_K_M through node-llama-cpp, `buildHyMt2Prompt` and `HY_MT2_INFERENCE_PARAMS` (greedy) |
| Audio | Synthetic only: macOS `say` (Kyoko for ja, Samantha for en), 16 kHz mono |
| Code paths | `term-correction.ts` (context and alias replacement) and `hy-mt2-prompt.ts`, the same functions the app calls |

### Data (`benchmark/glossary/data/`)

- `sentences.json` holds 12 invented terms, each with a Japanese and an English
  form, and a glossary of 24 entries (both directions).
- Utterances come in three sets:

  | Set | Utterances | Term occurrences | Use |
  |---|---|---|---|
  | teach | 24 | 35 | Aliases are taken from ASR output on this set |
  | test | 18 | 22 | Held out: the same terms in new sentences |
  | control | 12 | — | No terms, but look-alike words (アビーロード, Selenium) |

- `aliases.json` holds the spellings Qwen3-ASR produced on the teach set, as a
  user would register them after seeing them. The test and control sets were
  never used to choose aliases.

### Conditions

| | ASR context | Alias replacement | MT prompt terms |
|---|---|---|---|
| (a) none | | | |
| (b1) | ✓ | | |
| (b2) | | ✓ | |
| (b3) | ✓ | ✓ | |
| (c) | | | ✓ |
| (d1) | ✓ | | ✓ |
| (d2) | | ✓ | ✓ |
| (d3) | ✓ | ✓ | ✓ |

### Metrics

- **Term accuracy:** the share of expected term occurrences found in the
  transcript (source) and in the translation. Matching is case-insensitive
  substring.
- **False replacement:** the number of utterances where a glossary term appears
  that the reference does not contain.
- **Added latency:**
  - ASR: per-utterance median of (with context − without). The two runs
    alternate per utterance.
  - MT: median of (with terms − without), with the order alternated, because
    the session reuses the previous prompt's tokens.
  - Alias replacement: median time of `correctTranscript`.

## Results

### Term accuracy (source / translation)

| Condition | teach | test (held out) |
|---|---|---|
| (a) none | 19/35 (54%) / 8/35 (23%) | 9/22 (41%) / 7/22 (32%) |
| (b1) ASR context | 28/35 (80%) / 14/35 (40%) | 19/22 (86%) / 9/22 (41%) |
| (b2) alias replacement | 34/35 (97%) / 13/35 (37%) | 15/22 (68%) / 9/22 (41%) |
| (b3) context + aliases | 32/35 (91%) / 16/35 (46%) | 22/22 (100%) / 12/22 (55%) |
| (c) MT prompt terms | 19/35 (54%) / 18/35 (51%) | 9/22 (41%) / 9/22 (41%) |
| (d1) context + MT terms | 28/35 (80%) / 30/35 (86%) | 19/22 (86%) / 18/22 (82%) |
| (d2) aliases + MT terms | 34/35 (97%) / 34/35 (97%) | 15/22 (68%) / 15/22 (68%) |
| **(d3) all** | 32/35 (91%) / 34/35 (97%) | **22/22 (100%) / 22/22 (100%)** |

- **The stages need each other.** The ASR stage gets the term into the
  transcript, and the MT stage translates it as registered. Either one alone
  stays at or below 55% translation accuracy on the test set.
- **On the test set, context helps more than aliases** (86% vs 68%), because
  aliases only cover misrecognitions already seen. Together they reach 100%.
- **On the teach set, (b3) is lower than (b2)** on source terms (91% vs 97%).
  With context, Qwen3-ASR sometimes writes the Latin "Avvy" inside a Japanese
  sentence where the reference expects アビィ. The translation is still correct
  (97% for both d2 and d3).

### False replacements

| Condition | teach | test | control |
|---|---|---|---|
| (a), (c) | 0/24 | 0/18 | 0/12 |
| Every condition with ASR context or aliases | 0/24 | 0/18 | 1/12 |

The one case is control-ja-01, 「アビーロードのレコード…」.

- The context makes Qwen3-ASR write アビィロード, and the alias アビー rewrites it
  the same way. Hy-MT2 then translates it as "Avvy Road".
- Removing the alias does not fix it, because the context alone causes it
  (b1).
- The MT stage alone never caused a false replacement, since it only acts on
  terms already in the transcript.

### Transcript error rate (CER for ja, WER for en; punctuation and case ignored)

| Set | none | context | aliases | context + aliases |
|---|---|---|---|---|
| test ja | 7.5% | 5.1% | 2.8% | 1.2% |
| test en | 14.3% | 0.0% | 11.9% | 0.0% |
| control ja | 1.4% | 3.5% | 2.1% | 3.5% |
| control en | 0.0% | 0.0% | 0.0% | 0.0% |

The context costs a little on Japanese sentences without terms. Besides the
アビーロード case, it changed 受け付で to 受け付けて (the reference is 受付で)
and added a space after ミルクティー.

### Added latency (medians)

| Step | Without | With | Added |
|---|---|---|---|
| ASR context (per utterance) | 216 ms | 261 ms | +40 ms |
| MT prompt terms, all requests | 270 ms | 285 ms | +1 ms |
| MT prompt terms, only the 19 requests where terms were injected | 305 ms | 299 ms | +3 ms (noise) |
| Alias replacement | — | — | 22 µs |

The ASR context is the only step with a cost worth noting. The app caps it at
60 terms (`MAX_ASR_CONTEXT_TERMS`) because every term is prefilled on each
request.

## Why (d3) is the default

- It is the only condition at 100% on held-out sentences at both stages.
- The added latency is about 40 ms on a ~220 ms ASR step, and the translation
  stage costs nothing measurable.
- The false-replacement risk only exists for words that sound like a
  registered term. The user can see the result and edit or remove the term in
  Settings, and the edit applies from the next sentence.

The ASR-stage options are not exposed in the UI. One setting per role follows
the project's "do not show engine choices" rule. A user who wants less
aggressive matching can remove the term's aliases.

## Limits

- **Synthetic speech.** `say` voices are clearer than meeting audio and have
  one speaker each. Real accents and crosstalk will lower every condition.
- **Small sample.** 57 term occurrences and 12 control utterances; one
  utterance moves a rate by 4–8 points. The results show direction, not a
  precise size.
- **Invented terms.** Real product names that resemble common words (or that
  Qwen3-ASR already knows) will behave differently.
- **Latency on one machine** (M3 Pro, GPU), with one run per condition.

## Reproduce

Run from the repository root. The scripts read only `benchmark/glossary/data/`.

```bash
python3 -I benchmark/glossary/synth.py <audio dir>
node_modules/.bin/esbuild benchmark/glossary/bench.ts --bundle --platform=node --format=esm \
  --target=node20 --external:node-llama-cpp --outfile=node_modules/.cache/glossary-bench/bench.mjs
node node_modules/.cache/glossary-bench/bench.mjs asr <helper binary> <Qwen3-ASR model dir> <audio dir> <out dir>
node node_modules/.cache/glossary-bench/bench.mjs mt <Hy-MT2 GGUF> <out dir>
node node_modules/.cache/glossary-bench/bench.mjs score <out dir>
```

`score` writes `metrics.json` and `metrics.md` to the output directory.
