# Gemma 4 E2B/E4B JA↔EN Translation Evaluation Research

**Date**: 2026-04-09
**Issue**: #562
**Status**: Research only — implementation NOT started

---

## Summary

Gemma 4 was released on 2026-03-31 (Apache 2.0) with four variants: E2B, E4B, 26B-A4B (MoE), and 31B. The E2B and E4B are edge-optimized multimodal models with native audio/speech capability (a first for open models at this size). TranslateGemma — the dedicated translation fine-tune — remains Gemma 3-based as of research date with no Gemma 4 version announced.

**Key finding: No public JA↔EN translation benchmarks exist for Gemma 4 yet.** The blockers listed in #562 remain unresolved. Recommendation is to **wait** (reassess in ~4 weeks).

---

## Gemma 4 Variants — Specs

| Variant | Active Params | Architecture | GGUF Q4_K_M | Audio |
|---------|--------------|--------------|-------------|-------|
| E2B | 2.3B | Dense | ~3.1 GB | Yes (ASR + speech-to-translation) |
| E4B | ~4B | Dense | TBD | Yes |
| 26B-A4B | 3.8B active (26B total) | MoE (128 experts, 8+1 active) | ~16.8 GB | No |
| 31B | 31B | Dense | large | No |

> Note: The GGUF Q4_K_M for E2B is **3.11 GB** (not ~1.5 GB as estimated in the issue). The issue estimate appears to have been optimistic. For comparison: HY-MT1.5-1.8B is ~1 GB.

---

## GGUF Availability

All variants have GGUF quantizations via **unsloth** on HuggingFace:

- `unsloth/gemma-4-E2B-it-GGUF` — Q2 through BF16, Q4_K_M = 3.11 GB
- `unsloth/gemma-4-E4B-it-GGUF`
- `unsloth/gemma-4-26B-A4B-it-GGUF`
- `unsloth/gemma-4-31B-it-GGUF`

Unsloth Dynamic 2.0 (`UD-*`) variants also available with improved quantization accuracy.
Integration via existing `LlamaWorkerTranslator` extension is confirmed feasible.

---

## Translation Benchmarks

### Gemma 4 — Official Benchmarks

No JA↔EN translation benchmarks have been published by Google DeepMind or the community for Gemma 4. The model card reports:

| Metric | E2B | E4B | 26B-A4B | 31B |
|--------|-----|-----|---------|-----|
| MMMLU (multilingual reasoning) | 67.4% | 76.6% | 86.3% | 88.4% |
| CoVoST (speech translation, avg) | 33.47 | 35.54 | — | — |

CoVoST is an aggregate AST (automatic speech translation) score, not specific to JA↔EN. FLORES, WMT, BLEU, and COMET scores for Japanese pairs are **not published**.

Community reports (as of 2026-04-09): users testing German, Arabic, Vietnamese, French report Gemma 4 "outperforms Qwen 3.5 in non-English tasks" and makes TranslateGemma feel outdated, but no Japanese-specific data points have emerged.

### TranslateGemma (Gemma 3-based) — for reference

TranslateGemma was released 2026-01-15 (Gemma 3 base, 4B/12B/27B). This is the closest proxy for what a translation-tuned Gemma 4 might achieve.

**en→ja_JP MetricX (WMT24++, lower = better):**

| Model | MetricX |
|-------|---------|
| Gemma 3 27B (baseline) | 4.11 |
| TranslateGemma 27B | 3.53 |
| Gemma 3 12B (baseline) | 4.30 |
| TranslateGemma 12B | 3.82 |
| Gemma 3 4B (baseline) | 5.09 |
| TranslateGemma 4B | 4.44 |

**ja→en direction**: TranslateGemma shows a **regression vs Gemma 3 baseline** due to named entity mistranslation. This is the same failure mode reported for Gemma 3 in live-translate evaluations.

**WMT24++ overall (55 languages):**

| Metric | TG 4B | TG 12B | TG 27B |
|--------|-------|--------|--------|
| MetricX ↓ | 5.32 | 3.60 | 3.09 |
| COMET ↑ | 81.6 | 83.5 | 84.4 |

No WMT24++ per-language JA→EN table was published in the TranslateGemma technical report.

---

