# Non-Autoregressive Translation (NAT) for Ultra-Low Latency

**Issue:** #620
**Date:** 2026-04-10
**Status:** Research complete — promising but high-risk frontier approach; no off-the-shelf JA-EN NAT models exist; recommend monitoring diffusion LLM progress (Mercury) as a more practical path

---

## 1. Summary

Non-Autoregressive Translation (NAT) generates all output tokens in parallel rather than sequentially, achieving 10-15x speedup over autoregressive (AR) models. Applied to live-translate's current fast default (HY-MT1.5-1.8B at ~180ms), NAT could theoretically reduce translation latency to ~12ms — effectively instant. However, NAT remains a research-stage technology with no production-ready JA-EN models available. The quality gap has narrowed significantly (0.2-0.64 BLEU points on well-resourced language pairs like EN-DE) but JA-EN presents unique challenges due to large word order differences.

A more practical near-term path may be diffusion-based LLMs (e.g., Mercury), which use parallel token generation with iterative refinement and have reached commercial scale in 2025-2026.

---

## 2. Background: Why NAT Matters for live-translate

| Current Engine | Latency | Approach |
|---|---|---|
| HY-MT1.5-1.8B (fast default) | ~180ms | Autoregressive |
| LFM2 (ultra-fast) | ~50ms | Autoregressive |
| Google Translate API | ~50-100ms (network) | Server-side |
| **NAT (theoretical)** | **~12ms** | **Parallel decoding** |

Autoregressive models generate tokens one-by-one, creating a latency floor proportional to output length. For a 20-token Japanese sentence, even fast AR models must perform 20 sequential forward passes. NAT performs a single forward pass for all tokens simultaneously, removing the output-length dependency.

---

## 3. NAT Architecture Overview

### 3.1 Core Approaches

| Approach | Mechanism | Speed | Quality (WMT14 EN-DE BLEU) |
|---|---|---|---|
| **Fully Non-Autoregressive** | Single forward pass, all tokens in parallel | 15x AR | 25-27 (vs AR ~29) |
| **Iterative Refinement (CMLM)** | Multiple passes (~4-10), refine masked tokens | 5-10x AR | 27-28 |
| **CTC-based** | Connectionist Temporal Classification alignment | 10-15x AR | 27-30 |
| **Diffusion-based** | Iterative denoising of full sequence | 3-10x AR | Approaching AR parity |

### 3.2 Key Challenges

**Multi-modality problem:** Multiple valid translations exist for any source sentence. AR models handle this naturally (each token conditions on all previous tokens), but NAT tokens are generated independently, leading to incoherent outputs where different parts of the sentence follow different translation paths.

**Token interdependence:** Translation quality depends on tokens being consistent with each other. "I ate an apple" → "りんごを食べた" requires the verb ending to agree with the object — NAT must learn these dependencies without sequential generation.

**Fertility prediction:** NAT must predict output length before generating, since all positions are decoded in parallel. Length misprediction causes missing or repeated tokens.

---

## 4. Latest Advances (2024-2025)

### 4.1 LLM Knowledge Distillation for NAT (Ju, 2025)

**Paper:** "Non-Autoregressive Translation Algorithm Based on LLM Knowledge Distillation in English Corpus" (Engineering Reports, 2025)

Key contributions:
- **Gating-based decoder input enhancement:** Improves the quality of decoder inputs used for parallel generation
- **Dynamic temperature knowledge distillation:** Uses an LLM teacher (large AR model) to train the NAT student, with temperature scheduling that adapts during training
- **Results:** Significantly narrows the gap with AR and iterative NAT models; the method reduces the BLEU gap to 0.2-0.64 points on standard benchmarks

The use of modern LLMs as teachers (rather than traditional Transformer-base teachers) represents a step change — the richer knowledge from LLMs produces cleaner distillation data that resolves more of the multi-modality problem.

### 4.2 Multi-scale Joint Learning with Negative Sample Mining (Qu et al., 2025)

