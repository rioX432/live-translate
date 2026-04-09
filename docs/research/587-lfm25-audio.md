# LFM2.5 ENJP-MT and LFM2-Audio Research

**Issue:** #587
**Date:** 2026-04-09
**Status:** Research complete — LFM2.5 ENJP-MT not yet released; LFM2-Audio English-only for now. **Recommendation: Wait.**

---

## 1. LFM2.5 Overview

Liquid AI released the LFM2.5 family in **January 2026** as the next generation of their on-device foundation models.

### Key Improvements over LFM2

| Dimension | LFM2 | LFM2.5 |
|-----------|------|---------|
| Pre-training tokens | 10T | 28T |
| Post-training | SFT + preference alignment | SFT + preference alignment + large-scale multi-stage RL |
| Audio detokenizer | Mimi | Custom LFM-based (8x faster on mobile CPU) |
| Instruction following | Baseline | Significantly improved |
| Tool use / data extraction | Limited | Strong (reliable at 350M scale) |
| Multilingual vision | Limited | Arabic, Chinese, French, German, **Japanese**, Korean, Spanish |

### Release Timeline

- **January 6, 2026** — LFM2.5-1.2B (Instruct, Base, JP, Audio, VL) announced
- **January 20, 2026** — LFM2.5-1.2B-Thinking (reasoning variant, <1GB)
- **March 31, 2026** — LFM2.5-350M released (28T tokens, scaled RL)

### Architecture

LFM2 / LFM2.5 is **not a pure SSM/S4 model**. It uses a hardware-in-the-loop architecture search that resulted in a hybrid:
- **10 double-gated short-range convolution blocks** (cheap, fast)
- **6 grouped-query attention (GQA) blocks** (global context)

The search explored SSMs (S4, Liquid-S4, S5, Mamba, Mamba2), linear attention, and Liquid-Time Constant networks (CfC), but found that short convolution + sparse attention dominates under device-side latency/memory budgets. On CPU benchmarks, LFM2 delivers 200% faster decode/prefill than Qwen3 and Gemma 3.

LFM2.5 extends this architecture with 28T-token pretraining (80,000:1 token-to-parameter ratio for the 350M variant) and multi-stage RL post-training.

---

## 2. LFM2.5 ENJP-MT Variant

### Current Status: **Not Released**

As of 2026-04-09, there is **no LFM2.5-ENJP-MT model on HuggingFace**. The existing translation-specific model remains:

- `LiquidAI/LFM2-350M-ENJP-MT` — fine-tuned on LFM2-350M for bidirectional JA↔EN
- `LiquidAI/LFM2-350M-ENJP-MT-GGUF` — GGUF quantized (Q4_K_M ~230MB)
- `onnx-community/LFM2-350M-ENJP-MT-ONNX` — ONNX community port

### Related Japanese Releases

- `LiquidAI/LFM2.5-1.2B-JP` — Japanese general-purpose text model (not MT-specialized)
- `LiquidAI/LFM2.5-1.2B-JP-GGUF` — GGUF variant

The LFM2.5-1.2B-JP targets Japanese knowledge and instruction-following, **not** optimized for bidirectional JA↔EN machine translation.

### Drop-in Upgrade Potential

If/when Liquid AI releases `LFM2.5-350M-ENJP-MT`, it should be a near drop-in upgrade for `LFM2Translator.ts`:
- Same model size class (~230–300MB quantized)
- Same system prompt interface (`"Translate to Japanese."` / `"Translate to English."`)
- Same GGUF format compatible with node-llama-cpp
- Expected latency similar or better (~180ms), with improved translation quality from 28T token pretraining

The `LFM2Translator.ts` currently wraps `LlamaWorkerTranslator` and calls `getLFM2Variants()` from `model-downloader`. A new `LFM25Translator.ts` could be added alongside it (or the variants config updated) with minimal changes.

---

## 3. LFM2-Audio / LFM2.5-Audio

### Available Models

| Model | HuggingFace | Notes |
|-------|-------------|-------|
| `LiquidAI/LFM2-Audio-1.5B` | Released | LFM2 generation |
| `LiquidAI/LFM2.5-Audio-1.5B` | Released Jan 2026 | LFM2.5 generation, 8x faster detokenizer |
| `LiquidAI/LFM2.5-Audio-1.5B-GGUF` | Released | llama.cpp-compatible |
| `LiquidAI/LFM2.5-Audio-1.5B-ONNX` | Released | ONNX port |

### Capabilities

LFM2.5-Audio is an **end-to-end multimodal speech+text model** — no separate ASR/TTS components required. It supports two generation modes:

