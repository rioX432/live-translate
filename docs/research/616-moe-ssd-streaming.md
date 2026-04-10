# MoE + SSD Expert Streaming for High-Quality Translation

**Issue:** #616
**Date:** 2026-04-10
**Status:** Research complete — promising for quality-mode translation on 16GB+ Apple Silicon, prototype recommended

---

## 1. Background

Current live-translate translation engines face a quality-vs-speed tradeoff:

| Engine | Active Params | Latency | Memory | Quality |
|---|---|---|---|---|
| HY-MT1.5-1.8B (fast default) | 1.8B | ~180ms | ~1GB | Good |
| Hunyuan-MT 7B (quality) | 7B | 3.7s JA→EN | ~4GB | High |
| PLaMo-2 10B (quality) | 10B | TBD | ~5.5GB | High |

Mixture-of-Experts (MoE) models activate only a subset of parameters per token, offering a path to 7B+ quality with 1-3B active compute cost. The key challenge is that the full model weights (e.g., 18GB for Qwen3-30B-A3B Q4_K_M) may exceed available RAM. SSD expert streaming solves this by keeping only active experts in memory and loading others on demand from NVMe storage.

No desktop translation tool currently uses MoE with SSD expert streaming (confirmed frontier per competitive audit).

---

## 2. MoE Architecture Overview

### How MoE Works

In a standard Transformer, every token passes through the same Feed-Forward Network (FFN). In MoE, the FFN is replaced by N parallel "expert" FFNs plus a lightweight router that selects K experts per token. Only the selected experts execute, so compute cost scales with K, not N.

### Qwen3-30B-A3B Specifics

| Property | Value |
|---|---|
| Total parameters | 30.5B |
| Active parameters per token | ~3.3B |
| Expert count | 128 per MoE layer |
| Active experts per token | 8 (routed) |
| Transformer layers | 48 |
| Attention | GQA (32 query heads, 4 KV heads) |
| Context length | 32K native, 131K with YaRN |
| GGUF Q4_K_M size | ~17-18GB |
| Active memory during inference | ~3-5GB (non-expert layers + 8 active experts) |

The 128-expert / 8-active architecture means only 6.25% of expert weights are needed per token. This is the key property that makes SSD streaming viable — 93.75% of expert data can reside on disk.

---

## 3. SSD Expert Streaming Techniques

### 3.1 FlashMoE (arXiv:2601.17063)

**Core idea:** ML-based cache replacement policy for expert caching in SSD-backed MoE inference.

- Offloads inactive experts to SSD, keeps a cache of frequently-used experts in RAM
- Uses a lightweight ML model to predict which experts to keep cached, approximating Belady's optimal policy by combining recency and frequency signals
- Improves cache hit rate by up to **51%** over LRU/LFU baselines
- Achieves up to **2.6x speedup** over existing MoE inference systems
- Designed for edge devices with limited RAM

**Relevance to live-translate:** The ML-based caching strategy is directly applicable. Translation workloads have high expert locality (similar sentence structures reuse similar experts), which should yield even higher cache hit rates than general-purpose LLM tasks.

### 3.2 ZipMoE (arXiv:2601.21198)

**Core idea:** Lossless compression of expert weights to reduce SSD I/O bandwidth requirements.

- Bit-field decomposition: separates tensor elements into low-entropy exponent bits (compressed) and high-entropy sign-mantissa bits (byte-packed)
- Compression is **lossless** — no quality degradation vs. the same quantization level
- Achieves up to **72.77% inference latency reduction** and **6.76x throughput improvement**
- Multi-threaded decompression on CPU hides latency: with 3+ worker threads, decompression is faster than SSD I/O itself
- Shifts the bottleneck from I/O-bound to compute-bound

**Relevance to live-translate:** Combining ZipMoE compression with SSD streaming would reduce expert load times, making real-time translation more feasible on slower SSDs (e.g., base-model MacBook Air at ~1.6 GB/s).

### 3.3 SwiftLM (SharpAI)

**Core idea:** Native MLX inference server with SSD expert streaming for Apple Silicon.

- `--stream-experts` flag bypasses macOS virtual memory swapping for oversized MoE models
- Memory-mapped out-of-core expert loading from NVMe SSD
- Achieved **10.8 tok/s** on a 26B MoE model (4-bit) on M5 Pro 64GB (up from 4.5 tok/s in earlier version)
- Fits 26B model in 22.5GB memory with 40K context on 24GB MacBook Pro
- TurboQuant KV cache compression (~3.6 bits/coord, 3.5x vs FP16)
- **OpenAI-compatible REST API** — easy to integrate as subprocess

**Relevance to live-translate:** SwiftLM is the most directly usable solution. Its OpenAI-compatible API means integration requires only HTTP calls from Electron, no native addon. The `--stream-experts` mode is purpose-built for our use case.

### 3.4 Flash-MoE (danveloper)

**Core idea:** Pure C/Metal inference engine for massive MoE models on Apple Silicon.