**Paper:** Published in Knowledge-Based Systems, May 2025

Key contributions:
- **Negative sample mining:** Uses a pretrained AR model to generate multiple translation references, treating them as negative samples to teach the NAT model what to avoid
- **Multi-scale joint learning:** Combines token-level positive reinforcement with sentence-level negative penalization
- **Results:** Surpasses existing NAT methods in both translation accuracy and robustness across various datasets; specifically addresses the multi-modality problem by teaching the NAT model to converge on a single coherent translation

### 4.3 CTC-based NAT

CTC (Connectionist Temporal Classification) loss allows the model to marginalize over all valid alignments between source and target, avoiding explicit length prediction.

**Key results:**
- **NMLA-NAT** (NeurIPS 2022 Spotlight): Non-Monotonic Latent Alignments achieve 30.06 BLEU on WMT14 EN-DE with one-iteration decoding — near AR parity
- **CTCPMLM** (IEEE 2024): Combines pretrained language model initialization with CTC loss; further closes the gap by leveraging encoder-based PLMs
- **CTC for speech translation** (ACL 2023): 29.5 BLEU on MuST-C with 5.67x speedup, showing CTC works end-to-end from speech

CTC-based approaches are the most mature NAT variant, with the best quality-speed tradeoff for text-to-text translation.

### 4.4 Diffusion-based Translation (MDLM and Mercury)

**MDLM (Masked Diffusion Language Models):**
- Generate by iteratively refining an entire sequence in parallel through denoising steps
- At 8B scale, match strong AR baselines on math and science benchmarks
- Not yet specifically applied to machine translation in published work, but the architecture is directly applicable

**Mercury (Inception Labs, 2025-2026):**
- First commercial-scale diffusion LLM: 1109 tokens/sec on H100 (Mercury Coder Mini)
- Mercury 2 (Feb 2026): ~1000 tok/s output throughput, 5x faster than speed-optimized AR LLMs
- Generates multiple tokens simultaneously through parallel refinement over a small number of denoising steps
- **Not translation-specific** but demonstrates that diffusion-based parallel generation has reached production quality

---

## 5. Quality-Speed Tradeoff Analysis

### 5.1 BLEU Gap Summary (WMT14 EN-DE)

| Method | BLEU | Gap vs AR | Speedup | Iterations |
|---|---|---|---|---|
| AR Transformer (baseline) | ~29.0 | — | 1x | N (output len) |
| Vanilla NAT (2018) | 23.2 | -5.8 | 15.6x | 1 |
| CTC + Latent Alignments | 27.5 | -1.5 | 12.5x | 1 |
| NMLA-NAT (CTC, non-monotonic) | 30.1 | +1.1 | ~10x | 1 |
| LLM-KD NAT (2025) | ~28.4-28.8 | -0.2 to -0.64 | 14-15x | 1 |
| CMLM (iterative, 10 iter) | 28.5 | -0.5 | 2-3x | 10 |
| Mercury 2 (diffusion LLM) | — | ~AR parity | ~10x throughput | 3-5 denoising |

### 5.2 Is 0.2-0.64 BLEU Loss Acceptable?

For live-translate's real-time subtitle use case:
- **Yes for fast mode:** Users already accept LFM2 (~350M params) quality for speed; a further 0.2-0.64 BLEU trade is marginal
- **No for quality mode:** Users choosing Hunyuan-MT 7B or PLaMo-2 10B want maximum quality
- **Context matters:** BLEU gaps are measured on EN-DE; JA-EN gaps may be larger due to structural distance

### 5.3 JA-EN Specific Concerns

