# Qwen3-MT GGUF Availability Monitoring and Evaluation Plan

**Issue:** #614
**Date:** 2026-04-10
**Status:** Monitoring — no reputable GGUF packaging available yet for Qwen3-MT fine-tune

---

## 1. Summary

Qwen3-MT is Alibaba's dedicated machine translation model built on Qwen3, announced July 2025. It uses a lightweight MoE architecture, supports 92 languages, and offers features like term intervention, domain prompting, and translation memory. The API version (`qwen-mt-turbo`) is production-ready, but as of April 2026, no reputable GGUF quantization exists for the MT-specialized fine-tune (Qwen3-MT-4B, Qwen3-MT-8B, or Qwen3-MT-30B-A3B).

Meanwhile, general-purpose Qwen3 GGUF models (4B, 8B, 30B-A3B) are widely available from official and community packagers (Qwen, bartowski, unsloth) and can be prompted for translation tasks as an interim alternative.

The WMT25 competition validated Qwen3-based translation approaches: the In2x model (Qwen3-based, Duxiaoman) placed 1st in the unrestricted JA track and 2nd overall, outperforming GPT-4.1, Gemini 2.5 Pro, Claude 4, and DeepSeek-V3. The constrained track winner was Shy-hunyuan-MT (11 winning language pairs). These results confirm Qwen3 as a strong foundation for translation models.

---

## 2. Qwen3-MT Model Family

| Property | Value |
|---|---|
| Base model | Qwen3 (fine-tuned on translation corpus + RL) |
| Architecture | Mixture of Experts (MoE) for 30B-A3B; dense for 4B/8B |
| Variants | 4B (dense), 8B (dense), 30B-A3B (MoE, ~3B active) |
| Languages | 92 languages/dialects (>95% global population) |
| License | Apache 2.0 (open weights) |
| API | `qwen-mt-turbo` via Alibaba Cloud / DashScope |
| API cost | ~$0.5 per million output tokens |
| Release | July 24, 2025 (blog + API); open weights available on HuggingFace |

### Key Features

