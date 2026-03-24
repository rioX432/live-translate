# AGENTS.md

This file provides guidance to AI coding agents working with this repository.

## Project Overview

Live Translate is a real-time speech translation overlay app for presentations and meetings. It captures microphone audio via Silero VAD, performs speech-to-text with pluggable STT engines (Whisper Local, MLX Whisper), translates via pluggable translation engines (OPUS-MT, Hunyuan-MT 7B, Google, DeepL, Gemini), and displays subtitles on an external display. Features GPU-accelerated offline translation, speaker diarization, meeting summaries, and a plugin system.

## Commands

```bash
# Development
npm run dev          # Start Electron in dev mode (hot reload)
npm run build        # Build for production
npm run test         # Run unit tests (Vitest, 32 tests)
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
- Primary translation: OPUS-MT (279ms, offline), Hunyuan-MT 7B (3.7s, quality), Google, DeepL, Gemini
- Experimental (hidden): TranslateGemma, HY-MT1.5, CT2 OPUS-MT, CT2 Madlad-400, ANE
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
│   │   ├── audio-handlers.ts    # Audio processing IPC (process, streaming, finalize)
│   │   ├── error-utils.ts       # Error sanitization and hint mapping
│   │   ├── store.ts             # electron-store (encrypted, settings, quota)
│   │   └── slm-worker.ts        # UtilityProcess: TranslateGemma + summarization
│   ├── preload/                 # Context bridge (renderer ↔ main IPC)
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── SettingsPanel.tsx    # Control panel (5 primary engines, STT, subtitles)
│   │   │   └── SubtitleOverlay.tsx  # Transparent subtitle window (speaker labels)
│   │   └── hooks/
│   │       └── useAudioCapture.ts   # Mic/virtual audio capture via Silero VAD
│   ├── engines/
│   │   ├── types.ts             # STTEngine, TranslatorEngine, TranslateContext
│   │   ├── model-downloader.ts  # Whisper + GGUF download (resume, SHA256)
│   │   ├── gpu-detector.ts      # GPU detection via node-llama-cpp
│   │   ├── plugin-loader.ts     # Engine plugin manifest + loading
│   │   ├── stt/
│   │   │   ├── WhisperLocalEngine.ts    # whisper.cpp + hallucination filter (primary)
│   │   │   └── MlxWhisperEngine.ts      # mlx-whisper (Apple Silicon, primary)
│   │   └── translator/
│   │       ├── GoogleTranslator.ts
│   │       ├── DeepLTranslator.ts
│   │       ├── GeminiTranslator.ts
│   │       ├── MicrosoftTranslator.ts
│   │       ├── OpusMTTranslator.ts
│   │       ├── SLMTranslator.ts         # LLM-based translation (UtilityProcess, experimental)
│   │       └── ApiRotationController.ts # Multi-provider rotation
│   ├── pipeline/
│   │   ├── TranslationPipeline.ts  # Orchestration, streaming, auto-recovery
│   │   ├── LocalAgreement.ts       # LCP for streaming stability
│   │   ├── ContextBuffer.ts        # Ring buffer for context-aware translation
│   │   ├── SpeakerTracker.ts       # Silence-gap speaker detection
│   │   ├── PyannoteDiarizer.ts     # pyannote.audio (Python bridge)
│   │   └── whisper-filter.ts       # Hallucination detection
│   └── logger/
│       ├── TranscriptLogger.ts     # Plain text session logging
│       └── SessionManager.ts       # JSON sessions, search, export
├── resources/
│   ├── mlx-whisper-bridge.py       # Python bridge for mlx-whisper
│   └── pyannote-bridge.py          # Python bridge for pyannote
├── scripts/
│   ├── fix-whisper-addon.js        # postinstall: fix macOS dylib paths
│   └── after-pack.js              # electron-builder: fix packaged paths
├── benchmark/                     # Translation quality benchmark (standalone)
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
- LLM-based engines (Hunyuan-MT 7B, TranslateGemma) run in Electron UtilityProcess via node-llama-cpp
- SLMTranslator acts as IPC proxy (request/response with timeout)
- Also handles meeting summary generation

**Engine Auto-Selection**
- GPU detection via node-llama-cpp `getGpuDeviceNames()`
- Auto mode: API rotation (if keys) → Hunyuan-MT 7B (if GPU, quality) → OPUS-MT (fast default)

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
