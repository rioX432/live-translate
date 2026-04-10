# RWKV-7 SSM Fine-Tuning for JA↔EN Translation

**Issue:** #618
**Date:** 2026-04-10
**Status:** Research complete — promising but high-risk; no production MT system uses SSMs yet

## 1. Background

All current live-translate translation engines are transformer-based (HY-MT1.5-1.8B, Hunyuan-MT 7B, PLaMo-2 10B, OPUS-MT). Transformers have O(n^2) attention complexity and growing KV-cache memory during long meeting sessions. State Space Models (SSMs) offer O(n) training and O(1) per-token inference with constant memory, which is theoretically ideal for hours-long real-time translation.

No competitor or production MT system currently uses an SSM-based translation engine. This would be genuinely novel differentiation if quality is sufficient.

## 2. SSM Architecture Advantages for Real-Time Translation

| Property | Transformer | SSM (RWKV-7 / Mamba) |
|----------|------------|----------------------|
| Training complexity | O(n^2) | O(n) |
| Inference per token | O(n) KV-cache lookup | O(1) constant |
| Memory during inference | Grows with context (KV-cache) | Constant (fixed state size) |
| Throughput | Baseline | Up to 5x higher (reported) |
| Long-session stability | Degrades as KV-cache grows | Stable indefinitely |

For live-translate's use case (continuous translation over 1-8 hour meetings), constant memory is the key advantage. Current transformer engines must periodically flush context to prevent OOM, losing translation coherence.

## 3. RWKV-7 "Goose" Specifications