## Known Issues / Risks

1. **JA→EN named entity regression**: TranslateGemma (Gemma 3 base) regresses on ja→en specifically due to proper noun/named entity errors. This issue is documented in the technical report (arXiv:2601.09012) and consistent with prior live-translate evaluation notes. Likely to carry over to any Gemma 4-based translation fine-tune.

2. **E2B GGUF size**: Q4_K_M is 3.11 GB, significantly larger than the ~1.5 GB estimate in the issue. This exceeds HY-MT1.5-1.8B (~1 GB) and approaches HunyuanMT 7B territory for the Q4_K_M variant.

3. **No TranslateGemma Gemma 4 version**: TranslateGemma is still Gemma 3-based. No roadmap item for a Gemma 4 fine-tune. Community comment: "makes TranslateGemma feel outdated," but no release is announced.

4. **Text translation ≠ speech translation**: Gemma 4 E2B/E4B audio supports speech-to-translated-text (AST), but that requires audio input. In live-translate's pipeline (Whisper STT → translator), only the text translation capability is relevant unless we redesign the pipeline for end-to-end STT+MT with E2B.

5. **Latency unknown**: No community-measured latency for text translation via GGUF on Apple Silicon. The CoVoST AST pipeline would have different latency characteristics from text-only translation.

---

## Comparison with Current Engines

| Engine | JA→EN | Memory | Offline | Status |
|--------|-------|--------|---------|--------|
| HY-MT1.5-1.8B | ~180ms | ~1 GB | Yes | Default (fast) |
| OPUS-MT | ~279ms | ~0.98 GB | Yes | Legacy fallback |
| HunyuanMT 7B | 3.7s | ~4 GB | Yes | Quality mode |
| Gemma 4 E2B Q4_K_M | Unknown | ~3.1 GB | Yes | **Not evaluated** |
| TranslateGemma 4B | Unknown (text only) | ~3 GB | Yes | **Not in pipeline** |

Gemma 4 E2B at 3.11 GB Q4_K_M occupies a gap between HY-MT1.5-1.8B and HunyuanMT 7B in memory terms but offers no latency data yet. If quality turns out comparable to TranslateGemma 4B (COMET 81.6), it would be a modest improvement over OPUS-MT but likely inferior to HY-MT1.5-1.8B which was specifically optimized for this task.

---

## Recommendation: **WAIT**

### Criteria to unblock

- [ ] Community JA→EN translation quality reports for Gemma 4 (any variant)
- [ ] OR: TranslateGemma Gemma 4 base version released
- [ ] Confirmed latency on Apple Silicon (M-series) for text translation via GGUF

### Rationale

Both blockers from issue #562 remain unresolved:
1. No JA↔EN translation quality data for Gemma 4 exists (community or official)
2. No TranslateGemma Gemma 4 release announced

Additionally, the E2B GGUF is 2x larger than estimated (3.11 GB vs 1.5 GB), reducing the memory advantage over existing engines.

The ja→en named entity regression in TranslateGemma (Gemma 3) is a direct precedent concern — this failure mode is already a known problem in live-translate and would need to be specifically validated before any production use.

**Reassess**: ~4 weeks from release (early May 2026). By then community benchmarks for JA should be available, and if Google follows the pattern of Gemma 3 → TranslateGemma in ~10 months, a Gemma 4-based TranslateGemma would be further out.

---

## Sources

- Google DeepMind Gemma 4 model card: https://ai.google.dev/gemma/docs/core/model_card_4
- Gemma releases page: https://ai.google.dev/gemma/docs/releases
- unsloth/gemma-4-E2B-it-GGUF: https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF
- TranslateGemma HuggingFace (4B): https://huggingface.co/google/translategemma-4b-it
- TranslateGemma technical report: https://arxiv.org/abs/2601.09012
- TranslateGemma analysis (lhl): https://github.com/lhl/realitycheck-data/blob/main/analysis/sources/google-2026-translategemma-tech-report.md
- Gemma 4 community 24h review: https://dev.to/dentity007/-gemma-4-after-24-hours-what-the-community-found-vs-what-google-promised-3a2f
- TranslateGemma blog (Google): https://blog.google/innovation-and-ai/technology/developers-tools/translategemma/
