---
description: Translation engine plugin patterns
globs: src/engines/**/*.ts, src/pipeline/**/*.ts
---

# Engine Plugin Rules

## Current Engine Landscape

One engine per role. `selectEngines(platform, arch)` in `src/engines/engine-selection.ts` picks them, and
`pipeline-start` overrides whatever engine IDs the renderer sends. There is no engine picker in the UI.

| Role | Platform | Engine | File | Notes |
|------|----------|--------|------|-------|
| STT | macOS Apple Silicon | Qwen3-ASR 0.6B (8-bit MLX) | `stt/Qwen3ASREngine.ts` | Resident Swift helper over line JSON, model's own language detection |
| STT | Windows, Intel Mac | Whisper large-v3-turbo (whisper.cpp) | `stt/WhisperLocalEngine.ts` | Native addon, `language: 'auto'`, `translate: false` |
| Translation | All | Hy-MT2 1.8B (Q4_K_M GGUF) | `translator/HyMT2Translator.ts` | Official prompt template, greedy decoding; context carries previous source sentences only, never earlier translations |

**Removed:** Apple SpeechTranscriber, SenseVoice (sherpa-onnx and FunASR), Kotoba-Whisper, MLX Whisper,
Moonshine Tiny JA, SpeechSwift, Qwen ASR (Python and native C), Careless Whisper, ONNX Web STT; HY-MT1.5 (license
excludes the EU, UK and South Korea), Hunyuan-MT 7B, LFM2, PLaMo-2, OPUS-MT, Hybrid, TranslateGemma for live
translation, LlamaWorker, ANE, Apple Translation, ONNX Web translator. Earlier removals: Lightning Whisper MLX,
Moonshine base, ALMA-Ja, Gemma-2-JPN, and every cloud engine (see `docs/research/local-only-removed-cloud.md`).

## Adding New Engines
1. Create a new file in `src/engines/stt/` or `src/engines/translator/`
2. Implement the corresponding interface from `src/engines/types.ts`
3. Register the factory in `src/main/index.ts` → `initPipeline()`
4. Replacing a default means changing `selectEngines()` and its test; do not add a UI picker
5. Alternatively, create a plugin in `userData/plugins/` with a `live-translate-plugin.json` manifest

## Interface Contracts
- `initialize()` must be idempotent — safe to call multiple times
- `dispose()` must release all resources and be safe to call even if not initialized
- `processAudio()` returns `null` for silence/no-speech — never throws for empty input
- `processAudio()` throws on a real failure (bridge down, model error, timeout) after logging it: the pipeline catches it, shows it on the subtitle, and re-initializes the engines after repeated failures. Returning `null` instead hides the failure as silence
- `translate()` accepts optional `TranslateContext` for context-aware translation
- Never log transcript or translation text — meeting content may be confidential

## Pipeline
- `EngineManager` owns engine registration, creation, and lifecycle (init/dispose)
- `StreamingProcessor` handles streaming audio processing logic
- `MemoryMonitor` logs process memory usage periodically
- `TranslationPipeline` orchestrates the overall flow
- Hot-swap via `switchEngine()` — disposes old engines before creating new ones
- Cascade mode: STTEngine → TranslatorEngine (all current modes)
- Results emitted via EventEmitter `result` event
- `ContextBuffer` provides previous segments for context-aware translation
- `TranslationCache` provides LRU cache for repeated phrases to avoid redundant translation calls

## UtilityProcess (LLM Engines)
- Shared `worker-pool.ts` manages a single `slm-worker.ts` UtilityProcess
- `HyMT2Translator` and the meeting summary (TranslateGemma GGUF) share this worker
- Worker hot-swaps loaded models via dispose+init sequence without process restart
