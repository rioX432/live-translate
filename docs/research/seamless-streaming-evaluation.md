# SeamlessStreaming Evaluation for live-translate

**Issue:** #316
**Date:** 2026-03-24
**Status:** Research complete — not viable for local inference today; monitor for distilled models

## 1. Model Overview

SeamlessStreaming is Meta's streaming speech translation model supporting ~100 input languages and 36 output speech languages. It is part of the SeamlessM4T v2 family and supports three modes: S2TT (speech-to-text translation), S2ST (speech-to-speech translation), and ASR.

| Variant | Params | FP16 VRAM | Peak Inference VRAM | Notes |
|---------|--------|-----------|---------------------|-------|
| SeamlessM4T v2 Large | 2.3B | ~5.8 GB | ~7+ GB | Full S2TT/S2ST/ASR |
| SeamlessM4T v2 Medium | 1.2B | ~3 GB | ~4 GB | Reduced quality |
| SeamlessM4T v2 Small | 281M | ~0.6 GB | ~1 GB | On-device target, limited language coverage |

Architecture: 24-layer wav2vec-BERT encoder + non-autoregressive UnitY2 decoder (3x speedup over autoregressive).

### Language Support
- **Input:** ~100 languages (speech)
- **Output:** 36 languages (speech), ~100 languages (text)
- **JA/EN:** Supported for both S2TT and S2ST

## 2. S2TT Mode Feasibility on Apple Silicon

### Hardware Requirements
- **Large model (recommended):** Requires ~7 GB VRAM during inference. Fits on M1 Pro/Max (16 GB+) but tight on base M1/M2 (8 GB).
- **Small model:** Fits on 8 GB machines but with reduced translation quality.
- **Runtime:** fairseq2 (Python) with pre-built Apple Silicon wheels available.

### Integration Approach
The most viable path would be a Python bridge (same pattern as `MlxWhisperEngine`):
1. Spawn Python subprocess with fairseq2 + seamless_communication
2. Stream audio chunks via JSON-over-stdio protocol
3. Receive S2TT results (bypasses separate translator stage)

### unity.cpp Status
Meta released unity.cpp for running SeamlessM4T via GGML/C++, but it has limited community adoption and no quantized GGUF models are widely available. Not production-ready for integration.

## 3. Performance Comparison: S2TT vs Cascaded Pipeline

| Metric | SeamlessM4T v2 S2TT | Whisper + Translator (cascaded) |
|--------|---------------------|--------------------------------|
| BLEU (JA→EN) | +2-4 BLEU improvement | Baseline |
| Pipeline stages | 1 (end-to-end) | 2 (STT + Translation) |
| Error propagation | None (single model) | STT errors cascade to translation |
| Latency | ~1-2s per segment (streaming) | ~0.5s STT + ~0.3s translation |
| Model size | 5.8 GB (large, FP16) | ~1.5 GB (Whisper) + ~0.5 GB (translator) |
| Memory usage | 7+ GB | ~3 GB total |

### Key Advantage
S2TT eliminates error propagation between STT and translation stages. When Whisper mis-transcribes a word, the translator cannot recover. SeamlessM4T processes the audio signal directly for translation.

### Key Disadvantage
Much larger model footprint and higher latency than the cascaded approach. Not suitable for 8 GB machines with the large model.

## 4. Competitive Landscape

| Company | Approach | Status |
|---------|----------|--------|
| Google | Gemini Live Translate (cloud S2S) | Launched 2025 |
| Microsoft | Live Interpreter API (cloud S2S) | Preview 2025 |
| Meta | SeamlessStreaming (open-source, local) | Research release |

The industry is converging on end-to-end speech-to-speech translation. Cloud-based solutions are already shipping. Local/on-device S2S is the next frontier.

## 5. Recommendations

### Short-term (not recommended now)
- **Do not integrate SeamlessM4T today.** The large model requires too much memory for typical user hardware, and the small model sacrifices quality.
- The Python dependency chain (fairseq2, PyTorch, seamless_communication) is heavy.

### Medium-term (monitor)
- Watch for **quantized/distilled SeamlessM4T models** in GGUF format that could run via llama.cpp or similar.
- Watch for **Whisper-to-S2TT fine-tuning** efforts that could provide a lighter alternative.
- Consider adding SeamlessM4T S2TT as an optional "high-quality" engine for users with 16 GB+ RAM.

### Long-term (strategic)
- End-to-end S2TT will likely replace cascaded pipelines as models get smaller.
- Plan architecture to support single-stage S2TT engines alongside cascaded STT+Translation.
- The `TranslationPipeline` should be refactored to support an `S2TTEngine` interface that takes audio and returns translated text directly.

## References
- [SeamlessStreaming Paper](https://ai.meta.com/research/publications/seamless-multilingual-expressive-and-streaming-speech-translation/)
- [seamless_communication GitHub](https://github.com/facebookresearch/seamless_communication)
- [SeamlessM4T v2 on HuggingFace](https://huggingface.co/facebook/seamless-m4t-v2-large)
- [Nature publication](https://www.nature.com/articles/s41586-024-08359-z)