Japanese-English translation is structurally challenging for NAT:
- **SOV → SVO reordering:** Japanese is SOV, English is SVO — long-distance word reordering is required
- **Agglutinative morphology:** Japanese verb conjugation encodes tense/aspect/mood, requiring consistent multi-token generation
- **No published JA-EN NAT benchmarks:** All BLEU numbers above are for EN-DE/EN-RO; JA-EN quality gap is likely 1-3 BLEU points wider
- **CTC monotonic assumption breaks down:** CTC assumes roughly monotonic alignment — JA-EN requires global reordering, which is why NMLA-NAT (non-monotonic) is critical for this pair

---

## 6. Implementation Options

### 6.1 Existing Frameworks

| Framework | NAT Support | Runtime | Notes |
|---|---|---|---|
| **Fairseq** (Meta) | CTC-NAT, CMLM, vanilla NAT | PyTorch | Most complete NAT implementation; WMT pretrained models available (EN-DE/EN-RO only) |
| **NMLA-NAT** (ICT/CAS) | CTC + non-monotonic alignments | Fairseq/PyTorch | NeurIPS 2022 code available; best single-pass quality |
| **CTranslate2** (OpenNMT) | Fairseq model export | C++/ONNX | Can convert Fairseq models for fast CPU/GPU inference |
| **ONNX Runtime** | Any exported model | C++/JS/Python | Cross-platform; supports CoreML, DirectML, CUDA execution providers |

### 6.2 Potential Integration Path for live-translate

```
Option A: Fairseq → CTranslate2 → native inference
  - Train NAT model on JA-EN data using Fairseq
  - Export to CTranslate2 format for optimized C++ inference
  - Bridge to Electron via native addon or UtilityProcess

Option B: PyTorch → ONNX → ONNX Runtime
  - Train NAT model in PyTorch/Fairseq
  - Export to ONNX format
  - Run via ONNX Runtime in UtilityProcess (Node.js bindings available)
  - Supports CoreML (macOS) and DirectML (Windows) execution providers

Option C: Monitor Mercury / diffusion LLMs (lowest effort)
  - Wait for Mercury or similar diffusion LLM to release translation-capable models
  - Integrate via API initially, local inference when weights become available
  - Avoids custom model training entirely
```

### 6.3 Training Requirements (Options A/B)

| Resource | Requirement |
|---|---|
| Training data | JA-EN parallel corpus (JParaCrawl v3: ~25M pairs, CC-BY) |
| AR teacher model | Fine-tuned Transformer for knowledge distillation |
| Compute | ~4-8 A100 GPUs for 2-3 days (CTC-NAT training) |
| Distillation | Decode full training set with AR teacher (~12-24 hours) |
| Evaluation | BLEU + COMET on WMT JA-EN test sets |

This is a significant investment for a desktop translation tool and represents the highest-risk option.

---

## 7. Feasibility Assessment for live-translate

### 7.1 Feasibility Matrix

| Criterion | Score | Notes |
|---|---|---|
| Latency improvement potential | High | 10-15x speedup is real and validated |
| JA-EN quality feasibility | Low-Medium | No existing JA-EN NAT models; structural challenges |
| Implementation effort | Very High | Custom model training required |
| Off-the-shelf availability | None | No pretrained JA-EN NAT models exist |
| Maintenance burden | High | Custom model = custom updates, no community ecosystem |
| Risk | High | Quality on JA-EN is unproven |

### 7.2 Comparison with Current Roadmap

| Approach | Latency | Effort | Risk | Available Now |
|---|---|---|---|---|
| HY-MT1.5-1.8B (current) | ~180ms | Done | None | Yes |
| LFM2 (current ultra-fast) | ~50ms | Done | None | Yes |
| NAT (custom trained) | ~12ms | Very High | High | No |
| Mercury diffusion LLM | TBD | Medium (API) | Medium | Partial (no JA-EN focus) |
| Speculative decoding on AR | ~90ms | Medium | Low | Possible with llama.cpp |

### 7.3 Recommendation

**Do not pursue custom NAT model training at this time.** The effort-to-benefit ratio is unfavorable:
- LFM2 already achieves ~50ms, which is below human perception threshold (~100ms)
- Reducing from 50ms to 12ms has negligible UX impact
- Custom JA-EN NAT training requires GPU compute, parallel corpus preparation, and ongoing maintenance with no community support

