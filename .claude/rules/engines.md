---
description: Translation engine plugin patterns
globs: src/engines/**/*.ts, src/pipeline/**/*.ts
---

# Engine Plugin Rules

## Adding New Engines
1. Create a new file in `src/engines/stt/`, `src/engines/translator/`, or `src/engines/e2e/`
2. Implement the corresponding interface from `src/engines/types.ts`
3. Register the factory in `src/main/index.ts` → `initPipeline()`
4. Add the engine option to `src/renderer/components/SettingsPanel.tsx`

## Interface Contracts
- `initialize()` must be idempotent — safe to call multiple times
- `dispose()` must release all resources and be safe to call even if not initialized
- `processAudio()` returns `null` for silence/no-speech — never throws for empty input
- All engines must handle errors internally and log them — pipeline should not crash

## Pipeline
- `TranslationPipeline` owns engine lifecycle (init/dispose)
- Hot-swap via `switchEngine()` — disposes old engines before creating new ones
- Two modes: `cascade` (STT + Translator) and `e2e` (single engine)
- Results emitted via EventEmitter `result` event
