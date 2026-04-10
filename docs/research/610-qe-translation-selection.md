# Multi-Engine QE-Based Translation Selection (Local+Cloud Blend)

**Issue:** #610
**Date:** 2026-04-10
**Status:** Research complete — viable architecture identified, xCOMET-lite recommended as QE backbone

---

## 1. Summary

This document evaluates quality estimation (QE) models and architectures for automatically selecting the best translation from multiple engines (local + cloud) without human references. The core idea: display the local translation instantly (~180ms via HY-MT1.5-1.8B), simultaneously request a cloud translation (Google/DeepL, ~500-1000ms), then use a lightweight QE model to decide whether the cloud result is worth upgrading to.

**Competitive advantage:** No desktop translation tool currently implements multi-engine QE-based selection. This is a frontier feature that combines the latency of local models with the quality of cloud APIs, transparently.

---

## 2. Background & Motivation

### Current State in live-translate

Users must manually choose between:

| Mode | Engine | Latency | Quality | Offline |
|------|--------|---------|---------|---------|
| Fast default | HY-MT1.5-1.8B | ~180ms | Good | Yes |
| Ultra-fast | LFM2 | ~50ms | Baseline | Yes |
| Quality | Hunyuan-MT 7B | 3.7s JA→EN | High | Yes |
| Cloud | Google Translate | ~500ms | High | No |
| Cloud | DeepL | ~500ms | Very high | No |

The tradeoff is manual and static. Users who want both speed and quality must compromise.

### Proposed Flow

```
STT output
  ├── Local engine (HY-MT1.5-1.8B) → display immediately (~180ms)
  │
  └── Cloud engine (Google/DeepL) → arrives ~500-1000ms later
       │
       └── QE model scores both → if cloud > local + threshold → swap
                                   else → keep local (no flicker)
```

This "local-first, cloud-upgrade" pattern gives:
- **Instant feedback:** user sees translation in ~180ms
- **Automatic quality upgrade:** cloud result replaces local only when measurably better
- **Graceful offline:** when cloud is unavailable, local result stands alone (no QE needed)
- **Cost efficiency:** QE can gate cloud API calls (skip cloud if local confidence is high)

---

## 3. QE Model Landscape

### 3.1 CometKiwi (Unbabel/COMET)

CometKiwi is the state-of-the-art reference-free QE model family from Unbabel, built on the COMET framework. It takes (source, translation) pairs and outputs a quality score in [0, 1].

| Model | Backbone | Parameters | Size (est.) | GPU Memory | Notes |
|-------|----------|-----------|-------------|------------|-------|
| wmt22-cometkiwi-da | InfoXLM-large | ~560M | ~2.2GB | ~4GB | Base QE model, WMT22 winner |
| wmt23-cometkiwi-da-xl | — | 3.5B | ~14GB | ~16GB | Too large for desktop |
| wmt23-cometkiwi-da-xxl | — | 10.7B | ~42GB | ~44GB | Far too large for desktop |
| wmt22-cometkiwi-da-marian | Marian | Smaller | ~400MB | ~1GB | PyMarian port, faster |

**Assessment for live-translate:**
- The base wmt22-cometkiwi-da at ~560M params / ~2.2GB is too large for a QE sidecar in a desktop app that already runs STT + translation models.
- The Marian port is more promising but still requires PyTorch/Marian runtime.
- No official ONNX export available; would require manual conversion + quantization.

### 3.2 xCOMET-lite (Distilled)

xCOMET-lite is a distilled version of xCOMET-XXL (10.7B) that retains 92.1% quality with only 2.6% of the parameters.

| Property | Value |
|----------|-------|
| Backbone | mdeberta-v3-base |
| Parameters | 278M |
| Size on disk | ~1.1GB (fp32), ~280MB (INT8 quantized est.) |
| Inference speed | 15.2x faster than xCOMET-XXL |
| Peak memory | 12.5x smaller than xCOMET-XXL |
| Quality (Kendall τ) | 0.388 (vs 0.421 for xCOMET-XXL) |
| Reference-free mode | Yes (can operate without reference translations) |
| License | Apache 2.0 |