- **Term intervention:** Pass glossary pairs to enforce consistent terminology (maps to live-translate's `glossary-manager.ts`)
- **Domain prompting:** Accept domain context (IT, legal, casual) to adapt register
- **Translation memory:** Previous segment translations as context (maps to `ContextBuffer`)

---

## 3. WMT25 Results

The Tenth Conference on Machine Translation (WMT25) validated Qwen3-based translation models as state-of-the-art for JA tracks.

### In2x (Duxiaoman, Qwen3-based)

- **1st place** in unrestricted JA track
- **2nd place** overall across all language pairs
- Outperformed: GPT-4.1, Gemini 2.5 Pro, Claude 4, DeepSeek-V3
- Architecture: English-as-hub transfer to Japanese, expressiveness-first supervision, evaluation beyond metrics
- No task-specific fine-tuning — general paradigm for extending LLMs to target languages

### Shy-hunyuan-MT (constrained track)

- **Best constrained system** — winning cluster for 11 language pairs
- Constrained track rules: open-source models up to 20B parameters, public training data only

### Evaluation methodology

- Professional human annotators using Error Span Annotation (ESA) for most pairs
- Multidimensional Quality Metrics (MQM) for EN→KO and JA→ZH

### Implications for live-translate

These results confirm that Qwen3-based models, even without MT-specific fine-tuning, can produce SOTA JA translation quality. A dedicated MT fine-tune (Qwen3-MT) should perform even better for our JA↔EN use case.

---

## 4. GGUF Availability Status (April 2026)

### Qwen3-MT (translation fine-tune): NOT AVAILABLE

| Source | Status |
|---|---|
| Qwen official (HuggingFace) | Safetensors weights available; no official GGUF |
| bartowski | Not published |
| unsloth | Not published |
| Ollama | Not in library |
| Community uploads | Qwen3-MT-Demo Space exists; no GGUF from reputable packagers |

### General Qwen3 GGUF: AVAILABLE

| Model | Qwen official | unsloth | bartowski |
|---|---|---|---|
| Qwen3-4B | Q8_0 GGUF | Dynamic GGUF 2.0 | Available |
| Qwen3-8B | Q8_0 GGUF | Dynamic GGUF 2.0 | Available |
| Qwen3-30B-A3B | Q8_0 GGUF | Dynamic GGUF 2.0 | Available |
| Qwen3.5-9B | — | Dynamic GGUF 2.0 | Available |
| Qwen3.5-35B-A3B | — | Dynamic GGUF 2.0 | Available |

### Why GGUF matters

Qwen3-MT weights exist as safetensors on HuggingFace, but live-translate uses node-llama-cpp which requires GGUF format. Manual conversion is possible (`convert_hf_to_gguf.py`) but reputable community packages (bartowski/unsloth) provide better quantization quality with imatrix calibration data.

---

## 5. 30B-A3B MoE Memory and Feasibility

| Quant | Weight size | Min RAM | Recommended |
|---|---|---|---|
| Q8_0 | ~30GB | 64GB | M2/M3/M4 Ultra |
| Q4_K_M | ~18.6GB | 32GB | M2/M3/M4 Max (32GB+) |
| Q3_K_M | ~14GB | 24GB | M2/M3/M4 Pro (24GB) |
| Q2_K | ~10GB | 16GB | M2/M3/M4 (16GB) — quality may degrade |

### Apple Silicon performance (Qwen3-30B-A3B)

- M4 Max, MLX 4-bit: ~68 tok/s
- M4 Max, GGUF Q4_K_M: ~40 tok/s
- Active compute per token: ~3.3B parameters (sparse MoE)
- Unified memory advantage: all experts reside in shared memory, avoiding PCIe transfer bottleneck

### Feasibility assessment

| System | Feasible? | Notes |
|---|---|---|
| M1/M2 8GB | No | Insufficient memory for any 30B variant |
| M1/M2 16GB | Marginal | Q2_K only, quality questionable |
| M2/M3 Pro 24GB | Yes | Q3_K_M fits with room for Whisper |
| M2/M3/M4 Max 32GB+ | Yes | Q4_K_M recommended, good quality |
| M2/M4 Ultra 64GB+ | Yes | Q8_0 possible, best quality |

For live-translate, the 30B-A3B variant is viable only as a quality-mode option on high-memory systems (24GB+). The 4B/8B dense variants remain the primary targets for broad compatibility.

---

## 6. Alternative: General Qwen3 with Translation Prompts

Since Qwen3-MT GGUF is not yet available from reputable sources, general Qwen3 models can be used with translation-specific system prompts as an interim approach.

### Prompt format (Qwen3 chat template)

```
<|im_start|>system
You are a professional translator. Translate the following text from {source_lang} to {target_lang}. Output only the translation without explanation.
<|im_end|>
<|im_start|>user
{source_text}
<|im_end|>
<|im_start|>assistant
```

### Thinking mode control

Qwen3 supports `/think` and `/no_think` tokens. For translation, `/no_think` is preferred to avoid latency overhead from chain-of-thought reasoning:

```
<|im_start|>user
/no_think
Translate from Japanese to English: {source_text}
<|im_end|>
```

### Expected quality comparison (general Qwen3 vs specialized engines)

| Engine | Type | JA→EN quality (est.) | Latency (est.) |
|---|---|---|---|
| HY-MT1.5-1.8B | MT-specialized | Good | ~180ms |
| Qwen3-4B (prompted) | General LLM | Moderate-Good | ~300-500ms |
| Qwen3-8B (prompted) | General LLM | Good | ~500-800ms |
| Qwen3-MT-4B (when available) | MT-specialized | Better | ~250-400ms |
| Qwen3-MT-8B (when available) | MT-specialized | Best-in-class | ~400-700ms |

General Qwen3 should produce reasonable translations but will likely underperform MT-specialized models on:
- Terminology consistency
- Register/style appropriateness
- Low-resource language pair quality
- Efficiency (MT fine-tune produces translations with fewer tokens/less reasoning)

### node-llama-cpp compatibility

General Qwen3 GGUF works with node-llama-cpp v3.18+ using `QwenChatWrapper`. No architecture-specific changes needed. The same integration path applies to Qwen3-MT GGUF when available.

---

## 7. Evaluation Plan (When Qwen3-MT GGUF Becomes Available)

### Monitoring cadence

Check weekly:
- `huggingface.co/bartowski` for new Qwen3-MT uploads
- `huggingface.co/unsloth` for new Qwen3-MT uploads
- `huggingface.co/Qwen` for official GGUF releases
- Ollama library for Qwen3-MT addition

### Evaluation steps (priority order)

1. **Download Qwen3-MT-4B Q4_K_M** — smallest variant, fastest iteration
2. **Verify node-llama-cpp loading** — confirm GGUF loads with `QwenChatWrapper`
3. **Benchmark JA→EN and EN→JA quality** — BLEU and COMET against:
   - HY-MT1.5-1.8B (current fast default)
   - Hunyuan-MT 7B (current quality mode)
   - PLaMo-2 10B (current quality mode)
4. **Benchmark latency** on M2 Pro and M4 Max
5. **If 4B quality > HY-MT1.5-1.8B**: evaluate 8B variant
6. **If 8B quality > Hunyuan-MT 7B**: evaluate 30B-A3B on 32GB+ systems
7. **Test term intervention** via prompt-level glossary injection

### Decision matrix

| Outcome | Action |
|---|---|
| 4B latency <300ms AND quality > HY-MT1.5-1.8B | Replace HY-MT1.5-1.8B as fast default |
| 4B latency 300-500ms AND quality > HY-MT1.5-1.8B | Add as "balanced" option between fast and quality |
| 8B latency <1s AND quality > Hunyuan-MT 7B | Replace Hunyuan-MT 7B as quality engine |
| 30B-A3B latency <500ms AND quality > all | Add as premium quality option (24GB+ systems) |
| Quality ≤ HY-MT1.5-1.8B | Do not integrate; general Qwen3 prompted approach also not worth it |

### Implementation path (if evaluation passes)

1. Add `modelType: 'qwen3-mt'` to `slm-worker.ts`
2. Create `Qwen3MTTranslator.ts` in `src/engines/translator/`
3. Configure system prompt with term intervention support
4. Register in `EngineManager` via `initPipeline()`
5. Add to `SettingsPanel.tsx` if promoted to primary

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Qwen3-MT GGUF never published by reputable packagers | Medium | Self-convert from safetensors using `convert_hf_to_gguf.py` with imatrix |
| GGUF quality significantly worse than API | Medium | Benchmark Q4_K_M vs Q5_K_M; fall back to higher quant if needed |
| 30B-A3B MoE routing overhead on CPU | Medium | Only recommend for Metal-accelerated Apple Silicon |
| General Qwen3 prompted translation too slow vs MT-specialized | Low | Expected — this is the interim alternative, not the target |
| Qwen3.5-MT supersedes Qwen3-MT before evaluation | Low | Re-evaluate with newer model; same integration path |

---

## References

- Qwen-MT blog: https://qwenlm.github.io/blog/qwen-mt/
- WMT25 findings: https://aclanthology.org/2025.wmt-1.22.pdf
- In2x at WMT25: https://arxiv.org/abs/2508.14472
- WMT25 preliminary ranking: https://arxiv.org/html/2508.14909v1
- Qwen3 HuggingFace: https://huggingface.co/collections/Qwen/qwen3
- Qwen3-4B GGUF (official): https://huggingface.co/Qwen/Qwen3-4B-GGUF
- Qwen3-8B GGUF (official): https://huggingface.co/Qwen/Qwen3-8B-GGUF
- unsloth Qwen3 GGUF: https://huggingface.co/unsloth/Qwen3-4B-GGUF
- Qwen3 30B-A3B hardware requirements: https://apxml.com/models/qwen3-30b-a3b
- llama.cpp Qwen3 guide: https://qwen.readthedocs.io/en/latest/run_locally/llama.cpp.html
- node-llama-cpp: https://github.com/withcatai/node-llama-cpp
- Previous research (#579): docs/research/579-qwen-mt.md
