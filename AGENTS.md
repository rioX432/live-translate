# AGENTS.md

This file provides guidance to AI coding agents working with this repository.

## Project Overview

Live Translate is a real-time speech translation overlay app for presentations and meetings. It captures microphone audio via Silero VAD (with optional DeepFilterNet3 noise suppression), performs speech-to-text with pluggable STT engines (Whisper Local, MLX Whisper), translates via pluggable translation engines (OPUS-MT, Hunyuan-MT 7B, Google, DeepL, Gemini), and displays subtitles on an external display. Features GPU-accelerated offline translation, hybrid two-stage translation, speaker diarization, meeting summaries, Chrome extension audio input, auto-updates, and a plugin system.

## Commands

```bash
# Development
npm run dev          # Start Electron in dev mode (hot reload)
npm run build        # Build for production
npm run test         # Run unit tests (Vitest, 79 tests)
npm run package      # Package as macOS .app
npm run package:dmg  # Build macOS DMG installer

# After cloning
npm install          # Install deps (postinstall fixes whisper-node-addon)
                     # node-llama-cpp compiles native bindings (requires Xcode CLT)
```

## Architecture

### Tech Stack
- Electron + React + TypeScript
- electron-vite (build tooling)
- whisper-node-addon (whisper.cpp native binding — primary STT)
- mlx-whisper (Python subprocess bridge, Apple Silicon — JA CER 8.1%, EN WER 3.8%)
- node-llama-cpp (Hunyuan-MT 7B quality translation, meeting summaries, UtilityProcess)
- @ricky0123/vad-web (Silero VAD)
- Primary translation: CT2 OPUS-MT (~200ms, CTranslate2, default offline), Hunyuan-MT 7B (3.7s, quality), Google, DeepL, Gemini
- Experimental (hidden): TranslateGemma, HY-MT1.5, ONNX OPUS-MT (fallback), CT2 Madlad-400, ANE, Hybrid
- Local Agreement algorithm for streaming subtitle display

### Module Structure

```
live-translate/
├── src/
│   ├── main/
│   │   ├── index.ts             # App entry, pipeline init, lifecycle orchestration
│   │   ├── app-context.ts       # Shared mutable state interface (AppContext)
│   │   ├── window-manager.ts    # Window creation, display handlers
│   │   ├── ipc-handlers.ts      # IPC handlers (pipeline, settings, sessions, ws-audio)
│   │   ├── ipc-validators.ts    # IPC input validation (path traversal, types)
│   │   ├── audio-handlers.ts    # Audio processing IPC (process, streaming, finalize)
│   │   ├── error-utils.ts       # Error sanitization and hint mapping
│   │   ├── logger.ts            # Structured logger (levels, module prefixes)
│   │   ├── constants.ts         # Shared constants (WS port, sample rate)
│   │   ├── store.ts             # electron-store (encrypted, settings, quota)
│   │   ├── auto-updater.ts      # electron-updater auto-update lifecycle
│   │   ├── ws-audio-server.ts   # WebSocket server for Chrome extension audio
│   │   ├── worker-pool.ts       # Shared UtilityProcess pool for slm-worker
│   │   └── slm-worker.ts        # UtilityProcess: LLM translation + summarization
│   ├── preload/                 # Context bridge (renderer ↔ main IPC)
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── SettingsPanel.tsx    # Control panel (5 primary engines, STT, subtitles)
│   │   │   └── SubtitleOverlay.tsx  # Transparent subtitle window (speaker labels)
│   │   └── hooks/
│   │       ├── useAudioCapture.ts      # Mic/virtual audio capture via Silero VAD
│   │       ├── useNoiseSuppression.ts  # DeepFilterNet3 noise suppression
│   │       └── useSettingsState.ts     # Settings state management + engine config
│   ├── engines/
│   │   ├── types.ts             # STTEngine, TranslatorEngine, TranslateContext
│   │   ├── model-downloader.ts  # Whisper + GGUF download (resume, SHA256)
│   │   ├── gpu-detector.ts      # GPU detection via node-llama-cpp
│   │   ├── plugin-loader.ts     # Engine plugin manifest + loading
│   │   ├── SubprocessBridge.ts  # Base class for Python bridge processes
│   │   ├── language-names.ts    # Language name mappings (EN, ZH)
│   │   ├── constants.ts         # Shared engine timeout/limit constants
│   │   ├── stt/
│   │   │   ├── WhisperLocalEngine.ts    # whisper.cpp + hallucination filter (primary)
│   │   │   ├── MlxWhisperEngine.ts      # mlx-whisper (Apple Silicon, primary)
│   │   │   ├── SenseVoiceEngine.ts      # SenseVoice (experimental)
│   │   │   ├── QwenASREngine.ts         # Qwen ASR (experimental)
│   │   │   └── SherpaOnnxEngine.ts      # Sherpa-ONNX (experimental)
│   │   └── translator/
│   │       ├── OpusMTTranslator.ts       # OPUS-MT ONNX (fallback, offline)
│   │       ├── CT2OpusMTTranslator.ts    # CT2 OPUS-MT (fast default, ~200ms)
│   │       ├── HunyuanMTTranslator.ts    # Hunyuan-MT 7B (quality, offline)
│   │       ├── HunyuanMT15Translator.ts  # HY-MT1.5 (experimental)
│   │       ├── HybridTranslator.ts       # Two-stage: OPUS-MT draft + LLM refine
│   │       ├── GoogleTranslator.ts
│   │       ├── DeepLTranslator.ts        # Context-aware via API context param
│   │       ├── GeminiTranslator.ts
│   │       ├── MicrosoftTranslator.ts
│   │       ├── SLMTranslator.ts          # TranslateGemma (experimental)
│   │       ├── ApiRotationController.ts  # Multi-provider rotation
│   │       ├── api-utils.ts              # Shared API utilities
│   │       └── hallucination-filter.ts   # Translation hallucination detection
│   ├── pipeline/
│   │   ├── TranslationPipeline.ts  # Orchestration, streaming, auto-recovery
│   │   ├── EngineManager.ts        # Engine registration, creation, init/dispose
│   │   ├── StreamingProcessor.ts   # Streaming audio processing logic
│   │   ├── MemoryMonitor.ts        # Process memory usage monitoring
│   │   ├── LocalAgreement.ts       # LCP for streaming stability
│   │   ├── ContextBuffer.ts        # Ring buffer for context-aware translation
│   │   ├── SpeakerTracker.ts       # Silence-gap speaker detection
│   │   └── whisper-filter.ts       # Hallucination detection
│   └── logger/
│       ├── TranscriptLogger.ts     # Plain text session logging
│       └── SessionManager.ts       # JSON sessions, search, export
├── resources/
│   ├── mlx-whisper-bridge.py       # Python bridge for mlx-whisper
│   ├── sensevoice-bridge.py        # Python bridge for SenseVoice
│   ├── ct2-opus-mt-bridge.py       # Python bridge for CT2 OPUS-MT
│   ├── ct2-madlad400-bridge.py     # Python bridge for CT2 Madlad-400
│   └── ane-translate-bridge.py     # Python bridge for ANE translation
├── scripts/
│   ├── fix-whisper-addon.js        # postinstall: fix macOS dylib paths
│   └── after-pack.js              # electron-builder: fix packaged paths
├── benchmark/                     # Translation + STT quality benchmark (standalone)
│   ├── src/engines/              # Translation benchmark engines (GGUF, API, ONNX)
│   └── src/stt-engines/          # STT benchmark engines (Whisper, SenseVoice, SherpaOnnx)
└── models/                        # Auto-downloaded models (gitignored)
```