**Assessment for live-translate:**
- **Best candidate.** 278M params fits the <300MB budget when INT8 quantized.
- mdeberta-v3-base backbone can be exported to ONNX and quantized to INT8 (~280MB).
- Inference on CPU (Apple Silicon): estimated 20-40ms per sentence with ONNX Runtime.
- Already surpasses COMET-22 and BLEURT-20 on WMT22 benchmarks.
- Open source (Apache 2.0), HuggingFace model available.

### 3.3 ALOPE (Adaptive Layer Optimization)

ALOPE (COLM 2025) is a framework that adds LoRA adapters + regression heads to intermediate Transformer layers of LLMs for QE. Key insight: middle layers (around TL-16) contain the best cross-lingual representations for quality scoring.

| Property | Value |
|----------|-------|
| Approach | LoRA + regression heads on existing LLM layers |
| Base models tested | LLMs ≤8B parameters |
| Training | Efficient LoRA fine-tuning (few trainable params) |
| Key finding | Mid-layer representations outperform final-layer for QE |
| Strategies | Dynamic weighting (multi-layer blend) and multi-head regression |
| Overhead | Comparable to encoder-based QE models |
| Code | https://github.com/surrey-nlp/ALOPE |

**Assessment for live-translate:**
- ALOPE's approach is compelling for a future where we already run an LLM for translation. The QE LoRA adapter could piggyback on the translation model's forward pass.
- However, for the initial implementation, this adds complexity: we'd need to extract intermediate layer representations from node-llama-cpp, which doesn't natively expose them.
- **Better suited as a Phase 2 optimization** — use the translation model's own internal representations for self-QE, avoiding a separate QE model entirely.

### 3.4 SLIDE (Sliding Document Evaluator)

SLIDE (NAACL 2024) is a reference-free document-level metric that feeds sliding windows of source+translation chunks into an off-the-shelf QE model (e.g., COMET). It showed that source context can substitute for human references in disambiguating translation quality.

**Assessment:** Relevant for document-level QE but not directly applicable to our sentence-level real-time use case. Worth revisiting if we add meeting transcript summarization QE.

### 3.5 Comparison Matrix

| Model | Params | Est. Size (INT8) | Est. Latency (CPU) | Quality | Standalone | Fits Budget |
|-------|--------|-------------------|---------------------|---------|------------|-------------|
| xCOMET-lite | 278M | ~280MB | ~20-40ms | High | Yes | **Yes** |
| wmt22-cometkiwi-da | 560M | ~560MB | ~50-100ms | Very high | Yes | No (too large) |
| cometkiwi-da-marian | ~300M | ~300MB | ~30-50ms | High | Yes | Borderline |
| ALOPE (on existing LLM) | +LoRA only | ~10-50MB adapter | ~0ms (reuses forward pass) | TBD | No (needs LLM) | Yes (Phase 2) |

---

## 4. QE Reranking: arXiv:2510.08870

The paper "Quality Estimation Reranking for Document-Level Translation" (Mrozinski et al., 2025) evaluates QE reranking with multiple candidates. Key findings relevant to our use case:

| Metric | 2 candidates | 32 candidates |
|--------|-------------|---------------|
| SLIDE (best learned) | +2.00 BLEURT-20 | +5.09 BLEURT-20 |
| GEMBA-DA (best LLM) | +1.63 BLEURT-20 | +4.30 BLEURT-20 |

**Key takeaways:**
1. Even with just 2 candidates (our local + cloud scenario), QE reranking yields meaningful improvements (+2.00 BLEURT-20).
2. Learned metrics (SLIDE) outperform LLM-based metrics (GEMBA-DA) for reranking.
3. Gains diminish with longer documents but remain positive.
4. The approach works across both encoder-decoder NMT and decoder-only LLM translators.

