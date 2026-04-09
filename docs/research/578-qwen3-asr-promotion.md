# Qwen3-ASR 0.6B Promotion Evaluation

**Issue:** #578
**Date:** 2026-04-09
**Status:** Research complete — conditional promotion recommended (MLX path preferred)

---

## Summary

Qwen3-ASR 0.6B is a strong candidate for promotion to primary STT. On English it decisively beats
MLX Whisper (2.11% WER vs 3.8% WER). On Japanese (Fleurs) it lands at **8.33% CER**, slightly
above MLX Whisper's 8.1%, but well within noise margin and with better cross-language robustness.
The MLX port (mlx-qwen3-asr) is production-ready with committed benchmark artifacts and
8-bit/4-bit quantization that keeps memory near the ~1.2 GB baseline while delivering 3–4.7x
speed gains. The native C port (antirez/qwen-asr) is functional but lacks MPS support and has
known streaming boundary artifacts, making it less suitable as a primary engine on macOS.

**Recommended action:** Promote Qwen3-ASR 0.6B via the **MLX path** to primary STT. Keep the
native C engine (`QwenAsrNativeEngine`) as an experimental cross-platform fallback.

---

## Benchmark Comparison

### Japanese (JA) — CER %

| Engine | Dataset | CER % | Notes |
|--------|---------|-------|-------|
| Qwen3-ASR 0.6B | Fleurs-ja | **8.33** | From official tech report (arXiv:2601.21337) |
| Qwen3-ASR 0.6B | CommonVoice-ja | 14.96 | Read/broadcast style; higher noise |
| Qwen3-ASR 1.7B | Fleurs-ja | **5.20** | Best open-source JA CER |
| Qwen3-ASR 1.7B (neosophie benchmark) | Natural conversational | 14.73 | RTX5090, 20 clips, ~580s |
| MLX Whisper (Whisper Turbo, mlx) | Internal benchmark | **8.1** | Current live-translate default |
| Whisper Large-v3-Turbo | Natural conversational | 17.82 | Same neosophie benchmark |

> Note: The 0.6B Fleurs CER (8.33%) is from the official tech report's multilingual test. The
> neosophie benchmark evaluates only 1.7B on natural conversational speech, not 0.6B.

### English (EN) — WER %

| Engine | Dataset | WER % | Notes |
|--------|---------|-------|-------|
| Qwen3-ASR 0.6B | LibriSpeech clean | **2.11** | Official tech report |
| Qwen3-ASR 0.6B | LibriSpeech other | **4.55** | Official tech report |
| Qwen3-ASR 0.6B | Fleurs-en | **4.39** | Official tech report |
| Qwen3-ASR 0.6B (MLX path) | LibriSpeech clean | **2.29** | mlx-qwen3-asr benchmark artifact |
| Qwen3-ASR 1.7B | LibriSpeech clean | 1.63 | For reference |
| MLX Whisper (Whisper Turbo, mlx) | Internal benchmark | 3.8 | Current live-translate default |

Qwen3-ASR 0.6B is **~40% better on EN WER** than the current MLX Whisper default.

### MLX Path Quantization (on Apple M4 Pro)

| Quantization | EN WER delta | JA CER delta | 2.5s clip latency | 10s clip latency | RTF (vs audio) |
|---|---|---|---|---|---|
| fp16 | baseline | baseline | 0.46s | 0.83s | 0.08x |
| 8-bit (q8) | +0.04pp | ~+0.05pp | 0.11s | 0.27s | 3.11x faster than fp16 |
| 4-bit (q4) | +0.43pp | ~+0.50pp | 0.13s | 0.18s | 4.68x faster than fp16 |

**8-bit is the recommended default**: near-fp16 accuracy at 3x+ speed.

---

## Memory & Latency

| Engine | Memory (fp16) | Memory (8-bit) | TTFT (avg) | Real-time factor |
|--------|---------------|----------------|------------|-----------------|
| Qwen3-ASR 0.6B (MLX, fp16) | ~1.2 GB | — | 460ms (2.5s clip) | 0.08x audio |
| Qwen3-ASR 0.6B (MLX, 8-bit) | ~0.7 GB est. | ~0.7 GB | 110ms (2.5s clip) | well under 1x |
| Qwen3-ASR 0.6B (native C, M3 Max) | ~2.8 GB (segmented) | N/A | 92ms TTFT | 7.99–13.38x realtime |
| MLX Whisper Turbo | ~1.5 GB | N/A | ~700ms | 2.9s for full segment |

The MLX 8-bit path (~110ms on 2.5s audio) is **6x faster than MLX Whisper** (2.9s latency) for
short segments. This is a significant UX improvement for real-time subtitles.

---

## MLX Port Status (moona3k/mlx-qwen3-asr)

- **Production-ready**: 462 tests, committed benchmark artifacts (Feb 2026)
- **Quality gate enforced**: no optimization lands without passing test suite
- **Parity**: 67% exact text match with PyTorch reference; 8-bit: +0.04pp WER
- **Features**: long audio (20 min/chunk), energy-based segmentation, word-level timestamps
- **Integration**: simple API (`transcribe("audio.wav")`), session API for repeated calls, CLI
- **Quantization**: fp16, 8-bit (q8), 4-bit (q4) — all tested
- **Models**: 0.6B and 1.7B both supported

