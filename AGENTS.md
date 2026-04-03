# AGENTS.md

This file provides guidance to AI coding agents working with this repository.

## Project Overview

Live Translate is a real-time speech translation overlay app for macOS and Windows. It captures microphone audio via Silero VAD (with optional DeepFilterNet3 noise suppression), performs speech-to-text with pluggable STT engines (Whisper Local, MLX Whisper), translates via pluggable translation engines (OPUS-MT, Hunyuan-MT 7B, Google, DeepL, Gemini), and displays subtitles on an external display. Features GPU-accelerated offline translation, hybrid two-stage translation, translation LRU cache, meeting summaries, Chrome extension audio input, global keyboard shortcuts, accessibility (high contrast, dyslexia font, WCAG compliance), enterprise features (MDM config, admin lock, usage analytics, telemetry consent), auto-updates, and a plugin system.

## Commands

```bash
# Development
npm run dev          # Start Electron in dev mode (hot reload)
npm run build        # Build for production
npm run test         # Run unit tests (Vitest, 79 tests)
npm run package      # Package as macOS .app / Windows .exe
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
│   │   ├── ipc/                 # Modular IPC handlers
│   │   │   ├── audio-ipc.ts, pipeline-ipc.ts, settings-ipc.ts, ...
│   │   │   ├── enterprise-ipc.ts   # Enterprise features IPC
│   │   │   ├── shortcut-ipc.ts     # Keyboard shortcut IPC
│   │   │   └── tts-ipc.ts          # TTS IPC
│   │   ├── ipc-validators.ts    # IPC input validation (path traversal, types)
│   │   ├── audio-handlers.ts    # Audio processing IPC (process, streaming, finalize)
│   │   ├── shortcut-manager.ts  # Global keyboard shortcuts (Ctrl+Shift based)
│   │   ├── mdm-config.ts       # MDM/enterprise configuration reader
│   │   ├── tts-manager.ts      # Text-to-speech manager
│   │   ├── virtual-mic-manager.ts # Virtual microphone manager
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
│   │   │   ├── SubtitleOverlay.tsx  # Transparent subtitle window
│   │   │   └── settings/           # Modular settings panels
│   │   │       ├── AccessibilitySettings.tsx  # High contrast, dyslexia font, WCAG
│   │   │       ├── KeyboardShortcuts.tsx      # Shortcut configuration UI
│   │   │       ├── EnterpriseSettings.tsx     # MDM config, admin lock, telemetry
│   │   │       ├── TTSSettings.tsx            # Text-to-speech settings
│   │   │       ├── VirtualMicSettings.tsx     # Virtual microphone settings
│   │   │       └── ...                        # Audio, Language, STT, Subtitle, etc.
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
│   │   │   ├── WhisperLocalEngine.ts            # whisper.cpp + hallucination filter (primary)
│   │   │   ├── MlxWhisperEngine.ts              # mlx-whisper (Apple Silicon, primary)
│   │   │   ├── AppleSpeechTranscriberEngine.ts  # macOS 26+ native STT (experimental)
│   │   │   ├── MoonshineTinyJaEngine.ts         # Ultra-fast draft STT (experimental)
│   │   │   ├── KotobaWhisperEngine.ts           # JA-optimized Whisper (experimental)
│   │   │   ├── SpeechSwiftEngine.ts             # speech-swift CLI bridge (experimental)
│   │   │   ├── SenseVoiceEngine.ts              # SenseVoice (experimental)
│   │   │   ├── Qwen3ASREngine.ts                # Qwen3 ASR (experimental)
│   │   │   ├── QwenASREngine.ts                 # Qwen ASR (experimental)
│   │   │   └── SherpaOnnxEngine.ts              # Sherpa-ONNX (experimental)
│   │   └── translator/
│   │       ├── OpusMTTranslator.ts       # OPUS-MT (fast default, offline)
│   │       ├── HunyuanMTTranslator.ts    # Hunyuan-MT 7B (quality, offline)
│   │       ├── HunyuanMT15Translator.ts  # HY-MT1.5 (experimental)
│   │       ├── HybridTranslator.ts       # Two-stage: OPUS-MT draft + LLM refine
│   │       ├── GoogleTranslator.ts
│   │       ├── DeepLTranslator.ts
│   │       ├── GeminiTranslator.ts
│   │       ├── MicrosoftTranslator.ts
│   │       ├── SLMTranslator.ts          # TranslateGemma (experimental)
│   │       ├── LFM2Translator.ts        # LFM2 draft model for speculative decoding
│   │       ├── LlamaWorkerTranslator.ts # Generic llama worker translator
│   │       ├── PLaMoTranslator.ts       # PLaMo translation (experimental)
│   │       ├── ANETranslator.ts         # Apple Neural Engine (experimental)
│   │       ├── ApiRotationController.ts  # Multi-provider rotation
│   │       ├── glossary-manager.ts      # Custom glossary management
│   │       ├── api-utils.ts              # Shared API utilities
│   │       └── hallucination-filter.ts   # Translation hallucination detection
│   ├── pipeline/
│   │   ├── TranslationPipeline.ts  # Orchestration, streaming, auto-recovery
│   │   ├── EngineManager.ts        # Engine registration, creation, init/dispose
│   │   ├── StreamingProcessor.ts   # Streaming audio processing logic
│   │   ├── MemoryMonitor.ts        # Process memory usage monitoring
│   │   ├── LocalAgreement.ts       # LCP for streaming stability
│   │   ├── ContextBuffer.ts        # Ring buffer for context-aware translation
│   │   ├── TranslationCache.ts     # LRU cache for repeated phrases
│   │   ├── GERProcessor.ts         # GER processing
│   │   └── whisper-filter.ts       # Hallucination detection
│   └── logger/
│       ├── TranscriptLogger.ts     # Plain text session logging
│       └── SessionManager.ts       # JSON sessions, search, export
├── resources/
│   ├── mlx-whisper-bridge.py       # Python bridge for mlx-whisper
│   ├── sensevoice-bridge.py        # Python bridge for SenseVoice
│   ├── moonshine-tiny-ja-bridge.py # Python bridge for Moonshine Tiny JA
│   └── ane-translate-bridge.py     # Python bridge for ANE translation
├── scripts/
│   ├── fix-whisper-addon.js        # postinstall: fix macOS dylib paths
│   ├── after-pack.js              # electron-builder: fix packaged paths
│   └── apple-stt/                 # Apple SpeechTranscriber Swift bridge
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
- LLM-based engines run in a shared UtilityProcess pool (`worker-pool.ts`) via node-llama-cpp
- `HunyuanMTTranslator`, `HunyuanMT15Translator`, `SLMTranslator` all share one worker process
- Worker hot-swaps models without process restart
- Also handles meeting summary generation

**Hybrid Translation**
- `HybridTranslator` implements two-stage translation: fast OPUS-MT draft + LLM refinement
- Draft result emitted immediately via callback, refined result returned if different

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