**Implication for live-translate:** Our 2-candidate (local + cloud) setup is the minimum viable reranking scenario, and the literature confirms it produces significant quality gains. More candidates (e.g., local + Google + DeepL) would yield further improvements.

---

## 5. Multi-Engine Selection in Production

### 5.1 ModelFront

ModelFront is the closest production analog: a cloud API that scores translations from any engine and supports automatic engine selection (`engine=*`). It supports 147 languages and integrates with 6 TMS platforms.

**Differences from our approach:**
- ModelFront is cloud-only (API calls for QE scoring)
- We need local QE scoring to avoid additional latency
- ModelFront targets post-editing workflows, not real-time subtitle display

### 5.2 ModernMT MTQE

ModernMT offers Adaptive Quality Estimation as a built-in feature. Their approach calibrates raw QE scores into boolean quality predictions with thresholds per language pair and content type.

**Relevant insight:** Raw QE scores need calibration. We should establish per-language-pair thresholds for the "upgrade" decision, not use a universal threshold.

### 5.3 Key Design Principles from Production Systems

1. **Threshold calibration per language pair** — JA→EN and EN→JA will have different score distributions
2. **Confidence gating** — if local score > high threshold, skip cloud call entirely (saves API costs)
3. **Fallback gracefully** — if QE model fails, display local result (never block on QE)
4. **Score normalization** — different QE models output different ranges; normalize to [0, 1]

---

## 6. Architecture Design

### 6.1 Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    TranslationPipeline                       │
│                                                             │
│  STT Result ──┬── LocalTranslator ──── localResult ────┐   │
│               │                                         │   │
│               └── CloudTranslator ──── cloudResult ──┐  │   │
│                   (async, optional)                   │  │   │
│                                                      ▼  ▼   │
│                                          ┌──────────────┐   │
│                                          │QualityEstimator│  │
│                                          │  (xCOMET-lite) │  │
│                                          └──────┬───────┘   │
│                                                 │           │
│                                          ┌──────▼───────┐   │
│                                          │SelectionLogic │   │
│                                          │ - score both  │   │
│                                          │ - threshold   │   │
│                                          │ - upgrade?    │   │
│                                          └──────┬───────┘   │
│                                                 │           │
│                              display result ◄───┘           │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 New Modules

| Module | Location | Responsibility |
|--------|----------|---------------|
| `QualityEstimator` | `src/engines/qe/QualityEstimator.ts` | Load xCOMET-lite ONNX, score (src, translation) pairs |
| `TranslationSelector` | `src/engines/pipeline/TranslationSelector.ts` | Orchestrate multi-engine calls + QE selection logic |
| `QEModelDownloader` | `src/engines/qe/QEModelDownloader.ts` | Download + verify xCOMET-lite ONNX model |

### 6.3 Async Upgrade Flow (Detailed)

```typescript
// Pseudocode for TranslationSelector
async function translateWithSelection(source: string, context: TranslateContext): Promise<void> {
  // Phase 1: Instant local result
  const localResult = await localEngine.translate(source, context);
  emit('result', { text: localResult, source: 'local', final: false });

  // Phase 2: Cloud request (fire-and-forget, with timeout)
  if (!isOffline && cloudEngine) {
    try {
      const cloudResult = await withTimeout(cloudEngine.translate(source, context), 2000);

      // Phase 3: QE scoring
      const localScore = await qe.score(source, localResult);
      const cloudScore = await qe.score(source, cloudResult);

      // Phase 4: Upgrade decision
      const threshold = getThreshold(sourceLang, targetLang); // e.g., 0.05
      if (cloudScore - localScore > threshold) {
        emit('result', { text: cloudResult, source: 'cloud', final: true, upgraded: true });
      } else {
        emit('result', { text: localResult, source: 'local', final: true });
      }
    } catch {
      // Cloud failed or timed out — local result is final
      emit('result', { text: localResult, source: 'local', final: true });
    }
  } else {
    emit('result', { text: localResult, source: 'local', final: true });
  }
}
```

