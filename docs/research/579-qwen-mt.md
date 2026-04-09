# Qwen-MT (Qwen3-MT) Translation Evaluation

**Issue:** #579
**Date:** 2026-04-09
**Status:** Research complete — viable candidate for quality-mode translator, experimental implementation recommended

---

## 1. Summary

Qwen-MT (announced July 24, 2025) is Alibaba's dedicated machine translation model built on Qwen3. It uses a lightweight MoE architecture supporting 92 languages with features tailored for production translation workloads (term intervention, domain prompting, translation memory). The open-weight variants (Apache 2.0) are available in 4B, 8B, and 30B-A3B MoE sizes.

The 30B-A3B MoE variant is the most interesting for live-translate: only ~3B parameters are activated per token, giving inference costs closer to a 3B dense model while maintaining quality closer to a 30B model. However, the model was released as API-first (`qwen-mt-turbo`) with open weights as a secondary offering; GGUF community packaging is nascent as of this writing.

---

## 2. Architecture

| Property | Value |
|---|---|
| Base model | Qwen3 (fine-tuned on translation corpus) |
| Architecture | Mixture of Experts (MoE) |
| Total parameters | 30B (largest open variant) |
| Active parameters per token | ~3B (30B-A3B variant) |
| Smaller dense variants | 4B, 8B |
| Training data | Trillions of multilingual tokens + RL fine-tuning |
| Languages supported | 92 languages/dialects (>95% global population coverage) |
| License | Apache 2.0 |
| Release date | July 24, 2025 |

The MoE routing activates only 3B of the 30B parameters per forward pass, which theoretically yields:
- Memory footprint closer to a 3B dense model (not 30B)
- Inference latency between 3B and 8B dense models
- Quality approaching full 30B models for translation tasks

---

## 3. Key Features

### Term Intervention (Terminology Injection)
Users can pass predefined terminology pairs (glossary) as parameters to enforce consistent specialized vocabulary. This maps well to live-translate's glossary-manager.ts infrastructure already in place.

### Domain Prompting
The model accepts domain context (e.g., "IT documentation", "legal contract", "casual conversation") to adapt register and stylistic choices.

### Translation Memory
API supports passing previous segment translations as context, similar to the `ContextBuffer` pattern in live-translate.

---

## 4. Benchmark Data

### Overall Quality (reported by Qwen team, July 2025)

Qwen-MT claims to "significantly outperform comparably-sized models" including:
- GPT-4.1-mini
- Gemini-2.5-Flash
- Qwen3-8B (general-purpose)

Against larger models (GPT-4.1, Gemini-2.5-Pro), it "maintains competitive translation quality."

Human evaluation used 3 independent professional translators across 10 languages:
- Chinese, English, Japanese, Korean, Thai, Arabic, Italian, Russian, Spanish, French

**Note:** Qwen team published qualitative benchmark charts without specific COMET/BLEU numerical scores on the blog. The paper/technical report with exact numbers was not publicly available at research time. The comparison methodology favors Qwen-MT's own API (`qwen-mt-turbo`) rather than the open-weight GGUF variants.

### Estimated GGUF Quality vs Existing Engines

No independent JA↔EN GGUF benchmarks found as of research date. Extrapolating from architecture:

| Engine | Params (active) | JA→EN quality (est.) | Latency (est.) | Memory |
|---|---|---|---|---|
| LFM2-350M | 350M | Baseline | ~50ms | ~230MB |
| HY-MT1.5-1.8B | 1.8B | Good (+10-15% over LFM2) | ~180ms | ~1GB |
| **Qwen3-MT-4B GGUF** | 4B | Better (+5-10%) | ~300-500ms | ~2.5GB |
| **Qwen3-MT-8B GGUF** | 8B | Good (+5%) | ~600ms-1s | ~5GB |
| **Qwen3-MT-30B-A3B GGUF** | 3B active | Potentially best | ~200-400ms | ~18GB total / ~3GB active compute |
| Hunyuan-MT 7B | 7B | High quality | 3.7s JA→EN | ~4GB |
| PLaMo-2 10B | 10B | High quality | TBD | ~5.5GB |

The 30B-A3B MoE latency estimate is based on MoE inference behavior: active compute ~= 3B dense, but MoE routing and expert loading overhead adds latency on CPU/unified memory. On Apple Silicon with Metal (all experts fit in unified memory), MoE routing overhead is smaller.

---

## 5. GGUF Availability

As of April 2026:

- **Official GGUF:** The Qwen team has published GGUF quantizations for other Qwen3 MoE variants (e.g., Qwen3-30B-A3B-GGUF by `bartowski`), but Qwen3-MT-specific GGUF packs are nascent.
- **Community GGUF:** HuggingFace search shows early Qwen3-MT GGUF uploads from community packagers (AlekseyCalvin, hienbm), primarily for 4B/8B variants.
- **30B-A3B GGUF:** Not confirmed available from reputable packagers (bartowski/unsloth) at research time. Likely forthcoming given community interest.
- **Ollama:** Not yet in Ollama library as of April 2026.

### Expected quantization options (based on Qwen3 MoE patterns)
| Quant | Est. Size (30B-A3B) | Est. Size (8B) | Est. Size (4B) |
|---|---|---|---|
| Q8_0 | ~30GB | ~8.5GB | ~4.3GB |
| Q4_K_M | ~18GB | ~4.8GB | ~2.5GB |
| Q3_K_M | ~14GB | ~3.7GB | ~1.9GB |
| Q2_K | ~10GB | ~2.7GB | ~1.4GB |

