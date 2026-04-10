# ANE-Accelerated Translation via ANEMLL

**Issue:** #619
**Date:** 2026-04-10
**Status:** Research complete — feasible for 1B-class translation models; hybrid ANE+MLX most promising path

---

## 1. Summary

ANEMLL (Artificial Neural Engine Machine Learning Library) is an open-source pipeline that converts Hugging Face transformer models to CoreML format optimized for Apple Neural Engine (ANE) inference. On 1B-class models, ANEMLL achieves 47-62 tok/s at roughly 1/10 the power draw of GPU inference (2W vs 20W). A separate hybrid ANE+MLX approach (AtomGradient) demonstrates 268 tok/s on 0.8B models via batch ANE dispatch, a 11.3x speedup over sequential dispatch. The Orion system (arXiv:2603.06728) reveals that current public CoreML APIs utilize only 5-9% of peak ANE capacity, suggesting significant headroom.

For live-translate, the primary opportunity is converting HY-MT1.5-1.8B (current fast default, ~180ms via llama.cpp Metal) to CoreML for ANE execution. This would reduce power consumption from ~20W to ~2W while maintaining comparable latency — critical for laptop battery life during long meetings.

---

## 2. ANE Hardware Overview

### Architecture

The Apple Neural Engine is a fixed-function matrix multiply accelerator present in all Apple Silicon chips. It is optimized for 16-bit inference on small-to-medium tensors with strict layout requirements.

| Chip | ANE TOPS | ANE TFLOPS (FP16) | GPU TFLOPS | Memory BW |
|------|----------|-------------------|------------|-----------|
| M1 | 11 | — | 2.6 | 68 GB/s |
| M2 | 15.8 | — | 3.6 | 100 GB/s |
| M3 | 18 | — | — | 100 GB/s |
| M4 | 38 | ~20 | — | 120 GB/s |
| M4 Pro | 38 | ~20 | — | 273 GB/s |
| M4 Max | 38 | ~20 | — | 546 GB/s |

### Power Characteristics

ANE inference runs at approximately 2W vs 20W for GPU Metal inference — a 10x reduction. AtomGradient's hybrid benchmark measured ANE prefill reducing GPU power from 62.05W to 0.22W (282x reduction in prefill phase specifically).

### Key Constraints (20 documented by Orion)

1. **Tensor format:** Must use (B, C, 1, S) layout; last axis contiguous, 64-byte aligned
2. **Max tensor dimensions:** 5D only (6D operations like windowed attention need reshaping)
3. **Singleton axis padding:** If last axis is singleton, padded to 64 bytes (32x memory cost at FP16)
4. **Compilation limit:** ~119 compilations per process lifetime
5. **Attention heads:** Must be split into single-head operations for L2 residency and parallelism
6. **No dynamic shapes:** Sequence length must be fixed at compile time (chunked inference required)
7. **Model size:** Practical limit varies by chip; 1B models fit well, 8B models degrade to ~9 tok/s
8. **No training support via CoreML:** Orion bypasses CoreML entirely for training via private APIs
9. **CoreML routing:** macOS 26.3 `compute_units=ALL` may route to GPU instead of ANE (confirmed by AtomGradient)
10. **Recompilation cost:** 4,200ms per step via standard CoreML; Orion reduces to 494ms via weight patching

---

## 3. ANEMLL Capabilities

### Project Status

- **Version:** Beta 0.3.5 (March 2026)
- **License:** Open source
- **Repository:** https://github.com/Anemll/Anemll

### Supported Architectures

| Architecture | Models | Notes |
|---|---|---|
| LLaMA | Llama 3.1/3.2 (1B, 8B) | Full support |
| Qwen | Qwen 2.5/3 (0.6B-8B) | Full support |
| Gemma | Gemma 3 (270M, 1B, 4B QAT) | Sliding-window + global attention, FP16 |
| DeepSeek | DeepSeek R1 8B | Full support |
| DeepHermes | 3B, 8B | Full support |

### Conversion Pipeline

```
HuggingFace Model → ANEMLL convert_model.sh → CoreML (.mlpackage) → ANE Inference
```

Steps:
1. Install dependencies: `pip install anemll coremltools transformers pyyaml numpy torch` (Python 3.9-3.11)
2. Convert: `./anemll/utils/convert_model.sh --model <hf_model> --output <dir>`
3. Options: `--argmax` (in-model argmax, outputs winner index instead of full logits), `--monolithic` (single-file)
4. ANEMLL-Dedup: ~50% model size reduction via deduplication

### Performance

| Model | Size | tok/s (ANE) | tok/s (MLX GPU) | Memory (ANE) | Memory (GPU) |
|-------|------|-------------|-----------------|--------------|--------------|
| 1B class | ~1GB | 47-62 | ~80-100 | ~500MB | ~2GB |
| 8B class | ~4GB | ~9 | ~93 | ~500MB | ~8GB |

