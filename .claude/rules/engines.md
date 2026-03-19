---
description: Translation engine plugin patterns
globs: src/engines/**/*.ts, src/pipeline/**/*.ts
---

# Engine Plugin Rules

## Adding New Engines
1. Create a new file in `src/engines/stt/` or `src/engines/translator/`
2. Implement the corresponding interface from `src/engines/types.ts`
3. Register the factory in `src/main/index.ts` → `initPipeline()`
4. Add the engine option to `src/renderer/components/SettingsPanel.tsx`
5. Alternatively, create a plugin in `userData/plugins/` with a `live-translate-plugin.json` manifest

## Interface Contracts
- `initialize()` must be idempotent — safe to call multiple times
- `dispose()` must release all resources and be safe to call even if not initialized
- `processAudio()` returns `null` for silence/no-speech — never throws for empty input
- `translate()` accepts optional `TranslateContext` for context-aware translation
- All engines must handle errors internally and log them — pipeline should not crash

## Pipeline
- `TranslationPipeline` owns engine lifecycle (init/dispose)
- Hot-swap via `switchEngine()` — disposes old engines before creating new ones
- Cascade mode: STTEngine → TranslatorEngine (all current modes)
- Results emitted via EventEmitter `result` event
- `ContextBuffer` provides previous segments for context-aware translation
- `SpeakerTracker` assigns speaker IDs based on silence gaps

## UtilityProcess (TranslateGemma)
- `SLMTranslator` is an IPC proxy to `slm-worker.ts` UtilityProcess
- Worker handles both translation and meeting summarization
- Init handler runs first, general message handler registered after init completes
