---
description: Translation engine plugin patterns
globs: src/engines/**/*.ts, src/pipeline/**/*.ts
---

# Engine Plugin Rules

## Current Engine Landscape

### STT Engines (2 primary + 3 experimental)

**Primary (shown in UI):**
| Engine | File | Notes |
|--------|------|-------|
| Whisper Local | `WhisperLocalEngine.ts` | Native whisper.cpp, primary default |
| MLX Whisper | `MlxWhisperEngine.ts` | Apple Silicon, JA CER 8.1%, EN WER 3.8%, 2.9s |

**Experimental (hidden from UI):**
- SenseVoice, Qwen3-ASR, Sherpa-ONNX — under evaluation

**Removed (benchmark failures):**
- Lightning Whisper MLX — JA CER 162%
- Moonshine — JA CER 221%

### Translation Engines (5 primary + 7 experimental)

**Primary (shown in UI):**
| Engine | File | JA→EN | EN→JA | Memory | Offline | Context |
|--------|------|-------|-------|--------|---------|---------|
| CT2 OPUS-MT (fast default) | `CT2OpusMTTranslator.ts` | ~200ms | ~400ms | ~1GB | Yes | Glossary |
| Hunyuan-MT 7B (quality) | `HunyuanMTTranslator.ts` | 3.7s | 6.3s | 4GB | Yes | Full |
| Google Translate | `GoogleTranslator.ts` | Fast | Fast | — | No | — |
| DeepL | `DeepLTranslator.ts` | Fast | Fast | — | No | API context |
| Gemini | `GeminiTranslator.ts` | Fast | Fast | — | No | Full |

**Experimental (hidden from UI):**
- HybridTranslator (`HybridTranslator.ts`) — two-stage: OPUS-MT draft + LLM refinement
- TranslateGemma (via `SLMTranslator.ts`) — 8s/sentence, too slow for real-time
- ONNX OPUS-MT (`OpusMTTranslator.ts`) — fallback, superseded by CT2 version
- HY-MT1.5 (`HunyuanMT15Translator.ts`), CT2 Madlad-400, ANE — under evaluation

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
- `SpeakerTracker` assigns speaker IDs based on silence gaps

## UtilityProcess (LLM Engines)
- Shared `worker-pool.ts` manages a single `slm-worker.ts` UtilityProcess
- `HunyuanMTTranslator`, `HunyuanMT15Translator`, and `SLMTranslator` all share this worker
- Worker hot-swaps loaded models via dispose+init sequence without process restart
- Also handles meeting summary generation
- Per-request profiling logs: prompt build, context creation, inference time, memory (slm-worker)
- Worker-pool logs round-trip timing for requests > 2s