Key trade-off: ANE is 30-50% slower than GPU on throughput but uses 10x less power and 4-16x less memory.

---

## 4. Hybrid ANE+MLX Approach

### AtomGradient Benchmark

The hybrid-ane-mlx-bench project explores disaggregated inference: ANE handles prefill (prompt processing), MLX GPU handles decode (token generation).

| Strategy | Model | tok/s | Power | Notes |
|----------|-------|-------|-------|-------|
| MLX GPU only | Qwen3.5-0.8B | ~24 | 62W | Baseline |
| CoreML sequential | Qwen3.5-0.8B | ~24 | 0.22W (prefill) | Standard CoreML dispatch |
| ANE batch dispatch | Qwen3.5-0.8B | **268** | Low | Private API, 11.3x speedup |
| Hybrid ANE+MLX | Qwen3.5-9B | ~47-50 | Mixed | 11-16% decode degradation |

### Caveats

- **268 tok/s requires private API:** `_ANEClient` batch dispatch is not public CoreML API
- **macOS 26.3 regression:** `compute_units=ALL` routes to GPU, not ANE — explicit ANE targeting needed
- **9B crossover:** Hybrid approach is always slower than GPU-only for 9B+ models
- **Cache bridge overhead:** Mixed-precision cache bridge between ANE prefill and MLX decode causes 11-16% degradation

### Practical Implication

For translation (short input, short output), the hybrid approach adds complexity without clear benefit. Pure ANE via ANEMLL is simpler and sufficient for 1B-class translation models where the primary goal is power savings, not peak throughput.

---

## 5. Orion System Discoveries

### Paper: arXiv:2603.06728

Orion is the first open system that bypasses CoreML entirely, using Apple's private `_ANEClient` and `_ANECompiler` APIs for direct ANE execution.

### Key Findings

| Finding | Detail |
|---------|--------|
| Public API utilization | 5-9% of peak ANE capacity via CoreML |
| Direct API throughput | 170+ tok/s for GPT-2 124M on M4 Max |
| Weight patching | 8.5x faster than recompilation (494ms vs 4,200ms) |
| Training | First stable ANE training: 110M transformer, 1,000 steps in 22 min |
| Constraint catalog | 20 restrictions documented (14 previously unknown) |

### Relevance to live-translate

Orion's private API approach is not suitable for production distribution (App Store rejection risk, API stability unknown). However, its constraint catalog is invaluable for understanding what models can and cannot run on ANE. The 5-9% utilization finding suggests CoreML-based approaches (like ANEMLL) have significant optimization headroom as Apple improves CoreML ANE scheduling.

---

## 6. Integration Architecture

### Current State

`ANETranslator.ts` already exists as an experimental engine using `SubprocessBridge` to spawn a Python process running `ane-translate-bridge.py`. This uses ANEMLL for CoreML conversion and inference.

### Proposed Architecture: Swift Subprocess

For production quality, a Swift-based subprocess is preferred over Python:

```
Electron Main Process
  └── UtilityProcess (or child_process.spawn)
        └── Swift CLI binary (ane-translate-swift)
              ├── CoreML Framework (ANE inference)
              ├── Pre-converted .mlpackage model
              └── JSON-line stdio protocol
```

**Why Swift over Python:**
- No Python runtime dependency for end users
- Direct CoreML/Foundation access without Python bridge overhead
- Smaller distribution size (~5MB binary vs ~500MB Python + deps)
- Better ANE scheduling control via native CoreML APIs
- Apple's official Electron docs recommend Swift for native macOS integration

**Integration patterns (from Electron docs):**
1. **Native Node.js addon** via `node-mac-swift-addon` — compile Swift into `.node` shared library
2. **Subprocess** via `child_process.spawn` — standalone Swift CLI binary with stdio JSON protocol
3. **XPC Service** — macOS-native IPC, most robust but complex setup

Recommended: **Subprocess pattern** (option 2) for consistency with existing `SubprocessBridge` architecture used by `ANETranslator.ts`, `SpeechSwiftEngine.ts`, and other engines.

### Model Conversion Strategy

Pre-convert models at build time (not runtime) to avoid the 4,200ms compilation cost:

1. Convert HY-MT1.5-1.8B to CoreML `.mlpackage` via ANEMLL during CI
2. Ship pre-converted model in app bundle or download on first use
3. Context length fixed at 512 tokens (sufficient for sentence-level translation)
4. Use `--argmax --monolithic` flags for single-file, optimized output

---

## 7. Feasibility for Translation Models

### HY-MT1.5-1.8B (Current Fast Default)