- Runs **Qwen3.5-397B-A17B** (209GB) on M3 Max 48GB at **5-5.7 tok/s**
- RAM usage during inference: **~5.5GB** (not 48GB or 209GB)
- Parallel `pread()` SSD reads at **17.5 GB/s** on M3 Max
- Each expert ~3.9MB; loading 4 experts takes <1ms at M3 Max SSD speeds
- No Python, no frameworks — raw C + Metal compute pipeline

**Relevance to live-translate:** Demonstrates that even 397B models are feasible. For Qwen3-30B-A3B (much smaller), SSD streaming overhead would be negligible on M3/M4/M5 hardware.

### 3.5 OD-MoE (arXiv:2512.03927)

**Core idea:** Distributed on-demand expert loading across edge nodes, eliminating expert caches entirely.

- Achieves **99.94% expert activation prediction accuracy**
- Delivers ~75% of fully GPU-cached decoding speed with **1/3 GPU memory**
- Enables MoE inference on nodes with <1GB GPU memory
- Designed for edge-distributed scenarios (multiple IoT devices)

**Relevance to live-translate:** The activation prediction technique is interesting for prefetching experts before they're needed, but the distributed aspect is less relevant for a single-device desktop app.

---

## 4. Apple Silicon NVMe Performance

SSD read bandwidth is the critical bottleneck for expert streaming. Here are measured sequential read speeds:

| Chip | SSD Read Speed | Expert Load Time (8 experts, ~4MB each) |
|---|---|---|
| M2 (base, 256GB) | ~1.6 GB/s | ~20ms |
| M3 (base, 256GB) | ~2.9 GB/s | ~11ms |
| M3 Max (1TB+) | ~5.2 GB/s | ~6ms |
| M4 (base) | ~2.0 GB/s | ~16ms |
| M4 Max (1TB+) | ~5.2 GB/s | ~6ms |
| M5 (1TB+) | ~6.3 GB/s | ~5ms |

**Expert load time estimates** assume 8 active experts at ~4MB each (Q4_K_M Qwen3-30B-A3B) with sequential reads. Actual performance depends on cache hit rate — with FlashMoE-style caching, most tokens hit cached experts and incur zero SSD I/O.

**Key insight:** Even on the slowest Apple Silicon SSD (M2 base at 1.6 GB/s), loading 8 experts takes ~20ms. Combined with expert caching (FlashMoE reports 51% hit rate improvement), the amortized overhead per token should be well under 10ms — acceptable for translation latency.

---

## 5. Feasibility for Real-Time Translation

### Latency Budget

For real-time subtitle translation, the target is <500ms per sentence. A typical sentence is 15-30 tokens.

| Component | Estimated Time |
|---|---|
| MoE routing + expert selection | <1ms |
| Expert SSD load (cache miss) | 5-20ms per layer (amortized) |
| Active expert compute (3.3B) | ~10-20ms per token on M3+ |
| Total per token (cache hit) | ~10-20ms |
| Total per token (cache miss) | ~15-40ms |
| **Sentence (20 tokens, mixed)** | **~200-500ms** |

This is within budget for quality-mode translation and significantly faster than Hunyuan-MT 7B (3.7s).

### Memory Requirements

| Configuration | RAM Needed | Viable Devices |
|---|---|---|
| All experts in RAM (no streaming) | ~18GB | M2 Max 32GB+, M3 Pro 36GB+ |
| SSD streaming (active only) | ~3-5GB | **All Apple Silicon Macs (8GB+)** |
| SSD streaming + ZipMoE compression | ~3-4GB | All Apple Silicon Macs (8GB+) |

SSD streaming unlocks Qwen3-30B-A3B on 8-16GB machines that could previously only run 1.8B models.

### Quality Expectations

Qwen3-30B-A3B activates 3.3B parameters per token but benefits from 30B total capacity through expert specialization. Expected quality positioning:

- Significantly better than HY-MT1.5-1.8B (1.8B dense)
- Comparable to or better than Hunyuan-MT 7B (7B dense) — MoE routing provides effective specialization
- Approaches PLaMo-2 10B quality at much lower active compute cost

Empirical COMET benchmarking is required to confirm (see evaluation plan).

---

## 6. Evaluation Plan

### Phase 1: SwiftLM Prototype (1-2 days)

1. Install SwiftLM on M2/M3/M4 test machine
2. Download Qwen3-30B-A3B-GGUF Q4_K_M (~18GB)
3. Run with `--stream-experts` flag
4. Measure tok/s and per-sentence latency for JA→EN and EN→JA translation prompts
5. Measure RAM usage during inference

### Phase 2: Translation Quality Benchmark (1 day)

1. Use existing test sentence corpus from live-translate benchmarks
2. Run same sentences through HY-MT1.5-1.8B, Hunyuan-MT 7B, and Qwen3-30B-A3B via SwiftLM
3. Compute COMET scores for JA→EN and EN→JA
4. Record latency per sentence for each engine

### Phase 3: Integration Prototype (2-3 days)

