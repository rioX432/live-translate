# Transformers.js v4 + WebGPU Evaluation

Research date: 2026-03-23
Issue: #267

## Executive Summary

**Recommendation: Do NOT upgrade to v4 yet. Stay on v3 (`^3.8.0`) for now.**

Transformers.js v4 is in **preview** (published under `@next` tag since Feb 2026). While the new WebGPU runtime shows impressive benchmarks for LLM inference (30x faster for Llama 3.2 1B), **WebGPU translation pipelines (seq2seq models) are actively broken** with unresolved crash issues. Upgrading now would break both MoonshineEngine and OpusMTTranslator.

## Current Usage in live-translate

| File | Usage | API Surface |
|---|---|---|
| `src/engines/stt/MoonshineEngine.ts` | ASR via `pipeline('automatic-speech-recognition', ...)` | `pipeline()`, `env.cacheDir` |
| `src/engines/translator/OpusMTTranslator.ts` | Translation via `pipeline('translation', ...)` | `pipeline()`, `env.cacheDir` |
| `benchmark/src/engines/opus-mt.ts` | Benchmark harness for OPUS-MT | Same as above |

Both engines use dynamic `import('@huggingface/transformers')` and rely on:
- `pipeline()` factory function
- `env.cacheDir` for model cache location
- `dtype: 'q8'` quantization option

## Transformers.js v4 Changes

### What's New
- **New WebGPU Runtime**: Completely rewritten in C++, using WGSL compute shaders for GPU-accelerated matrix operations
- **Monorepo structure**: Split into smaller packages via pnpm workspaces
- **New model architectures**: GPT-OSS, Chatterbox, GraniteMoeHybrid, FalconH1, etc.
- **Build system**: Migrated from Webpack to esbuild (200ms builds vs 2s)
- **Offline support**: Full offline support with local WASM file caching