The Q4_K_M 30B-A3B at ~18GB fits Apple Silicon M2 Max (32GB) and M2/M3 Ultra systems, but not standard M1/M2 (16GB).

---

## 6. node-llama-cpp Compatibility

| Concern | Status |
|---|---|
| llama.cpp Qwen3 support | Yes — Qwen3 series supported in llama.cpp (b7000+) |
| Qwen3 MoE architecture | Yes — Qwen3-30B-A3B MoE is a recognized llama.cpp model type |
| node-llama-cpp v3.18+ | Bundles llama.cpp b8352+, which supports Qwen3 MoE |
| `QwenChatWrapper` | Available in node-llama-cpp v3.18 (Qwen 3.5 support added) |
| Qwen3-MT specific tokenizer | Same tokenizer as Qwen3 — no special handling needed |
| MoE expert offloading | Supported via `--n-gpu-layers` — experts can be partially on GPU |

**Conclusion:** Qwen3-MT GGUF should work with node-llama-cpp v3.18+ using `QwenChatWrapper` with no architecture-specific changes. The `modelType: 'qwen3-mt'` would need to be added to `slm-worker.ts` with appropriate system/user prompt templates.

---

## 7. Prompt Format

Qwen3-MT uses a chat format with translation-specific system prompts. Based on the Qwen3 instruct template:

```
<|im_start|>system
You are a professional translator. Translate the following text from {source_lang} to {target_lang}.{domain_hint}{term_hint}
<|im_end|>
<|im_start|>user
{source_text}
<|im_end|>
<|im_start|>assistant
```

Term intervention format (from blog):
```python
"term_list": [{"source": "machine learning", "target": "機械学習"}]
```

---

## 8. Comparison with Current Engines

### vs HY-MT1.5-1.8B (current fast default, ~180ms)
- Qwen3-MT-4B would be ~2x slower (~300-500ms) but likely higher quality
- Not a replacement for HY-MT1.5-1.8B in the fast-default slot
- Could serve as a "quality" alternative above HY-MT1.5-1.8B

### vs Hunyuan-MT 7B (current quality mode, 3.7s JA→EN)
- Qwen3-MT-30B-A3B MoE: potentially faster (MoE active compute = ~3B) with better quality
- Qwen3-MT-8B: likely comparable quality, similar latency (target <1s vs 3.7s = big win if verified)
- Strong candidate to replace Hunyuan-MT 7B in the quality slot if latency <1s confirmed

### vs PLaMo-2 10B (current quality mode)
- Qwen3-MT is translation-specialized vs PLaMo-2's general-purpose design
- Translation-specialized models consistently outperform general LLMs on MT benchmarks
- Qwen3-MT-8B vs PLaMo-2 10B: quality comparison requires actual benchmarking

---

## 9. Risks and Unknowns

| Risk | Severity | Notes |
|---|---|---|
| GGUF quality vs API quality | Medium | GGUF Q4_K_M may show quality regression vs API model |
| MoE expert loading latency on CPU | Medium | If experts not all in GPU VRAM, latency spikes |
| 30B-A3B memory requirements | High | ~18GB Q4_K_M — excludes 16GB M1/M2 Macs |
| No independent JA COMET benchmarks | High | Need empirical measurement for JA↔EN |
| Nascent GGUF ecosystem | Medium | Reputable GGUF packagers (bartowski) haven't released yet |
| term_list format via llama.cpp | Low | Term injection would require prompt-level encoding, not native API call |

---

## 10. Recommendation

**Proceed with experimental evaluation, prioritizing 8B variant.**

### Proposed evaluation plan (aligns with Issue #579 tasks):

1. **Download:** Qwen3-MT-8B-Instruct-GGUF Q4_K_M from community packagers (or convert from HF safetensors if unavailable)
2. **Integration:** Add `modelType: 'qwen3-mt'` to `slm-worker.ts`, implement prompt template with term injection support
3. **Benchmark JA↔EN quality** against HY-MT1.5-1.8B and Hunyuan-MT 7B using existing test sentences
4. **Benchmark latency** on M1/M2/M3 MacBook Pro — target <500ms for quality mode
5. **If 8B passes:** evaluate 30B-A3B MoE on high-memory systems

### Decision matrix for adding to UI:

| Scenario | Action |
|---|---|
| Latency <500ms AND quality > Hunyuan-MT 7B | Replace Hunyuan-MT 7B as quality engine |
| Latency <500ms AND quality ≈ Hunyuan-MT 7B | Add as alternative quality option |
| Latency 500ms-1s AND quality > Hunyuan-MT 7B | Add as quality engine, label "(slower)" |
| Latency >1s | Experimental only, do not add to primary UI |

### Memory-based availability:

| System RAM | Recommended variant |
|---|---|
| 8GB | Qwen3-MT-4B Q4_K_M (~2.5GB) |
| 16GB | Qwen3-MT-8B Q4_K_M (~4.8GB) |
| 32GB+ | Qwen3-MT-30B-A3B Q4_K_M (~18GB) |

---

## References

- Official blog: https://qwenlm.github.io/blog/qwen-mt/ (July 24, 2025)
- MarkTechPost analysis: https://www.marktechpost.com/2025/07/25/alibaba-qwen-introduces-qwen3-mt/
- Qwen HuggingFace org: https://huggingface.co/Qwen
- node-llama-cpp releases (v3.18.0 — Qwen 3.5 support): https://github.com/withcatai/node-llama-cpp/releases
- llama.cpp Qwen3 MoE issues: https://github.com/ggml-org/llama.cpp/issues