1. Create `MoeSsdTranslator.ts` engine implementation
2. Spawn SwiftLM as subprocess (similar pattern to MLX Whisper engine)
3. Communicate via OpenAI-compatible HTTP API (localhost)
4. Implement health check, graceful startup/shutdown, model download
5. Wire into EngineManager with engine ID `moe-ssd-qwen3`

### Phase 4: Optimization (if Phase 1-3 succeed)

1. Implement expert prefetching based on sentence structure
2. Evaluate ZipMoE-style compression for slower SSDs
3. Benchmark on 8GB and 16GB machines
4. Tune cache size vs. RAM availability

---

## 7. Integration Path

### Architecture: MLX Subprocess

```
Electron Main Process
  └── MoeSsdTranslator.ts
        └── spawns SwiftLM subprocess (Swift/MLX)
              ├── OpenAI-compatible HTTP API (localhost:PORT)
              ├── --stream-experts (SSD expert loading)
              └── --model Qwen3-30B-A3B-Q4_K_M.gguf
```

This follows the same pattern as `MlxWhisperEngine.ts` (Python subprocess) but uses Swift/MLX via SwiftLM. The OpenAI-compatible API simplifies integration — the translator sends HTTP POST requests and parses JSON responses.

### Why Not node-llama-cpp?

node-llama-cpp supports Qwen3 MoE but does **not** implement SSD expert streaming. All experts must fit in RAM, requiring ~18GB. SwiftLM's `--stream-experts` mode is the differentiator that enables 8-16GB machines.

### Model Management

- Model download: reuse existing `model-downloader.ts` with resume support and SHA256 verification
- Model path: `app.getPath('userData')/models/qwen3-30b-a3b-q4_k_m.gguf`
- SwiftLM binary: bundle as platform-specific dependency or download on first use
- Fallback: if SSD streaming unavailable, fall back to HY-MT1.5-1.8B

### Engine Registration

```typescript
// In initPipeline() — register as experimental initially
engineManager.registerTranslator('moe-ssd-qwen3', {
  name: 'Qwen3-30B-A3B (MoE SSD)',
  factory: () => new MoeSsdTranslator(),
  experimental: true,
  minMemoryGB: 8,
  diskRequirementGB: 20,
});
```

---

## 8. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| SwiftLM stability / maintenance | Medium | It's actively maintained; fallback to flash-moe C implementation |
| SSD wear from repeated expert reads | Low | Expert caching minimizes reads; NVMe rated for hundreds of TBW |
| Base MacBook Air M2 SSD too slow | Medium | ZipMoE compression reduces I/O; test and set minimum SSD speed |
| 18GB model download size | Medium | Resume support already in model-downloader.ts; background download |
| Translation quality unverified | High | Must benchmark COMET before promoting to primary engine |
| macOS thermal throttling during sustained use | Low | MoE active compute is only 3.3B — lower thermal load than 7B dense |
| SwiftLM binary distribution | Medium | Can bundle as optional download; macOS code signing required |

---

## 9. Conclusion

MoE + SSD expert streaming is a viable path to 7B+ translation quality on consumer Apple Silicon hardware with as little as 8GB RAM. The combination of:

1. **Qwen3-30B-A3B** (3.3B active / 30B total, 128 experts)
2. **SwiftLM** (production-ready MLX SSD streaming with OpenAI API)
3. **Apple Silicon NVMe** (1.6-6.3 GB/s, fast enough for <20ms expert loading)

...makes this feasible for quality-mode translation at ~200-500ms per sentence, a significant improvement over Hunyuan-MT 7B (3.7s).

**Recommendation:** Proceed with Phase 1 (SwiftLM prototype) to validate latency and quality empirically.

---

## References

- [FlashMoE: ML-Based Cache Replacement for MoE on Edge Devices](https://arxiv.org/abs/2601.17063) — arXiv:2601.17063 (Jan 2026)
- [ZipMoE: Lossless Compression for On-Device MoE](https://arxiv.org/abs/2601.21198) — arXiv:2601.21198 (Jan 2026)
- [SwiftLM: Native MLX Inference Server](https://github.com/SharpAI/SwiftLM) — SharpAI (active development)
- [Flash-MoE: 397B on MacBook](https://github.com/danveloper/flash-moe) — danveloper (Mar 2026)
- [OD-MoE: On-Demand Expert Loading](https://arxiv.org/abs/2512.03927) — arXiv:2512.03927 (Dec 2025)
- [Qwen3-30B-A3B Model Card](https://huggingface.co/Qwen/Qwen3-30B-A3B) — Hugging Face
- [Qwen3-30B-A3B GGUF](https://huggingface.co/Qwen/Qwen3-30B-A3B-GGUF) — Official GGUF quantizations
- [Apple LLM in a Flash](https://simonwillison.net/2026/Mar/18/llm-in-a-flash/) — Simon Willison's analysis
- [M5 SSD benchmarks](https://www.tomshardware.com/laptops/macbooks/m5-macbook-pros-ssd-is-2-5x-faster-on-average-than-last-gen-m4-exceeding-apples-own-claims-m5-achieves-6-000-mb-s-across-both-read-and-write-speeds) — Tom's Hardware