**Instead, monitor these developments:**

1. **Mercury / diffusion LLMs** — If Mercury releases translation-capable models or fine-tuning support, this provides NAT-like parallel generation without custom training. Mercury 2 already achieves ~1000 tok/s throughput.

2. **CTC-NAT pretrained models for JA** — If NMLA-NAT or similar projects release JA-EN checkpoints, evaluate immediately. Current models are EN-DE/EN-RO only.

3. **Speculative decoding** — A more practical near-term speedup: use a small draft model to predict multiple tokens, then verify with the main model in a single pass. llama.cpp already supports this. Could reduce HY-MT1.5's 180ms to ~90ms with minimal effort.

---

## 8. Evaluation Plan (If Conditions Change)

If a pretrained JA-EN NAT model becomes available, or if custom training becomes justified:

### Phase 1: Baseline Evaluation
1. Obtain or train a CTC-NAT model on JParaCrawl v3 (JA-EN)
2. Export to ONNX format
3. Benchmark on live-translate's standard test set:
   - BLEU and COMET scores vs HY-MT1.5-1.8B
   - Latency on Apple Silicon (M1/M2/M3)
   - Memory footprint

### Phase 2: Quality Threshold
| Metric | Pass | Fail |
|---|---|---|
| BLEU (JA→EN) | Within 2.0 of HY-MT1.5-1.8B | Gap > 2.0 BLEU |
| COMET (JA→EN) | Within 0.02 of HY-MT1.5-1.8B | Gap > 0.02 |
| Latency | < 30ms on M2 | > 50ms |
| Memory | < 500MB | > 1GB |

### Phase 3: Integration
- Implement as `NATTranslator.ts` following engine plugin rules
- Register in `EngineManager` as experimental engine (hidden from UI)
- A/B test against LFM2 for fast-mode quality comparison
- Promote to primary UI if quality threshold met

---

## 9. References

- [LLM Knowledge Distillation for NAT (Ju, 2025)](https://onlinelibrary.wiley.com/doi/full/10.1002/eng2.13077)
- [Multi-scale Joint Learning for NAT (Qu et al., 2025)](https://www.sciencedirect.com/science/article/abs/pii/S0950705125006562)
- [NMLA-NAT: Non-Monotonic Latent Alignments (NeurIPS 2022)](https://github.com/ictnlp/nmla-nat)
- [CTC-based Non-autoregressive Speech Translation (ACL 2023)](https://aclanthology.org/2023.acl-long.744/)
- [CTCPMLM: CTC with Pretrained Language Models (IEEE 2024)](https://ieeexplore.ieee.org/document/10679261/)
- [MDLM: Masked Diffusion Language Models](https://s-sahoo.com/mdlm/)
- [Mercury: Ultra-Fast Diffusion LLMs (Inception Labs)](https://arxiv.org/abs/2506.17298)
- [Mercury 2 Launch (Feb 2026)](https://www.inceptionlabs.ai/blog/introducing-mercury-2)
- [Fairseq NAT Implementation](https://github.com/facebookresearch/fairseq/blob/main/examples/nonautoregressive_translation/README.md)
- [NAT Survey (Electronics, 2023)](https://www.mdpi.com/2079-9292/12/13/2980)
- [NAT: A Call for Clarity (Apple ML Research, EMNLP 2022)](https://machinelearning.apple.com/research/non-autoagressive-neural-machine)
- [Understanding KD in NAT (ICLR 2020)](https://arxiv.org/abs/1911.02727)
- [Selective KD for NAT (AAAI 2023)](https://ojs.aaai.org/index.php/AAAI/article/view/26555)
- [JParaCrawl v3 Corpus](https://www.kecl.ntt.co.jp/icl/lirg/jparacrawl/)