- **Interleaved mode**: alternating text+audio tokens; minimal TTFA, ideal for real-time speech-to-speech on constrained devices
- **Sequential mode**: model-controlled modality switching via special tokens; suitable for ASR (speech→text) and TTS (text→speech)

### Language Support: **English Only (Current)**

As of April 2026, LFM2.5-Audio officially supports **English only**. Liquid AI has stated in the HuggingFace discussion threads that they are working to extend support to all languages covered by LFM2.5-Base (which includes Japanese), but no timeline has been confirmed.

A HuggingFace discussion on `LFM2.5-Audio-1.5B-GGUF` ("More Language Support") shows community interest in Japanese but no official response yet.

### Speech Translation

Neither LFM2-Audio nor LFM2.5-Audio is currently marketed as a **speech translation** model (speech-in, translated-text-out). The focus is on ASR and TTS, not cross-lingual translation. For now, a JA→EN speech translation pipeline would still require the STT → Translator cascade.

---

## 4. Architecture Summary (LFM2 / LFM2.5)

LFM2.5 is **not** a pure State Space Model. Marketing refers to "Liquid Foundation Models" drawing from their SSM/LTC research lineage, but the deployed architecture is:

- **Hybrid convolution + sparse attention** (hardware-optimized via architecture search)
- Compatible with llama.cpp (GGUF) — same inference path as transformer models
- No special SSM runtime required; node-llama-cpp works as-is

This means the existing `LlamaWorkerTranslator` / `slm-worker.ts` / `worker-pool.ts` infrastructure can serve LFM2.5 variants without changes.

---

## 5. Recommendation

| Item | Verdict |
|------|---------|
| LFM2.5-ENJP-MT integration | **Wait** — not yet released; monitor `LiquidAI` HuggingFace org |
| LFM2.5-350M as general base for fine-tune | Possible, but requires MT-specific fine-tuning effort |
| LFM2.5-Audio for unified STT+Translation | **Wait** — English-only; Japanese support roadmap unclear |
| LFM2-Audio for JA speech translation | Not viable now; no JA output capability |

**Action items:**
1. Set up a GitHub Actions workflow or cron to poll `https://huggingface.co/api/models?search=LFM2.5-ENJP-MT&author=LiquidAI` weekly
2. When LFM2.5-ENJP-MT drops: update `getLFM2Variants()` in `model-downloader.ts` and benchmark vs current LFM2-350M-ENJP-MT and HY-MT1.5-1.8B
3. Re-evaluate LFM2.5-Audio when Japanese language support is announced

---

## Sources

- [Introducing LFM2.5: The Next Generation of On-Device AI — Liquid AI](https://www.liquid.ai/blog/introducing-lfm2-5-the-next-generation-of-on-device-ai)
- [LFM2.5-350M: No Size Left Behind — Liquid AI](https://www.liquid.ai/blog/lfm2-5-350m-no-size-left-behind)
- [Liquid AI Releases LFM2.5 — MarkTechPost (Jan 6, 2026)](https://www.marktechpost.com/2026/01/06/liquid-ai-releases-lfm2-5-a-compact-ai-model-family-for-real-on-device-agents/)
- [Liquid AI Released LFM2.5-350M — MarkTechPost (Mar 31, 2026)](https://www.marktechpost.com/2026/03/31/liquid-ai-released-lfm2-5-350m-a-compact-350m-parameter-model-trained-on-28t-tokens-with-scaled-reinforcement-learning/)
- [LFM2 Technical Report — arXiv:2511.23404](https://arxiv.org/html/2511.23404v1)
- [LiquidAI/LFM2-350M-ENJP-MT — HuggingFace](https://huggingface.co/LiquidAI/LFM2-350M-ENJP-MT)
- [LiquidAI/LFM2.5-Audio-1.5B — HuggingFace](https://huggingface.co/LiquidAI/LFM2.5-Audio-1.5B)
- [LiquidAI/LFM2.5-Audio-1.5B — Language Support Discussion](https://huggingface.co/LiquidAI/LFM2.5-Audio-1.5B/discussions/6)
- [LiquidAI/LFM2.5-1.2B-JP — HuggingFace](https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP)
- [💧 LFM2.5 Collection — HuggingFace](https://huggingface.co/collections/LiquidAI/lfm25)
- [Liquid AI LFM2.5 Makes On-Device Speech Agents Real — COEY](https://coey.com/resources/blog/2026/01/06/liquid-ai-lfm2-5-makes-on-device-speech-agents-real/)
- [GitHub: liquid-audio — Liquid4All](https://github.com/Liquid4All/liquid-audio)