### Key Design Patterns

**Strategy Pattern (Engine Swapping)**
- All engines implement shared interfaces from `engines/types.ts`
- `TranslationPipeline` registers engine factories and switches at runtime
- Adding a new engine = 1 file + registration in `main/index.ts` (or via plugin)

**Pipeline Mode: Cascade**
- `cascade`: STTEngine → TranslatorEngine (all current modes)
- STT and translator are independently selectable

**Streaming via Local Agreement**
- `processStreaming()`: Periodic rolling buffer → interim results
- `finalizeStreaming()`: Speech ends → final results
- Only translates newly confirmed text to minimize API calls

**UtilityProcess Isolation**
- LLM-based engines run in a shared UtilityProcess pool (`worker-pool.ts`) via node-llama-cpp
- `HunyuanMTTranslator`, `HunyuanMT15Translator`, `SLMTranslator` all share one worker process
- Worker hot-swaps models without process restart
- Also handles meeting summary generation

**Hybrid Translation**
- `HybridTranslator` implements two-stage translation: fast OPUS-MT draft + LLM refinement
- Draft result emitted immediately via callback, refined result returned if different

**Engine Auto-Selection**
- GPU detection via node-llama-cpp `getGpuDeviceNames()`
- Auto mode: API rotation (if keys) → Hunyuan-MT 7B (if GPU, quality) → CT2 OPUS-MT (fast default)

**Plugin System**
- Plugins in `userData/plugins/` with `live-translate-plugin.json` manifest
- Auto-discovered and registered on startup

**API Rotation**
- `ApiRotationController` wraps multiple providers
- Routes to first non-exhausted provider with quota tracking
- 5-minute cooldown after 5 consecutive failures

**IPC Architecture**
- Renderer → Main: audio chunks, pipeline control, settings
- Main → Subtitle: translation results, subtitle settings
- Main → Renderer: status updates, results
- All listeners return unsubscribe functions

## Code Quality

- TypeScript strict mode enabled
- Run `npm run build` to verify no type errors before committing
- Run `npm test` to verify unit tests pass
- Engine `processAudio()` must return `null` (never throw) for no-speech/error cases
- Engine `initialize()` must be idempotent (safe to call multiple times)
- Engine `dispose()` must be safe to call even if not initialized
- Store is encrypted with `encryptionKey`
- IPC paths are validated against directory traversal
