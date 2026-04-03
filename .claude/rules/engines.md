---
description: Translation engine plugin patterns
globs: src/engines/**/*.ts, src/pipeline/**/*.ts
---

# Engine Plugin Rules

## Current Engine Landscape

### STT Engines (2 primary + 8 experimental)

**Primary (shown in UI):**
| Engine | File | Notes |
|--------|------|-------|
| Whisper Local | `WhisperLocalEngine.ts` | Native whisper.cpp, primary default |
| MLX Whisper | `MlxWhisperEngine.ts` | Apple Silicon, JA CER 8.1%, EN WER 3.8%, 2.9s |

**Experimental (hidden from UI):**
- Apple SpeechTranscriber (`AppleSpeechTranscriberEngine.ts`) — macOS 26+ only, zero model management
- Moonshine Tiny JA (`MoonshineTinyJaEngine.ts`) — ultra-fast draft STT, JA CER 10.1%, 845ms latency
- Kotoba-Whisper (`KotobaWhisperEngine.ts`) — JA-optimized Whisper variant
- SpeechSwift (`SpeechSwiftEngine.ts`) — speech-swift CLI bridge
- SenseVoice, Qwen3-ASR, Qwen ASR, Sherpa-ONNX — under evaluation

**Removed (benchmark failures):**
- Lightning Whisper MLX — JA CER 162%
- Moonshine base — JA CER 221% (note: Moonshine Tiny JA is a different, improved variant)

### Translation Engines (5 primary + 8 experimental)

**Primary (shown in UI):**
| Engine | File | JA→EN | EN→JA | Memory | Offline |
|--------|------|-------|-------|--------|---------|
| OPUS-MT (fast default) | `OpusMTTranslator.ts` | 279ms | 462ms | 0.98GB | Yes |
| Hunyuan-MT 7B (quality) | `HunyuanMTTranslator.ts` | 3.7s | 6.3s | 4GB | Yes |
| Google Translate | `GoogleTranslator.ts` | Fast | Fast | — | No |
| DeepL | `DeepLTranslator.ts` | Fast | Fast | — | No |
| Gemini | `GeminiTranslator.ts` | Fast | Fast | — | No |

**Experimental (hidden from UI):**
- HybridTranslator (`HybridTranslator.ts`) — two-stage: OPUS-MT draft + LLM refinement
- TranslateGemma (via `SLMTranslator.ts`) — 8s/sentence, too slow for real-time
- HY-MT1.5 (`HunyuanMT15Translator.ts`) — supports speculative decoding with LFM2 draft model (`LFM2Translator.ts`)
- PLaMo (`PLaMoTranslator.ts`) — under evaluation
- LlamaWorker (`LlamaWorkerTranslator.ts`) — generic llama worker translator
- ANE (`ANETranslator.ts`) — Apple Neural Engine backend, under evaluation

**Removed (benchmark failures):**
- ALMA-Ja, Gemma-2-JPN

## Adding New Engines
1. Create a new file in `src/engines/stt/` or `src/engines/translator/`
2. Implement the corresponding interface from `src/engines/types.ts`
3. Register the factory in `src/main/index.ts` → `initPipeline()`
4. For primary engines: add to `src/renderer/components/SettingsPanel.tsx`
5. For experimental engines: register but hide from UI (do not add to SettingsPanel)
6. Alternatively, create a plugin in `userData/plugins/` with a `live-translate-plugin.json` manifest

## Interface Contracts
- `initialize()` must be idempotent — safe to call multiple times
- `dispose()` must release all resources and be safe to call even if not initialized
- `processAudio()` returns `null` for silence/no-speech — never throws for empty input
- `translate()` accepts optional `TranslateContext` for context-aware translation
- All engines must handle errors internally and log them — pipeline should not crash

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
- `HunyuanMTTranslator`, `HunyuanMT15Translator`, and `SLMTranslator` all share this worker
- Worker hot-swaps loaded models via dispose+init sequence without process restart
- Also handles meeting summary generation