| Aspect | Assessment |
|--------|-----------|
| Architecture | Based on Qwen2.5 — ANEMLL has full Qwen support |
| Size | 1.8B parameters — within ANE sweet spot (1B class: 47-62 tok/s) |
| Expected ANE throughput | ~40-55 tok/s (estimated from 1B benchmarks, 1.8B slightly slower) |
| Expected latency | ~100-200ms for typical translation output (5-10 tokens) |
| Power savings | ~10x reduction (2W vs 20W) |
| Memory savings | ~4x reduction (~500MB vs ~2GB) |
| Conversion feasibility | High — Qwen architecture fully supported by ANEMLL |

### Comparison with Current llama.cpp Metal

| Metric | llama.cpp Metal | ANEMLL ANE (estimated) |
|--------|----------------|----------------------|
| Latency (JA->EN) | ~180ms | ~100-200ms |
| Power | ~20W | ~2W |
| Memory | ~1GB (GGUF Q4) | ~500MB-1GB |
| Platform | macOS + Windows + Linux | macOS only (Apple Silicon) |
| Offline | Yes | Yes |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| ANE throughput lower than estimated | Medium | Fallback to existing llama.cpp Metal engine |
| CoreML conversion fails for HY-MT | Low | ANEMLL supports Qwen architecture; conversion path is proven |
| macOS 26.3 routing to GPU | Medium | Pin CoreML compute units to ANE only; monitor Apple updates |
| Swift subprocess adds latency | Low | SubprocessBridge pattern already proven in codebase |
| macOS-only limitation | Low | ANE is Apple Silicon only by definition; llama.cpp remains cross-platform default |
| ANEMLL beta stability | Medium | Pin to specific version; thorough testing before promotion |

---

## 8. Evaluation Plan

### Phase 1: Model Conversion (1 day)

1. Set up ANEMLL environment (Python 3.11, dependencies)
2. Convert HY-MT1.5-1.8B to CoreML via `convert_model.sh --model tencent/HunyuanTranslate-1.5-1.8B --argmax --monolithic`
3. Verify conversion succeeds and model loads on ANE
4. Test basic translation quality (JA->EN, EN->JA sample set)

### Phase 2: Benchmark (1 day)

1. Measure tok/s on M-series chips (M1, M3, M4 if available)
2. Measure end-to-end translation latency (including subprocess overhead)
3. Monitor power consumption via `powermetrics` during sustained translation
4. Compare memory usage vs llama.cpp Metal baseline
5. Run BLEU/COMET quality comparison against llama.cpp baseline

### Phase 3: Integration (2 days)

1. Update existing `ANETranslator.ts` to use pre-converted model
2. Add model download support for CoreML `.mlpackage`
3. Test hot-swap between ANE and llama.cpp engines
4. Evaluate Swift subprocess migration (if Python overhead is significant)

### Phase 4: Decision Gate

Promote to primary engine if:
- Translation latency <= 250ms (end-to-end)
- Quality degradation < 5% vs llama.cpp baseline (BLEU/COMET)
- Power consumption <= 3W sustained
- Stable across 1000+ consecutive translations without crash

Otherwise: Keep as experimental battery-saver option alongside llama.cpp default.

---

## 9. References

- [ANEMLL GitHub Repository](https://github.com/Anemll/Anemll) — Open-source ANE ML Library (Beta 0.3.5)
- [ANEMLL Official Site](https://www.anemll.com/)
- [ANEMLL-Bench](https://github.com/Anemll/anemll-bench) — ANE performance benchmarking tool
- [Orion: Characterizing and Programming Apple's Neural Engine (arXiv:2603.06728)](https://arxiv.org/abs/2603.06728) — Direct ANE programming, constraint catalog
- [Orion GitHub](https://github.com/mechramc/Orion) — MIT-licensed ANE runtime
- [AtomGradient hybrid-ane-mlx-bench](https://github.com/AtomGradient/hybrid-ane-mlx-bench) — Disaggregated ANE prefill + MLX decode benchmarks
- [Apple: Deploying Transformers on the ANE](https://machinelearning.apple.com/research/neural-engine-transformers) — Official tensor layout and optimization guide
- [Apple ml-ane-transformers](https://github.com/apple/ml-ane-transformers) — Reference ANE-optimized transformer implementation
- [Electron: Native Code and Swift (macOS)](https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron-swift-macos) — Official Swift integration guide
- [InsiderLLM: Apple Neural Engine for LLM Inference](https://insiderllm.com/guides/apple-neural-engine-llm-inference/) — Practical ANE LLM guide
- [SqueezeBits: Disaggregated Inference on Apple Silicon](https://blog.squeezebits.com/disaggregated-inference-on-apple-silicon-npu-prefill-and-gpu-decode-67176) — NPU prefill analysis
- [hollance/neural-engine](https://github.com/hollance/neural-engine) — Community ANE documentation
