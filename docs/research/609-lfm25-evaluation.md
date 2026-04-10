# Research: LFM2.5-1.2B-JP as Improved Draft/Fast Translator

**Date**: 2026-04-10
**Issue**: [#609](https://github.com/rioX432/live-translate/issues/609)
**Status**: Evaluation planned

---

## 1. Background & Motivation

The current ultra-fast translator slot is filled by **LFM2-350M-ENJP-MT** (~230MB Q4_K_M, ~180ms latency). While fast, it is a 350M general model fine-tuned specifically for EN↔JA translation with limited capacity.

**LFM2.5-1.2B-JP** (January 2026) is a 3.4x larger model from the same Liquid AI family with substantially improved training:

| Dimension | LFM2-350M-ENJP-MT | LFM2.5-1.2B-JP |
|---|---|---|
| Parameters | 350M | 1.2B |
| Pre-training tokens | 10T | 28T (2.8x more) |
| Post-training | SFT + preference alignment | SFT + preference alignment + **multi-stage RL** |
| Specialization | EN↔JA MT fine-tuned | Japanese general-purpose (instruction-following) |
| GGUF Q4_K_M size | ~230MB | ~731MB |
| Architecture | Hybrid conv + GQA (LFM2) | Hybrid conv + GQA (LFM2.5, same family) |

The hypothesis: despite not being MT-specialized, the 3.4x parameter increase and 2.8x training data increase may yield better translation quality when prompted, while staying under the HY-MT1.5-1.8B's ~1.1GB memory envelope. At ~731MB Q4_K_M, it slots between LFM2-350M and HY-MT1.5 in both size and expected quality.

**Use cases under evaluation:**
1. **Direct replacement** for LFM2-350M as prompt-based fast translator
2. **Draft model** for speculative decoding paired with HY-MT1.5-1.8B (acceptance rate measurement)

---

## 2. Model Specifications

### LFM2.5-1.2B-JP

- **Developer**: Liquid AI
- **Release**: January 6, 2026
- **Architecture**: Hybrid — 10 double-gated short-range convolution blocks + 6 GQA blocks (hardware-in-the-loop architecture search)
- **NOT a pure SSM** — marketing draws from SSM/LTC research lineage, but the deployed architecture is convolution + sparse attention
- **Compatible with llama.cpp (GGUF)** — same inference path as transformer models, no special runtime
- **License**: Liquid Foundation Model License 1.0

### GGUF Quantization Options

| Quantization | Size | Quality | Notes |
|---|---|---|---|
| Q8_0 | ~1.25GB | Highest | Near-lossless; exceeds HY-MT1.5 size budget |
| Q6_K | ~980MB | Very high | Good balance if Q4_K_M quality drops |
| Q4_K_M | **~731MB** | Good | **Primary evaluation target**; well under 1GB |
| Q4_K_S | ~690MB | Acceptable | Marginal savings vs Q4_K_M |
| IQ4_XS | ~660MB (est.) | Good with imatrix | Requires importance matrix computation |

Available from: [`LiquidAI/LFM2.5-1.2B-JP-GGUF`](https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-GGUF)

### Architecture Advantages

The hybrid convolution + sparse attention design provides:
- **200% faster decode/prefill** than Qwen3 and Gemma 3 on CPU (LFM2 technical report)
- **239 tok/s** decode on AMD CPU, 82 tok/s on mobile NPU
- **O(n) complexity** for convolution blocks (majority of layers), with O(n²) only in the 6 GQA blocks
- Efficient KV cache due to GQA (grouped query attention) — fewer KV heads than full MHA

For translation workloads (short input/output, <100 tokens), the architecture's fast prefill is particularly beneficial since translation throughput is dominated by TTFT (time-to-first-token) rather than sustained generation.

---

## 3. Key Differences from LFM2-350M-ENJP-MT

| Aspect | LFM2-350M-ENJP-MT | LFM2.5-1.2B-JP |
|---|---|---|
| Translation approach | Dedicated MT fine-tuning | Prompt-based (general instruct model) |
| System prompt | `"Translate to Japanese."` / `"Translate to English."` | Custom translation prompt (needs tuning) |
| JA understanding | Limited (350M) | JMMLU SOTA at scale; deep JA knowledge |
| Reinforcement learning | None | Multi-stage RL (instruction following) |
| Prompt compliance | May generate extraneous text | Expected to be more reliable (RL-tuned) |
| Context handling | Minimal context window usage | Larger effective context for longer segments |

### Risk: General vs Specialized

The LFM2-350M-ENJP-MT was explicitly fine-tuned on parallel JA↔EN corpora, giving it strong translation alignment despite small size. LFM2.5-1.2B-JP may have broader knowledge but less translation-specific alignment. This is the core question the evaluation must answer.

---

## 4. Evaluation Plan

### 4.1 Test Corpus

Use existing evaluation harness with standard parallel corpora:
- **WMT'23 JA↔EN** test set (general domain)
- **Internal meeting transcript** samples (spoken/informal register — matches real use case)
- **Technical documentation** samples (formal register)
- ~200 sentence pairs per direction, per domain

### 4.2 Metrics

| Metric | Tool | Notes |
|---|---|---|
| BLEU | SacreBLEU | Baseline comparability |
| COMET | wmt22-comet-da | Primary quality metric (correlates with human judgment) |
| Latency (TTFT) | Custom timer | Time to first token, averaged over 100 samples |
| Latency (total) | Custom timer | Full generation time per sentence |
| Memory (RSS) | `process.memoryUsage()` | Peak RSS during inference |
| Prompt compliance | Manual spot-check | Does the model output only the translation? |

### 4.3 Baseline Comparisons

| Model | Role | Expected Performance |
|---|---|---|
| **LFM2-350M-ENJP-MT** (Q4_K_M) | Current ultra-fast | Baseline quality, ~180ms |
| **LFM2.5-1.2B-JP** (Q4_K_M) | Candidate replacement | Expected better quality, ~120ms est. |
| **HY-MT1.5-1.8B** (Q4_K_M) | Current fast default | Quality ceiling, ~180ms |
| **Google Translate** | Cloud reference | Quality reference (not offline) |

### 4.4 Prompt Engineering

Since LFM2.5-1.2B-JP is not MT-specialized, prompt design is critical. Test variations:

```
# Variant A: Simple (matches LFM2-350M style)
System: Translate to English.
User: {japanese_text}

# Variant B: Explicit instruction
System: You are a professional translator. Translate the following Japanese text to English. Output only the translation, nothing else.
User: {japanese_text}

# Variant C: Few-shot (1 example)
System: Translate Japanese to English accurately and naturally.
User: 会議は来週の月曜日に延期されました。
Assistant: The meeting has been postponed to next Monday.
User: {japanese_text}
```

### 4.5 Speculative Decoding Draft Model Test

Test LFM2.5-1.2B-JP as a draft model for HY-MT1.5-1.8B:
- **Acceptance rate**: what percentage of draft tokens are accepted by the verifier?
- **Speed-up factor**: wall-clock time comparison vs HY-MT1.5 alone
- **Note**: llama.cpp hybrid model speculative decoding requires a [patch from Feb 2026](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct/discussions/10) for rollback support. Verify node-llama-cpp version includes this.

---

## 5. Expected Outcomes

### Optimistic Case (quality ≥ HY-MT1.5 at lower latency)
- Replace LFM2-350M as the "ultra-fast" translator slot
- Potentially challenge HY-MT1.5 as fast default if quality is comparable
- Memory: 731MB vs 1.1GB = 34% savings over HY-MT1.5

### Realistic Case (quality between LFM2-350M and HY-MT1.5)
- Replace LFM2-350M as improved fast translator
- Keep HY-MT1.5 as quality-focused fast default
- Two-tier local translation: LFM2.5 (fast draft) → HY-MT1.5 (quality)

### Pessimistic Case (quality ≤ LFM2-350M or poor prompt compliance)
- General model may not match MT-specialized 350M despite larger size
- Excessive verbose output or inconsistent translation formatting
- Action: wait for `LFM2.5-ENJP-MT` (MT-specialized variant, not yet released as of April 2026)

---

## 6. Implementation Notes

### If Evaluation Succeeds

1. **Create `LFM25Translator.ts`** — follows same pattern as `LFM2Translator.ts`:
   - Extend `LlamaWorkerTranslator`
   - Override `getVariants()` to point to `LFM2.5-1.2B-JP-GGUF` Q4_K_M
   - Override `getModelSizeLabel()` → `'LFM2.5-1.2B'`
   - Override `getExtraInitOptions()` with custom system prompt

2. **Update `model-downloader.ts`**:
   - Add `getLFM25Variants()` with URL, SHA256, and sizes for Q4_K_M
   - Resume support and SHA256 verification (existing infrastructure)

3. **Register in `src/main/index.ts`** → `initPipeline()`:
   - Add factory for `'lfm25'` engine ID
   - Add to `SettingsPanel.tsx` if promoted to primary

4. **Worker pool compatibility**:
   - LFM2.5 uses same GGUF format → existing `slm-worker.ts` / `worker-pool.ts` works as-is
   - Hot-swap via dispose+init (same as other LLM translators)

5. **Translation prompt**:
   - Use best-performing prompt variant from evaluation (Section 4.4)
   - May need `stopSequence` configuration to prevent verbose output

### Infrastructure Requirements

- No new native dependencies (GGUF via node-llama-cpp)
- No new UtilityProcess (shared worker pool)
- Download size: ~731MB (first launch)
- Compatible with existing model management UI

---

## 7. Timeline

| Phase | Duration | Deliverable |
|---|---|---|
| Model download + harness setup | 1 day | Test environment ready |
| Prompt engineering + evaluation | 2 days | BLEU/COMET/latency results |
| Speculative decoding test | 1 day | Acceptance rate measurements |
| Implementation (if pass) | 1 day | `LFM25Translator.ts` + registration |
| **Total** | **~5 days** | |

---

## 8. References

- [LiquidAI/LFM2.5-1.2B-JP — HuggingFace](https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP)
- [LiquidAI/LFM2.5-1.2B-JP-GGUF — HuggingFace](https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-GGUF)
- [LiquidAI/LFM2-350M-ENJP-MT — HuggingFace](https://huggingface.co/LiquidAI/LFM2-350M-ENJP-MT)
- [Introducing LFM2.5: The Next Generation of On-Device AI — Liquid AI](https://www.liquid.ai/blog/introducing-lfm2-5-the-next-generation-of-on-device-ai)
- [LFM2.5-350M: No Size Left Behind — Liquid AI](https://www.liquid.ai/blog/lfm2-5-350m-no-size-left-behind)
- [LFM2 Technical Report — arXiv:2511.23404](https://arxiv.org/html/2511.23404v1)
- [Speculative Decoding for Hybrid Models — LFM2.5 Discussion](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct/discussions/10)
- [JP-TL-Bench: Anchored Pairwise LLM Evaluation for JA↔EN Translation — arXiv:2601.00223](https://arxiv.org/abs/2601.00223)
- [Liquid AI LFM2.5 On-Device Agents — MarkTechPost](https://www.marktechpost.com/2026/01/06/liquid-ai-releases-lfm2-5-a-compact-ai-model-family-for-real-on-device-agents/)
- [Liquid Foundation Models — Liquid AI](https://www.liquid.ai/models)
