# AGENTS.md

This file provides guidance to AI coding agents working with this repository.

## Project Overview

live-translate is a real-time speech translation overlay app for presentations. It captures microphone audio via Silero VAD, performs speech-to-text with Whisper (local), translates via pluggable engines (Google / DeepL / Azure / Gemini / OPUS-MT / Whisper translate), and displays subtitles on an external display overlaid on presentation slides. Supports streaming display via Local Agreement algorithm.

## Commands

```bash
# Development
npm run dev        # Start Electron in dev mode (hot reload)
npm run build      # Build for production
npm run package    # Package as macOS .app

# After cloning
npm install        # Install deps (postinstall fixes whisper-node-addon)
                   # node-llama-cpp compiles native bindings (requires Xcode CLT)

# Testing
npm test           # Run unit tests (Vitest)
```

## Architecture

### Tech Stack
- Electron + React + TypeScript
- electron-vite (build tooling)
- whisper-node-addon (whisper.cpp native Node.js binding)
- @ricky0123/vad-web (Silero VAD for voice activity detection)
- Multiple translation backends (Google, DeepL, Azure, Gemini, OPUS-MT)
- Local Agreement algorithm for streaming subtitle display

### Module Structure

```
live-translate/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry, window management, IPC, pipeline wiring
│   │   └── store.ts             # electron-store (settings, quota tracking)
│   ├── preload/                 # Context bridge (renderer ↔ main IPC, with unsubscribe)
│   ├── renderer/                # React UI
│   │   ├── components/
│   │   │   ├── SettingsPanel.tsx    # Main control panel (6 engine modes, session timer)
│   │   │   └── SubtitleOverlay.tsx  # Transparent subtitle window (final + interim)
│   │   └── hooks/
│   │       └── useAudioCapture.ts   # Mic capture via Silero VAD, streaming chunks
│   ├── engines/                 # Pluggable translation engines (Strategy pattern)
│   │   ├── types.ts             # Interfaces: STTEngine, TranslatorEngine, E2ETranslationEngine
│   │   ├── model-downloader.ts  # Whisper GGML model auto-download
│   │   ├── stt/
│   │   │   └── WhisperLocalEngine.ts    # Local STT + hallucination filter
│   │   ├── translator/
│   │   │   ├── GoogleTranslator.ts      # Google Cloud Translation API v2
│   │   │   ├── DeepLTranslator.ts       # DeepL API
│   │   │   ├── GeminiTranslator.ts      # Gemini 2.5 Flash (LLM-based)
│   │   │   ├── MicrosoftTranslator.ts   # Azure Microsoft Translator
│   │   │   ├── OpusMTTranslator.ts      # OPUS-MT (Hugging Face, offline)
│   │   │   └── ApiRotationController.ts # Multi-provider rotation with quota tracking
│   │   └── e2e/
│   │       └── WhisperTranslateEngine.ts # Offline JA→EN (Whisper translate task)
│   ├── pipeline/
│   │   ├── TranslationPipeline.ts  # STT → translate orchestration, streaming, auto-recovery
│   │   ├── LocalAgreement.ts       # Longest common prefix for streaming stability
│   │   └── whisper-filter.ts       # Whisper hallucination detection and filtering
│   └── logger/
│       └── TranscriptLogger.ts     # Session transcript file writer
├── scripts/
│   └── fix-whisper-addon.js        # postinstall: fix macOS dylib paths
├── models/                         # Whisper GGML models (auto-downloaded, gitignored)
└── logs/                           # Transcript logs (gitignored)
```

### Key Design Patterns

**Strategy Pattern (Engine Swapping)**
- All engines implement shared interfaces from `engines/types.ts`
- `TranslationPipeline` registers engine factories and switches at runtime
- Adding a new engine = 1 file implementing the interface + registration in `main/index.ts`

**Two Pipeline Modes**
- `cascade`: STTEngine → TranslatorEngine (online: Whisper + any translator)
- `e2e`: E2ETranslationEngine (offline: Whisper translate task)

**Streaming via Local Agreement**
- `processStreaming()`: Called periodically during speech with rolling buffer. Emits `interim-result` events with confirmed + tentative text
- `finalizeStreaming()`: Called when speech ends. Promotes all text to confirmed and emits `result` event
- Only translates newly confirmed text to minimize API calls

**API Rotation**
- `ApiRotationController` wraps multiple `TranslatorEngine` instances
- Routes to first non-exhausted provider (Azure → Google → DeepL)
- Tracks per-provider monthly character usage via electron-store

**Production Hardening**
- Memory monitoring logs heap/RSS every 60s during active sessions
- Auto-recovery reinitializes engines after 3 consecutive errors
- `whisper-filter.ts` catches hallucination patterns before they reach the pipeline
- Graceful degradation shows STT-only results when translator is unavailable

**IPC Architecture**
- Renderer captures audio → sends via IPC to main process
- Main process runs Whisper (native addon) → translation → sends result via IPC
- Subtitle window receives both `translation-result` (final) and `interim-result` (streaming) via IPC
- All IPC listeners return unsubscribe functions for proper cleanup

**IPC Channels**
- `pipeline-start` / `pipeline-stop`: Pipeline lifecycle
- `process-audio`: Final audio chunk (VAD speech end)
- `process-audio-streaming`: Rolling buffer during speech
- `finalize-streaming`: Speech segment ended, promote to final
- `get-session-start-time`: For session duration display
- `status-update`: Engine status messages (main → renderer)
- `translation-result`: Final translation (main → subtitle + renderer)
- `interim-result`: Streaming interim translation (main → subtitle)

## Code Quality

- TypeScript strict mode enabled
- Run `npm run build` to verify no type errors before committing
- Engine `processAudio()` must return `null` (never throw) for no-speech/error cases
- Engine `initialize()` must be idempotent (safe to call multiple times)
- Engine `dispose()` must be safe to call even if not initialized