### 6.4 Confidence Gating (Cost Optimization)

To reduce unnecessary cloud API calls:

```typescript
// If local QE score exceeds high-confidence threshold, skip cloud entirely
const localScore = await qe.score(source, localResult);
if (localScore > HIGH_CONFIDENCE_THRESHOLD) {
  emit('result', { text: localResult, source: 'local', final: true });
  return; // No cloud call needed
}
// Otherwise, proceed with cloud request...
```

This saves API costs (Google Translate free tier: 500K chars/month) by only calling cloud when local quality is uncertain.

### 6.5 QE Model Runtime

**Option A: ONNX Runtime in UtilityProcess (Recommended)**

Run the xCOMET-lite ONNX model in a dedicated UtilityProcess, similar to how `slm-worker.ts` runs LLM inference. Use `onnxruntime-node` for native performance.

| Concern | Solution |
|---------|----------|
| Runtime | `onnxruntime-node` (native C++ bindings for Node.js) |
| Model format | ONNX INT8 quantized (~280MB) |
| Tokenizer | `@xenova/transformers` (mdeberta tokenizer) or bundled tokenizer |
| Process isolation | UtilityProcess (same pattern as slm-worker.ts) |
| Memory | ~300-400MB peak (acceptable alongside translation model) |
| Latency target | <50ms per (source, translation) pair |

**Option B: Transformers.js WebGPU (Alternative)**

Use `@xenova/transformers` in the renderer process with WebGPU backend. This avoids native dependencies but is less predictable in performance.

**Recommendation:** Option A. ONNX Runtime in UtilityProcess is more predictable and consistent with the existing architecture (all heavy inference in UtilityProcess).

### 6.6 UI Integration

The subtitle overlay should show a subtle visual indicator when translation is upgraded:

- **Initial display:** local result appears immediately (normal style)
- **Upgrade transition:** if cloud result replaces local, apply a brief fade/flash animation
- **No flicker for same result:** if QE decides local is better, no visual change
- **Settings:** toggle for "Auto-upgrade translations" (enabled by default), with option to show upgrade indicator

---

## 7. Evaluation Plan

### 7.1 QE Model Evaluation

1. **Export xCOMET-lite to ONNX:** Convert HuggingFace model → ONNX → INT8 quantization
2. **Benchmark inference latency** on Apple Silicon (M1/M2/M3) — target <50ms
3. **Validate QE accuracy on JA↔EN:** Use WMT test sets to verify the model distinguishes good from bad translations in our target language pair
4. **Compare QE scores:** local (HY-MT1.5-1.8B) vs cloud (Google/DeepL) on 100 test sentences

### 7.2 End-to-End Pipeline Evaluation

| Metric | Target | Method |
|--------|--------|--------|
| Local display latency | <200ms | Timer from STT output to first subtitle |
| Cloud upgrade latency | <1200ms | Timer from STT output to upgraded subtitle |
| QE scoring latency | <50ms | Timer for QE model inference |
| Upgrade rate | 30-60% | % of segments where cloud beats local |
| False upgrade rate | <5% | % of upgrades where local was actually better (human eval) |
| API cost reduction | >40% | % of cloud calls avoided by confidence gating |

### 7.3 Human Evaluation Protocol

1. Collect 200 JA→EN and 200 EN→JA segment pairs with both local and cloud translations
2. Have 2 evaluators blindly rate which translation is better (or tie)
3. Compare human preference with QE model selection
4. Calculate agreement rate and error types (false upgrade / missed upgrade)

---

## 8. Implementation Notes

### 8.1 Phase 1: xCOMET-lite QE (MVP)