### Breaking Changes (v3 -> v4)
- Repository restructured as monorepo (import paths may change)
- `models.js` split into per-architecture modules
- Examples moved to separate repository
- Native WebGPU EP replaces JSEP-based WebGPU (PR #1382)
- v4 is preview-only: `npm i @huggingface/transformers@next`

### API Compatibility
The core `pipeline()` API and `env.cacheDir` appear unchanged based on documentation. However, the internal model loading and session creation have been significantly reworked for the new WebGPU runtime.

## WebGPU in Electron 33

| Property | Value |
|---|---|
| Electron version | `^33.0.0` |
| Chromium version | 130.0.6723.44 |
| WebGPU available | Yes (since Chrome 113) |
| Activation required | `app.commandLine.appendSwitch('enable-unsafe-webgpu')` |
| Platform support | macOS (Metal), Windows (D3D12), Linux (partial) |

WebGPU is available in Electron 33 but requires the `--enable-unsafe-webgpu` flag. On Chromium 130, `temporary-unexpire-flags-m130` may also be needed for bleeding-edge features.

## Performance: WebGPU vs WASM

| Workload | WASM | WebGPU | Speedup |
|---|---|---|---|
| LLM generation (TinyLlama 1.1B, 128 tokens) | 2-5 tok/s | 25-40 tok/s (discrete GPU) | **5-20x** |
| Short text embeddings (<128 tokens) | 8-12ms | 15-25ms | **WASM faster** |
| Large embedding batches | Baseline | Up to 64x faster | **Massive** |
| Llama 3.2 1B (v4 native WebGPU) | Baseline | 30x faster | **Massive** |

**Key insight**: For small models processing short sequences (which is our OPUS-MT use case), WASM is actually faster than WebGPU due to GPU dispatch overhead. WebGPU shines for larger models and batch processing.

## Translation Model Compatibility

### OPUS-MT (MarianMT)
- **v3 WASM**: Works correctly (current production setup)
- **v3 WebGPU**: Crashes with dtype errors ([#1380](https://github.com/huggingface/transformers.js/issues/1380))
- **v4 WebGPU**: Still crashing ([#1518](https://github.com/huggingface/transformers.js/issues/1518)) — "Can't create a session" errors, dtype not specified for encoder/decoder models

### NLLB-200
- **v3 WASM**: Works with `nllb-200-distilled-600M`
- **v3/v4 WebGPU**: Does not work — memory allocation failures on integrated GPUs, q8 decoders produce gibberish ([#1317](https://github.com/huggingface/transformers.js/issues/1317), [#1286](https://github.com/huggingface/transformers.js/issues/1286))

### Moonshine (ASR)
- **v3 WASM**: Works correctly (current production setup)
- **v4 WebGPU**: Untested for Moonshine specifically, but WebGPU memory leak issues reported for Whisper pipelines ([#860](https://github.com/huggingface/transformers.js/issues/860))

## Memory Impact

| Concern | Details |
|---|---|
| NLLB-200-distilled-600M | ~600MB+ in renderer process |
| WebGPU VRAM limit | 4GB WebAssembly limit; fp32 models exceed this |
| Memory leaks | Documented WebGPU tensor disposal issues ([#860](https://github.com/huggingface/transformers.js/issues/860)) |
| GPU contention | Running inference in renderer competes with Chromium's compositor and subtitle rendering |

Running large translation models in the renderer process is risky due to memory pressure and potential GPU contention with Electron's rendering pipeline.

## Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| v4 is preview, API may change before stable | High | Wait for stable release |
| WebGPU translation pipelines crash | **Blocker** | Cannot use WebGPU for translation today |
| Memory leaks in WebGPU pipelines | High | No fix available upstream |
| GPU contention with subtitle rendering | Medium | Use WASM backend or offload to UtilityProcess |
| Breaking changes in monorepo restructure | Medium | Test thoroughly before upgrading |

## Recommendations

### Short-term (Now)
1. **Stay on v3 (`^3.8.0`)** — v4 preview is not production-ready for translation workloads
2. **Do not enable WebGPU for translation** — seq2seq WebGPU support is broken upstream
3. Continue using WASM backend for MoonshineEngine and OpusMTTranslator

### Medium-term (When v4 reaches stable)
1. **Test v4 stable with WASM backend first** — verify `pipeline()` API compatibility
2. **Evaluate WebGPU for Moonshine ASR only** — ASR may benefit more than translation from GPU acceleration
3. **Keep translation on WASM** — small OPUS-MT models see no benefit from WebGPU

### Long-term (When WebGPU translation is fixed)
1. **Consider WebGPUTranslator engine** with NLLB-200 for multi-language support
2. **Requires**: Electron flag management, GPU memory monitoring, fallback to WASM
3. **Architecture**: Run in dedicated renderer or UtilityProcess to isolate GPU memory
4. Revisit when issues [#1518](https://github.com/huggingface/transformers.js/issues/1518) and [#1317](https://github.com/huggingface/transformers.js/issues/1317) are resolved

### Alternative Path
The current SLM-based translation engines (TranslateGemma, HunyuanMT via node-llama-cpp in UtilityProcess) already provide high-quality offline translation without WebGPU browser constraints. Investing in those engines may yield better ROI than waiting for Transformers.js WebGPU translation support.

## Sources

- [Transformers.js v4 Preview Blog](https://huggingface.co/blog/transformersjs-v4)
- [WebGPU vs WASM Benchmarks](https://www.sitepoint.com/webgpu-vs-webasm-transformers-js/)
- [Electron 33.0.0 Release](https://www.electronjs.org/blog/electron-33-0)
- [WebGPU in Electron Issue #26944](https://github.com/electron/electron/issues/26944)
- [Translation Pipeline Crash #1380](https://github.com/huggingface/transformers.js/issues/1380)
- [Translation Pipeline Crash #1518](https://github.com/huggingface/transformers.js/issues/1518)
- [WebGPU q8 Decoder Issues #1317](https://github.com/huggingface/transformers.js/issues/1317)
- [NLLB WebGPU Memory Issues #1286](https://github.com/huggingface/transformers.js/issues/1286)
- [WebGPU Memory Leak #860](https://github.com/huggingface/transformers.js/issues/860)
- [v4 Native WebGPU EP PR #1382](https://github.com/huggingface/transformers.js/pull/1382)
