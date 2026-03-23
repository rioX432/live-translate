# Qwen3-ASR Evaluation for live-translate

**Issue:** #268
**Date:** 2026-03-23
**Status:** Research complete — integration viable via Python bridge (recommended) or Rust/NAPI-RS (future)

## 1. Model Overview

Qwen3-ASR is an open-source ASR model series by Alibaba/Qwen (Apache-2.0 license), built on the Qwen3-Omni audio foundation model.

| Variant | Params | GGUF Q4_K Size | GGUF Q8_0 Size | Key Metric |
|---------|--------|---------------|---------------|------------|
| Qwen3-ASR-0.6B | 0.6B | 577 MB | 966 MB | 92ms TTFT, 2000x throughput @128 streams |
| Qwen3-ASR-1.7B | 2B | 1.2 GB | 2.3 GB | SOTA open-source ASR, competitive with GPT-4o |

### Language Support (52 languages/dialects)
- **30 primary languages:** zh, en, yue (Cantonese), ar, de, fr, es, pt, id, it, ko, ru, th, vi, ja, tr, hi, ms, nl, sv, da, fi, pl, cs, fil, fa, el, hu, mk, ro
- **22 Chinese dialects** (Wu, Minnan, Hakka, etc.)
- **English regional accents** (US, UK, AU, IN, etc.)

### Benchmark Results
| Test Set | Qwen3-ASR-1.7B | Whisper large-v3 | GPT-4o |
|----------|---------------|-----------------|--------|
| LibriSpeech clean (WER) | 1.63 | 1.80 | 1.50 |
| Fleurs-zh (WER) | 2.41 | — | 3.20 |
| Fleurs 12-lang avg (WER) | 4.90 | 5.70 | 5.10 |
| Language ID accuracy | 97.9% | — | — |

## 2. Integration Options Evaluated

### Option A: Python Bridge (like MlxWhisperEngine) — RECOMMENDED

**How:** Spawn a Python subprocess with JSON-over-stdio protocol, same pattern as `MlxWhisperEngine`.

**Pros:**
- Official `qwen-asr` Python package is mature and well-tested
- Full feature support (batch, streaming, timestamps, language detection)
- Proven pattern already exists in the codebase (`MlxWhisperEngine`)
- Works on macOS (CPU/Metal via MPS), Linux (CUDA), Windows (CUDA)
- Model auto-downloads from HuggingFace Hub

**Cons:**
- Requires Python 3.12+ with `qwen-asr` installed (~2GB+ with PyTorch)
- Higher memory footprint than native integration
- Subprocess startup latency (~2-5s)

**Effort:** Low-medium. Reuse `MlxWhisperEngine` pattern with a new bridge script.

### Option B: ONNX via Transformers.js (like MoonshineEngine) — NOT VIABLE

**Why not:**
- No official ONNX export for Qwen3-ASR exists
- Qwen3-ASR uses a custom multimodal architecture (audio encoder + Qwen3 decoder) that is not supported by standard ONNX exporters
- Transformers.js does not have a Qwen3-ASR pipeline implementation
- The `automatic-speech-recognition` pipeline in Transformers.js is designed for Whisper/Moonshine architectures

### Option C: GGUF via Rust (qwen3-asr-rs) + NAPI-RS — FUTURE OPTION

**How:** The `qwen3-asr-rs` crate provides a pure-Rust inference engine using Candle. Could be wrapped with NAPI-RS to create a Node.js native addon.

**Pros:**
- No Python dependency — fully native
- Metal (Apple Silicon) and CUDA GPU acceleration
- GGUF quantized models: 0.6B Q4_K = 577MB, 1.7B Q4_K = 1.2GB
- 4x real-time speed on Apple M4 (0.6B model)
- MIT licensed

**Cons:**
- NAPI-RS bindings don't exist yet — would need to be built
- `qwen3-asr-rs` is relatively new; API may change
- Building native Rust addons adds CI/CD complexity (cross-compilation)
- Candle's Metal backend is less mature than PyTorch's MPS

