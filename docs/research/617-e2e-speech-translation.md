# End-to-End Streaming Speech-to-Text Translation Research

**Issue:** #617
**Date:** 2026-04-10
**Status:** Research complete — Hibiki (Kyutai) is the most viable open-source candidate; Hikari shows SOTA EN→JA quality but no public weights; JA input support remains a gap across all models

## 1. Background

### The Cascaded Pipeline Problem

live-translate currently uses a two-stage cascade: STT (Whisper/MLX Whisper) → MT (HY-MT1.5-1.8B/Google Translate). This architecture has two fundamental limitations:

1. **Error propagation** — STT transcription errors are irreversible; the translator receives corrupted text and cannot recover. A mis-heard word produces a semantically wrong translation.
2. **Compounded latency** — Each stage adds its own processing time. Whisper (~500ms–2.9s) + HY-MT1.5 (~180ms) = 680ms–3.1s minimum pipeline latency, excluding audio buffering.

End-to-end (E2E) speech translation models process the audio signal directly into translated text or speech, eliminating the intermediate text bottleneck. This is the direction the industry is converging on (Google Meet, Zoom AI Companion, ByteDance Seed).

### Prior Research

The existing [SeamlessStreaming evaluation](./seamless-streaming-evaluation.md) (#316) concluded that SeamlessM4T v2 is not viable for local inference today due to memory requirements (7+ GB for the large model). This document expands the landscape to newer models released in 2025–2026.

## 2. Model Landscape

### 2.1 Hikari (arXiv:2603.11578, March 2026)

**Authors:** Roman Koshkin, Jeon Haesung, Lianbo Liu, Hao Shi, Mengjie Zhao, Yusuke Fujita, Yui Sudo

**Approach:** Policy-free simultaneous S2TT using a probabilistic WAIT token mechanism. Instead of a fixed wait-k policy or learned policy network, Hikari encodes READ/WRITE decisions directly into the decoder vocabulary. The model learns to emit a special `<WAIT>` token when it needs more source context before producing the next translation token.

**Key innovations:**
- **WAIT token mechanism** — Eliminates the need for a separate simultaneous policy module. The decoder itself decides when to wait for more audio context, making the system fully end-to-end.
- **Decoder Time Dilation** — Reduces autoregressive overhead by allowing the decoder to skip timesteps when the source is ahead, ensuring balanced training distribution.
- **Delay recovery SFT** — Supervised fine-tuning strategy that trains the model to recover from accumulated delays, improving the quality-latency tradeoff.

**Architecture:** Whisper-based encoder-decoder. The encoder processes 80-channel log-Mel spectrograms. The decoder uses a GPT-2 BPE vocabulary (~50K tokens) augmented with the WAIT token. Exact parameter count is not disclosed in the abstract; likely in the 700M–1.5B range based on Whisper variants used.

**Results:** New SOTA BLEU scores on EN→JA, EN→DE, and EN→RU in both low-latency and high-latency regimes, outperforming previous baselines including SeamlessStreaming and TransLLaMA. Specific BLEU numbers require the full paper.

**Language pairs:** EN→JA, EN→DE, EN→RU (evaluated). EN→JA is a primary evaluation target.

**Open source:** No public code or weights as of April 2026. Paper only.

**Verdict:** Extremely relevant for live-translate (EN→JA is a primary use case), but cannot be integrated without public weights. Monitor for release.

### 2.2 Hibiki (Kyutai Labs, Feb 2025)

**Paper:** "High-Fidelity Simultaneous Speech-To-Speech Translation" (arXiv:2502.03382)

**Approach:** Decoder-only streaming S2S/S2TT built on Kyutai's Moshi multistream architecture. Models source and target speech jointly, producing text and audio tokens at a constant 12.5 Hz framerate. Supports both speech output (S2ST) and text output (S2TT).

**Model sizes:**
| Variant | Parameters | RVQ Streams | Target Hardware |
|---------|-----------|-------------|-----------------|
| Hibiki-2B | ~2.7B | 16 | Desktop GPU |
| Hibiki-M (1B) | ~1.7B | 8 | Smartphone / on-device |

**Available formats:**
- PyTorch (bf16)
- MLX for macOS (bf16) — `pip install moshi_mlx>=0.2.1`
- MLX-Swift for iOS (experimental)
- Rust with CUDA/Metal acceleration

**Performance:** ASR-BLEU 30.5 (FR→EN), naturalness rating 3.73/5 (vs 4.12/5 for human interpreters).

**Language pairs:** French → English only.

**License:** Code: MIT (Python) / Apache 2.0 (Rust). Weights: CC-BY 4.0.

**Verdict:** Excellent architecture and runtime support (MLX, Rust, Metal). The 1B model is viable for on-device inference. However, **no Japanese support** — only FR→EN. The architecture could theoretically be fine-tuned for JA→EN, but Kyutai has not released JA training data or models.

### 2.3 Hibiki-Zero (Kyutai Labs, Feb 2026)

**Paper:** "Simultaneous Speech-to-Speech Translation Without Aligned Data" (arXiv:2602.11072)

**Approach:** Extension of Hibiki that eliminates the need for word-level aligned training data. Uses GRPO (Group Relative Policy Optimization) reinforcement learning to learn simultaneous translation timing. This fundamentally simplifies the training pipeline and enables scaling to new languages.

**Model size:** 3B parameters. Requires 8–12 GB VRAM (NVIDIA GPU).

**Language pairs:** FR→EN, ES→EN, PT→EN, DE→EN, IT→EN. All X-to-English only.

**Adding new languages:** The architecture can be adapted to a new input language with <1000h of speech data (demonstrated with Italian). Nothing in the model is language-specific, so JA→EN is theoretically feasible but not yet available.

**Available formats:** PyTorch (bf16) only. No MLX, ONNX, or CoreML support yet.

**License:** MIT.

**Verdict:** Most promising open-source path to multilingual E2E translation. The GRPO training approach makes adding JA support realistic with community effort. However, 3B parameters + NVIDIA-only is too heavy for the typical live-translate user (macOS, 8–16 GB unified memory). No MLX support is a blocker.

### 2.4 SeamlessStreaming (Meta, Dec 2023)

**Paper:** "Seamless: Multilingual Expressive and Streaming Speech Translation" (arXiv:2312.05187)

**Approach:** Uses the Efficient Monotonic Multihead Attention (EMMA) mechanism to decide when to emit translation tokens vs. consume more source audio. Built on SeamlessM4T v2 with a wav2vec-BERT encoder and non-autoregressive UnitY2 decoder.

**Model sizes:**
| Variant | Parameters | FP16 VRAM | Peak VRAM |
|---------|-----------|-----------|-----------|
| Large | 2.3B | ~5.8 GB | ~7+ GB |
| Medium | 1.2B | ~3 GB | ~4 GB |
| Small | 281M | ~0.6 GB | ~1 GB |

**Language support:** ~100 input languages (speech), 36 output languages (speech), ~100 output languages (text). **JA and EN both supported for S2TT and S2ST.**

**Latency:** ~2 seconds streaming latency.

**Integration:** Python (fairseq2). No ONNX/GGUF/CoreML exports. unity.cpp exists but is not production-ready.

**Verdict:** Best language coverage including JA↔EN. Already evaluated in detail (#316). The large model is too heavy (7+ GB); the small model sacrifices quality. Monitor for quantized/distilled variants.

### 2.5 Seed LiveInterpret 2.0 (ByteDance, Jul 2025)

**Paper:** arXiv:2507.17527

**Approach:** Full-duplex E2E simultaneous speech-to-speech translation with zero-shot voice cloning. Uses a duplex speech-to-speech understanding-generating framework trained with large-scale pretraining and reinforcement learning.

**Performance:** 2–3 second latency, >70% correctness in complex scenarios (validated by human interpreters), significantly outperforms commercial SI solutions.

**Language pairs:** ZH↔EN only.

**Voice cloning:** Zero-shot, preserves speaker identity across translation.

**Open source:** No. Available only on ByteDance Volcano Engine (cloud API).

**Verdict:** State-of-the-art product-level quality, but not open source and no JA support. Useful as a quality benchmark only.

### 2.6 StreamSpeech (ICT-NLP, ACL 2024)

**Paper:** "StreamSpeech: Simultaneous Speech-to-Speech Translation with Multi-task Learning"

**Approach:** Two-pass architecture — first translates source speech to target text hidden states (autoregressive S2TT), then converts to target speech via non-autoregressive text-to-unit generation. Uses CTC decoders for alignment learning across ASR, S2TT, and S2UT tasks.

**Language pairs:** FR→EN, ES→EN, DE→EN. Evaluated on CVSS benchmark.

**Hardware:** Requires CUDA GPU, fairseq + SimulEval.

**License:** Open source (GitHub: ictnlp/StreamSpeech).

**Verdict:** Solid research contribution but no JA support, limited to European→EN pairs. Not practical for live-translate integration.

## 3. Comparison Table

| Model | Params | JA Support | Streaming | Open Weights | On-device (macOS) | Latency | License |
|-------|--------|-----------|-----------|-------------|-------------------|---------|---------|
| **Hikari** | ~0.7–1.5B (est.) | EN→JA (SOTA) | Yes | No | Unknown | Low (SOTA) | Paper only |
| **Hibiki-M** | 1.7B | No (FR→EN) | Yes | Yes | Yes (MLX) | Real-time | CC-BY 4.0 |
| **Hibiki-Zero** | 3B | No (4 langs→EN) | Yes | Yes | No (NVIDIA only) | Real-time | MIT |
| **SeamlessStreaming (L)** | 2.3B | Yes (JA↔EN) | Yes | Yes | Tight (7+ GB) | ~2s | CC-BY-NC 4.0 |
| **SeamlessStreaming (S)** | 281M | Yes (limited) | Yes | Yes | Yes (~1 GB) | ~2s | CC-BY-NC 4.0 |
| **Seed LiveInterpret 2.0** | Unknown | No (ZH↔EN) | Yes | No (cloud) | No | 2–3s | Proprietary |
| **StreamSpeech** | Unknown | No (EU→EN) | Yes | Yes | No (CUDA) | Real-time | Open source |
| **Current pipeline** | ~2 GB total | Yes | Yes | Yes | Yes | 0.7–3.1s | Mixed |

## 4. Feasibility for Electron Integration

### Architecture Requirements

The live-translate `TranslationPipeline` currently supports only cascaded STT→MT mode. Integrating an E2E model requires:

1. **New `S2TTEngine` interface** — Takes raw audio, returns translated text directly (no intermediate transcription). This was already identified as a long-term goal in the SeamlessStreaming evaluation (#316).
2. **UtilityProcess bridge** — Same pattern as `slm-worker.ts` for LLM engines. Spawn a Python/Rust subprocess for the E2E model.
3. **Streaming audio protocol** — The existing 3-second audio chunk buffering may need adjustment. E2E models often prefer continuous streaming at higher framerates (e.g., Hibiki's 12.5 Hz).

### Candidate Viability

**Hibiki-M (1B) via MLX — Most viable near-term path:**
- MLX support means native Apple Silicon inference without Python
- 1.7B parameters in bf16 ≈ 3.4 GB memory — fits on 8 GB machines alongside Whisper
- Rust backend with Metal acceleration is an alternative integration path
- **Blocker:** No JA support. Would need community fine-tuning or Kyutai to add JA.

**SeamlessStreaming Small (281M) — Viable but low quality:**
- Fits easily on all target hardware
- JA↔EN supported
- Quality significantly lower than the large model
- Python dependency (fairseq2) is heavy for Electron distribution

**Hikari — Best quality, not available:**
- If/when weights are released, the Whisper-based architecture would integrate similarly to existing Whisper engines
- EN→JA SOTA quality would be a major upgrade
- Model size likely manageable (Whisper-class)

### Recommended Integration Path

```
Phase 1 (Now): Define S2TTEngine interface in src/engines/types.ts
Phase 2 (When available): Integrate Hibiki-M with JA support OR Hikari weights
Phase 3 (Optimization): GGUF quantization, CoreML/ANE acceleration
```

## 5. Evaluation Plan

### When a JA-capable E2E model becomes available:

1. **Quality benchmark** — Compare BLEU/COMET scores on the existing test set (internal JA↔EN evaluation corpus) against the current Whisper + HY-MT1.5-1.8B cascade.
2. **Latency benchmark** — Measure end-to-end latency from audio chunk receipt to translated text output. Target: <1s (improvement over current 0.7–3.1s).
3. **Memory benchmark** — Peak RSS during inference on 8 GB and 16 GB machines.
4. **Error propagation test** — Compare translation quality on noisy audio (background noise, accented speech) where STT errors are most likely to cascade.
5. **Streaming behavior** — Evaluate partial/incremental translation output quality and visual stability in the subtitle overlay.

### Immediate actions:

- [ ] Define `S2TTEngine` interface (audio in → translated text out)
- [ ] Monitor Hikari for public weight release
- [ ] Monitor Hibiki-Zero for JA input language addition
- [ ] Monitor Kyutai for Hibiki MLX models with expanded language support
- [ ] Track SeamlessM4T distillation/quantization efforts (unity.cpp, GGUF)
- [ ] Evaluate SeamlessStreaming Small (281M) as a low-quality experimental engine

## 6. References

- [Hikari paper (arXiv:2603.11578)](https://arxiv.org/abs/2603.11578)
- [Hibiki GitHub](https://github.com/kyutai-labs/hibiki)
- [Hibiki paper (arXiv:2502.03382)](https://arxiv.org/abs/2502.03382)
- [Hibiki-Zero GitHub](https://github.com/kyutai-labs/hibiki-zero)
- [Hibiki-Zero paper (arXiv:2602.11072)](https://arxiv.org/abs/2602.11072)
- [Hibiki-Zero blog post](https://kyutai.org/blog/2026-02-12-hibiki-zero)
- [SeamlessStreaming paper (arXiv:2312.05187)](https://arxiv.org/abs/2312.05187)
- [seamless_communication GitHub](https://github.com/facebookresearch/seamless_communication)
- [Seed LiveInterpret 2.0 (arXiv:2507.17527)](https://arxiv.org/abs/2507.17527)
- [Seed LiveInterpret 2.0 blog](https://seed.bytedance.com/en/blog/seed-liveinterpret-2-0-released-an-end-to-end-simultaneous-interpretation-model-featuring-ultra-high-accuracy-close-to-human-interpreters-low-latency-of-3-seconds-and-real-time-voice-cloning)
- [StreamSpeech GitHub](https://github.com/ictnlp/StreamSpeech)
- [StreamSpeech paper (ACL 2024)](https://aclanthology.org/2024.acl-long.485/)
- [Prior SeamlessStreaming evaluation (#316)](./seamless-streaming-evaluation.md)