**Released:** March 2025 | **License:** Apache 2.0 | **Paper:** [arXiv:2503.14456](https://arxiv.org/abs/2503.14456)

### Architecture

RWKV-7 introduces a generalized delta rule with vector-valued gating and in-context learning rates, plus a relaxed value replacement rule. It can perform state tracking and recognize all regular languages — exceeding transformer capabilities under standard complexity conjectures (TC^0 limitation).

### Model Sizes

Four models released: 0.19B, 0.4B, 1.5B, and 2.9B parameters, trained on a 3.1 trillion token multilingual corpus.

### Benchmarks (2.9B)

| Benchmark | RWKV-7 2.9B | Notes |
|-----------|-------------|-------|
| MMLU | 54.56% | Up from 32.38% (RWKV-6 3.1B) |
| Multilingual tasks | New 3B SoTA | Outperforms peers with fewer training FLOPs |
| English downstream | Matches 3B SoTA | Competitive with Qwen2.5-3B, Llama-3.2-3B |

### RWKV-X Hybrid (April 2025)

[RWKV-X](https://arxiv.org/abs/2504.21463) integrates RWKV-7 blocks with Top-k Chunk Sparse Attention, achieving linear training complexity and constant inference decoding while improving long-context performance. Near-perfect 64K passkey retrieval. Relevant if pure RWKV-7 struggles with MT alignment.

### Mamba-3 (March 2026)

[Mamba-3](https://arxiv.org/abs/2603.15569) introduces exponential-trapezoidal discretization, complex-valued state updates, and MIMO formulation. Key result: **halves state size** (64 matches Mamba-2's 128) while improving accuracy by 1.8 points at 1.5B scale. Relevant as a competing SSM architecture but lacks RWKV's mature tooling ecosystem.

## 4. SSM for Machine Translation: Current Evidence

### Positive Signals

- **Mamba is competitive at sentence level:** [Deng et al., 2024](https://arxiv.org/abs/2407.05489) (WMT 2024) found Mamba competitive with transformers on sentence-level and paragraph-level MT when trained from scratch or fine-tuned from pretrained checkpoints.
- **Hybrid SSM+attention closes gap:** Adding attention layers to Mamba improves translation quality, robustness to length extrapolation, and named entity recall.
- **Inference advantage is real:** ~11x latency reduction and 10x throughput improvement reported in structured tasks (Mamba vs transformer encoder, 2025).

### Negative Signals

- **Apple's finding (2024):** ["State Spaces Aren't Enough: Machine Translation Needs Attention"](https://arxiv.org/abs/2304.12776) — S4 lags transformers by ~4 BLEU points on WMT'14/WMT'16. Caused by inability to summarize full source in a single hidden state. Gap closes with attention augmentation.
- **No production MT uses SSMs:** All major MT systems (Google, DeepL, NLLB, Hunyuan-MT) remain transformer-based.
- **Length sensitivity:** Pure SSMs struggle with longer sentences at paragraph level, requiring distribution-shifted training data.

### Assessment

RWKV-7 is significantly more capable than S4 (Apple's 2023 study used S4, not modern SSMs). The Mamba MT paper (2024) shows modern SSMs are competitive. However, no one has validated RWKV-7 specifically for JA↔EN translation, and the language pair's word order divergence (SOV↔SVO) may stress SSM's single-state bottleneck more than European language pairs.

## 5. llama.cpp / node-llama-cpp Compatibility

### Current Status

RWKV-7 GGUF models are **supported in llama.cpp** as of early 2026:
- Pre-quantized GGUF models available at [HuggingFace RWKV](https://huggingface.co/BlinkDL/rwkv-7-world)
- Quantization priority: FP16 > Q8_0 > Q5_K_M > Q4_K_M
- Chat template (`rwkv-world`) supported in llama.cpp server
- Example: `./llama-cli -m rwkv-7-world-2.9b-Q8_0.gguf`

### Integration with live-translate

Since live-translate already runs node-llama-cpp via `worker-pool.ts` → `slm-worker.ts` UtilityProcess, RWKV-7 GGUF should slot in with minimal integration work:

1. Download RWKV-7-World-2.9B GGUF (Q4_K_M: ~1.6GB, Q8_0: ~3.1GB)
2. Load via existing `slm-worker.ts` infrastructure
3. Use `rwkv-world` chat template for translation prompts

**Risk:** node-llama-cpp's RWKV support is less battle-tested than transformer model support. State management (init/reset between segments) needs validation — RWKV's recurrent state persists across tokens, which is the feature we want but may need explicit reset between unrelated segments.

## 6. Fine-Tuning Approach

### Tooling: RWKV-PEFT

[RWKV-PEFT](https://github.com/Joluck/RWKV-PEFT) is the official community fine-tuning framework supporting:
- **LoRA** — standard parameter-efficient tuning
- **PiSSA** — Principal Singular values and Singular vectors Adaptation
- **Bone** — block-oriented efficient tuning
- **State Tuning** — RWKV-specific method that only tunes the initial state vectors
- INT8/NF4 quantized training for VRAM reduction

### Hardware Requirements

| Method | Model | VRAM | Notes |
|--------|-------|------|-------|
| LoRA (r=64) | RWKV-6 3B | ~12GB | RTX 4090 tested, ctx_len=1024 |
| LoRA (r=64) | RWKV-7 3B | ~10-12GB (est.) | Slightly lower than RWKV-6 |
| State Tuning | RWKV-7 3B | ~6-8GB (est.) | Only tunes initial state |
| Full fine-tune | RWKV-7 3B | ~24GB+ | Not recommended for this use case |

### Training Data

| Corpus | Size | Domain | Notes |
|--------|------|--------|-------|
| JParaCrawl v3.0 | 21M pairs | Web crawl | Largest JA↔EN corpus, noisy |
| JESC | 3.2M pairs | Subtitles | Conversational, closest to meeting speech |
| WMT JA↔EN | ~15M pairs | Mixed | Standard benchmark data |
| ASPEC | 3M pairs | Scientific | Domain-specific |

**Recommended strategy:**
1. Start with JESC (conversational domain, closest to meeting translation)
2. Mix in filtered JParaCrawl (top-quality pairs by alignment score)
3. Target 500K-2M high-quality pairs for LoRA fine-tuning
4. Data format: JSONL → binidx conversion (RWKV-PEFT requirement)

### Prompt Template

```
User: Translate Japanese to English: {source}
Assistant: {target}
```

Use loss masking on the instruction portion (RWKV-PEFT supports this).

## 7. Evaluation Plan

### Metrics

| Metric | Target | Baseline (HY-MT1.5-1.8B) |
|--------|--------|---------------------------|
| COMET-22 | ≥0.83 | ~0.85 (estimated) |
| BLEU (WMT JA→EN) | ≥25 | ~27 (estimated) |
| Latency (per segment) | ≤200ms | ~180ms |
| Memory (steady state) | ≤1.5GB | ~1GB |
| Memory after 1hr | Same as start | Grows with KV-cache |

### Test Protocol

1. **Zero-shot baseline:** RWKV-7-World-2.9B with translation prompts (no fine-tuning)
2. **Fine-tuned evaluation:** LoRA-tuned model on WMT testsets + internal meeting transcripts
3. **Long-session test:** 2-hour simulated meeting, measure memory and quality drift
4. **A/B comparison:** Side-by-side with HY-MT1.5-1.8B on same audio segments
5. **Domain robustness:** Test on technical meetings, casual conversation, mixed-language

### Go/No-Go Criteria

- **Go:** COMET within 5% of HY-MT1.5-1.8B AND memory advantage confirmed in 1hr+ sessions
- **No-go:** COMET drops >10% vs baseline OR latency exceeds 300ms on Apple Silicon

## 8. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| No production MT uses SSMs | High | This is exploratory research; keep HY-MT1.5-1.8B as default |
| JA↔EN word order divergence stresses single-state | High | Test RWKV-X hybrid if pure RWKV-7 underperforms |
| node-llama-cpp RWKV state management bugs | Medium | Test thoroughly; fallback to rwkv.cpp if needed |
| Quality gap vs transformer MT | Medium | Accept if within 5% COMET; position as "efficiency mode" |
| GGUF quantization quality loss | Low | Use Q8_0 minimum; benchmark each quantization level |
| Fine-tuning data quality | Low | Use established corpora; filter by alignment scores |

### Contingency: RWKV-X Hybrid

If pure RWKV-7 fails the MT quality bar, RWKV-X's sparse attention hybrid maintains linear complexity while adding source-sentence alignment capability. This directly addresses Apple's finding about SSMs needing attention for MT.

## 9. Integration Estimate

| Phase | Effort | Dependency |
|-------|--------|------------|
| Zero-shot evaluation | 2 days | Download RWKV-7 GGUF |
| LoRA fine-tuning | 3-5 days | GPU access (RTX 4090 or cloud) |
| GGUF conversion + quantization | 1 day | Fine-tuned model |
| Engine implementation (`RwkvTranslator.ts`) | 2 days | Existing slm-worker.ts infrastructure |
| Benchmarking + long-session tests | 2 days | All above |
| **Total** | **10-15 days** | |

## 10. Recommendation

**Proceed with zero-shot evaluation first** (2 days, low cost). RWKV-7's constant-memory property is uniquely valuable for live-translate's long-session use case, and llama.cpp compatibility means integration effort is minimal. However, the lack of any production SSM-based MT system is a significant risk signal.

If zero-shot quality is within 20% COMET of HY-MT1.5-1.8B, proceed with LoRA fine-tuning. If zero-shot is catastrophically poor (>30% gap), deprioritize in favor of established transformer models.

The constant-memory advantage only matters in practice if users run sessions longer than ~30 minutes (where transformer KV-cache growth becomes measurable). For short sessions, HY-MT1.5-1.8B remains the better choice.

## 11. References

- [RWKV-7 "Goose" Paper](https://arxiv.org/abs/2503.14456) — Architecture and multilingual benchmarks
- [Mamba-3 Paper](https://arxiv.org/abs/2603.15569) — 2x state size reduction, MIMO formulation
- [RWKV-X Hybrid](https://arxiv.org/abs/2504.21463) — Sparse attention augmentation for long-context
- [SSMs for MT (Deng et al., WMT 2024)](https://arxiv.org/abs/2407.05489) — Mamba competitive at sentence-level MT
- [State Spaces Aren't Enough (Apple, 2024)](https://arxiv.org/abs/2304.12776) — S4 lags transformers by ~4 BLEU in MT
- [RWKV-PEFT](https://github.com/Joluck/RWKV-PEFT) — Fine-tuning framework (LoRA, PiSSA, State Tuning)
- [RWKV GGUF in llama.cpp](https://wiki.rwkv.com/inference/llamacpp.html) — Inference setup guide
- [JParaCrawl v3.0](https://arxiv.org/abs/2202.12607) — 21M JA↔EN parallel sentence pairs
- [RWKV Models on HuggingFace](https://huggingface.co/BlinkDL/rwkv-7-world) — Pre-trained and quantized models