**Effort:** High. Requires building NAPI-RS wrapper, cross-platform CI, and testing.

### Option D: GGUF via node-llama-cpp (like TranslateGemma) — NOT VIABLE

**Why not:**
- node-llama-cpp / llama.cpp is designed for text-only LLMs
- Qwen3-ASR has a specialized audio encoder (mel spectrogram → Conv2d → Transformer) that llama.cpp cannot run
- The GGUF files for Qwen3-ASR are specifically designed for the `qwen3-asr-rs` Candle engine, not llama.cpp

### Option E: Direct ONNX Runtime for Node.js — NOT VIABLE

**Why not:**
- Same as Option B: no ONNX model available
- Even if exported, the custom audio encoder pipeline would need manual implementation in JS

## 3. Recommendation

### Short-term (P3): Python Bridge

Implement `QwenASREngine` using the same subprocess pattern as `MlxWhisperEngine`:

1. Create `resources/qwen-asr-bridge.py` — JSON-over-stdio bridge using `qwen-asr` package
2. Create `src/engines/stt/QwenASREngine.ts` — TypeScript wrapper (copy MlxWhisperEngine pattern)
3. Register in `src/main/index.ts` → `initPipeline()`
4. Add to SettingsPanel with variant selector (0.6B / 1.7B)

**Prerequisites for users:**
```bash
python3 -m venv ~/qwen-asr-env
~/qwen-asr-env/bin/pip install qwen-asr
```

### Long-term (P4+): Rust/NAPI-RS Native Addon

When `qwen3-asr-rs` stabilizes:
1. Create a NAPI-RS wrapper crate (`qwen3-asr-node`)
2. Publish prebuilt binaries for macOS (arm64), Linux (x86_64), Windows (x86_64)
3. Replace Python bridge with native addon for zero-dependency UX

## 4. Architecture Comparison with Existing Engines

| Engine | Integration | Model Format | Size | GPU | Language Detection |
|--------|------------|-------------|------|-----|-------------------|
| WhisperLocal | Native addon (whisper.cpp) | GGML | 540-600MB | Metal | Script heuristic |
| MlxWhisper | Python subprocess | Safetensors | ~1.5GB | Apple MPS | Built-in (Whisper) |
| Moonshine | Transformers.js (ONNX) | ONNX q8 | 60-130MB | CPU only | Script heuristic |
| **QwenASR** (proposed) | Python subprocess | Safetensors | ~3.5GB (1.7B) | CUDA/MPS | **Built-in (97.9% acc)** |

## 5. Key Advantages for live-translate

1. **CJK accuracy**: Significantly better than Whisper for Chinese/Japanese/Korean
2. **Built-in language detection**: 97.9% accuracy across 52 languages — eliminates our script-based heuristic
3. **Chinese dialect support**: 22 dialects not covered by any other engine
4. **Streaming mode**: Available via vLLM backend for real-time subtitles
5. **Apache-2.0 license**: Fully compatible with our project

## 6. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Python dependency burden | Clear setup docs; detect missing deps at startup with helpful error |
| Large model size (3.5GB for 1.7B) | Default to 0.6B variant (~1.8GB); progressive download with resume |
| GPU memory pressure | 0.6B model uses only ~1.9GB RAM; CPU fallback available |
| vLLM required for streaming | Start with batch mode (Transformers backend); add vLLM streaming later |
| macOS: no CUDA | PyTorch MPS backend works; performance TBD |

## References

- [Qwen3-ASR GitHub](https://github.com/QwenLM/Qwen3-ASR)
- [Qwen3-ASR-1.7B on HuggingFace](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)
- [Qwen3-ASR GGUF (community)](https://huggingface.co/Alkd/qwen3-asr-gguf)
- [qwen3-asr-rs (Rust engine)](https://github.com/alan890104/qwen3-asr-rs)
- [ArXiv paper](https://arxiv.org/abs/2601.21337)