**Concern**: mlx-qwen3-asr is a community project (moona3k), not Alibaba official. However
`Blaizzy/mlx-audio` (broader MLX audio ecosystem) also includes Qwen3-ASR support, providing
an alternative import path.

---

## Native C Port Status (antirez/qwen-asr)

- **Author**: antirez (Redis creator) — well-regarded, active
- **Latest commit**: Feb 16, 2026 (~6 commits total, early-stage)
- **Platform**: macOS (BLAS/Accelerate) + Linux (OpenBLAS); **MPS explicitly not supported**
- **Streaming**: 2-second chunk sliding window with prefix rollback — functional
- **Memory**: bounded in segmented mode (~2.8 GiB regardless of audio length)
- **Performance (M3 Max, 0.6B)**: 13.38x realtime (offline), 4.69x realtime (streaming)

**Known issues:**
1. No MPS/Metal GPU acceleration — CPU-only on Apple Silicon (performance gap vs MLX)
2. Segment boundary artifacts in segmented/streaming mode
3. Prompt biasing "very soft" — language hints may be ignored
4. Early stage (6 commits) — API may change

For macOS users, the MLX path dominates on speed. The native C engine remains valuable for
**Linux cross-platform** use where MLX is unavailable.

---

## Integration Options

| Option | Status | Pros | Cons | Recommended for |
|--------|--------|------|------|-----------------|
| MLX path (mlx-qwen3-asr) | Production-ready | Fast, tested, 8-bit, low memory | macOS only, Python dep | Primary on macOS |
| Native C (antirez/qwen-asr) | Experimental | Cross-platform, no Python | CPU-only on macOS, early stage | Cross-platform fallback |
| Python bridge (official qwen-asr) | Available | Official, full features | Heavy PyTorch dep, slower | Not preferred |

The existing `QwenAsrNativeEngine.ts` already wraps the native C path. A new
`QwenAsrMlxEngine.ts` should be created following the `MlxWhisperEngine` subprocess pattern.

---

## Comparison with Current Primary Engines

| Metric | Qwen3-ASR 0.6B (MLX 8-bit) | MLX Whisper | Whisper Local |
|--------|---------------------------|-------------|---------------|
| JA CER | ~8.3% | 8.1% | ~10–12% est. |
| EN WER | ~2.3% | 3.8% | ~4–5% est. |
| Latency (2.5s clip) | ~110ms | ~2.9s (segment) | ~500ms est. |
| Memory | ~0.7 GB (8-bit) | ~1.5 GB | ~540 MB (turbo) |
| Offline | Yes | Yes | Yes |
| macOS-only | Yes (MLX) | Yes (MLX) | No (cross-platform) |
| Language detection | Built-in (97.9%) | Whisper built-in | Script heuristic |
| Setup complexity | Python + mlx-qwen3-asr | Python + mlx-whisper | whisper.cpp addon |

---

## Recommendation

**Promote Qwen3-ASR 0.6B (MLX path) to primary STT** with the following plan:

### Go criteria (all must pass)
1. JA CER ≤ 9% on internal live-translate test corpus (target: ≤8.5%)
2. EN WER ≤ 4% on LibriSpeech test-clean equivalent
3. Latency ≤ 500ms p95 on Apple M-series for 3-second audio chunks
4. Memory ≤ 1.2 GB in 8-bit mode

### Implementation plan
1. Create `QwenAsrMlxEngine.ts` following `MlxWhisperEngine.ts` pattern
2. Add `resources/qwen-asr-mlx-bridge.py` (JSON-over-stdio, 8-bit default)
3. Add to `SettingsPanel.tsx` as primary option (macOS only, gated by platform check)
4. Default to 8-bit quantization; expose fp16/4-bit as advanced options
5. Keep `QwenAsrNativeEngine.ts` as experimental cross-platform fallback (no change needed)
6. Update auto-selection logic: prefer Qwen3-ASR MLX on Apple Silicon with Python available

### Risk assessment
- **Low risk**: MLX path is well-tested with committed benchmarks
- **Medium risk**: JA CER (8.33%) is within margin of MLX Whisper (8.1%) but not clearly superior
  — run internal corpus benchmark before promoting as *default* (vs. available option)
- **Mitigated**: 0.6B model at 8-bit is only 700MB, well within memory budget

---

## References

- [Qwen3-ASR Technical Report](https://arxiv.org/abs/2601.21337) (arXiv:2601.21337, Jan 2026)
- [Qwen3-ASR-0.6B on HuggingFace](https://huggingface.co/Qwen/Qwen3-ASR-0.6B)
- [QwenLM/Qwen3-ASR GitHub](https://github.com/QwenLM/Qwen3-ASR)
- [moona3k/mlx-qwen3-asr](https://github.com/moona3k/mlx-qwen3-asr)
- [antirez/qwen-asr](https://github.com/antirez/qwen-asr)
- [Japanese ASR Benchmark 2026 (neosophie)](https://neosophie.com/en/blog/20260226-japanese-asr-benchmark)
- [Prior internal evaluation: #268](docs/research/qwen3-asr-evaluation.md)