1. Convert xCOMET-lite (myyycroft/XCOMET-lite on HuggingFace) to ONNX
2. Quantize to INT8 using ONNX Runtime quantization tools
3. Implement `QualityEstimator` class with `initialize()`, `score()`, `dispose()` interface
4. Run in UtilityProcess alongside (but separate from) `slm-worker.ts`
5. Implement `TranslationSelector` in pipeline with local-first + async cloud upgrade
6. Add per-language-pair threshold calibration (start with JA↔EN)
7. Add UI toggle and upgrade indicator animation

### 8.2 Phase 2: ALOPE Self-QE (Optimization)

1. Extract intermediate layer representations from the translation LLM during inference
2. Train a lightweight LoRA adapter + regression head for QE on these representations
3. This eliminates the need for a separate QE model — the translation model scores its own output
4. Requires node-llama-cpp to expose intermediate layer access (may need upstream PR)

### 8.3 Phase 3: Multi-Engine Reranking

1. Support >2 candidates (e.g., HY-MT1.5-1.8B + Google + DeepL)
2. Batch QE scoring for all candidates
3. Dynamic engine routing based on historical QE scores per language pair
4. Candidate combination (following "Don't Rank, Combine!" — arXiv:2401.06688)

### 8.4 Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| xCOMET-lite ONNX export fails | Medium | Fall back to PyTorch via `onnxruntime` Python bridge, or use cometkiwi-da-marian |
| QE adds too much memory (~300MB) | Medium | Make QE optional, lazy-load only when multi-engine mode is active |
| QE latency >50ms on older Macs | Low | Batch scoring, cache repeated source texts, reduce model precision |
| JA↔EN QE accuracy is poor | Medium | Fine-tune xCOMET-lite on JA↔EN QE data (WMT QE shared task datasets) |
| Subtitle flicker from upgrades | Low | Debounce: only upgrade if delta > threshold, add smooth transition animation |
| Cloud API rate limiting | Low | Exponential backoff, respect 6000 req/min Google limit |
| Total memory exceeds 16GB systems | High | Disable QE on <16GB systems, or use confidence gating to avoid loading QE model at all |

---

## 9. Decision

**Proceed with Phase 1 implementation using xCOMET-lite as QE backbone.**

- xCOMET-lite (278M, ~280MB INT8) fits the <300MB, <50ms budget
- 2-candidate reranking (local + cloud) is validated by literature (arXiv:2510.08870)
- Architecture integrates cleanly with existing UtilityProcess pattern
- ALOPE self-QE deferred to Phase 2 as optimization
- No competitor implements this — clear differentiation opportunity

---

## References

- COMET framework: https://github.com/Unbabel/COMET
- CometKiwi WMT22: https://huggingface.co/Unbabel/wmt22-cometkiwi-da
- CometKiwi WMT23 (XL/XXL): https://huggingface.co/Unbabel/wmt23-cometkiwi-da-xxl
- xCOMET-lite paper: https://arxiv.org/abs/2406.14553
- xCOMET-lite model: https://huggingface.co/myyycroft/XCOMET-lite
- xCOMET-lite code: https://github.com/nl2g/xcomet-lite
- ALOPE paper (COLM 2025): https://arxiv.org/abs/2508.07484
- ALOPE code: https://github.com/surrey-nlp/ALOPE
- QE Reranking for Document-Level Translation: https://arxiv.org/abs/2510.08870
- SLIDE (reference-free document evaluation): https://arxiv.org/abs/2309.08832
- Don't Rank, Combine! (candidate combination): https://arxiv.org/abs/2401.06688
- Quality-Aware Decoding: https://arxiv.org/abs/2502.08561
- ModelFront QE API: https://www.modelfront.com/quality-prediction
- ModernMT MTQE: https://blog.modernmt.com/modernmt-introduces-quality-estimation-mtqe/
- QE survey (handcrafted to LLMs): https://arxiv.org/abs/2403.14118
- COMET models list: https://github.com/Unbabel/COMET/blob/master/MODELS.md
- PyMarian (fast COMET inference): https://arxiv.org/abs/2408.11853
- machinetranslate.org QE overview: https://machinetranslate.org/quality-estimation
