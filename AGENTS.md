# AGENTS.md

This file provides guidance to AI coding agents working with this repository.

## Project Overview

live-translate is a real-time speech translation overlay app for presentations. It captures microphone audio, performs speech-to-text with Whisper, translates via pluggable engines (Google Translation / Whisper translate task), and displays subtitles on an external display overlaid on presentation slides.

## Commands

```bash
# Development
npm run dev        # Start Electron in dev mode (hot reload)
npm run build      # Build for production
npm run package    # Package as macOS .app

# After cloning
npm install        # Install deps (postinstall fixes whisper-node-addon)
```

## Architecture

### Tech Stack
- Electron + React + TypeScript
- electron-vite (build tooling)
- whisper-node-addon (whisper.cpp native Node.js binding)
- Google Cloud Translation API v2 (online translation)
- Whisper translate task (offline JA→EN translation)

### Module Structure

```
live-translate/
├── src/
│   ├── main/                    # Electron main process
│   │   └── index.ts             # App entry, window management, IPC, pipeline wiring
│   ├── preload/                 # Context bridge (renderer ↔ main IPC)
│   ├── renderer/                # React UI
│   │   ├── components/
│   │   │   ├── SettingsPanel.tsx    # Main control panel
│   │   │   └── SubtitleOverlay.tsx  # Transparent subtitle window
│   │   └── hooks/
│   │       └── useAudioCapture.ts   # Mic capture, PCM chunking
│   ├── engines/                 # Pluggable translation engines (Strategy pattern)
│   │   ├── types.ts             # Shared interfaces: STTEngine, TranslatorEngine, E2ETranslationEngine
│   │   ├── model-downloader.ts  # Whisper GGML model auto-download
│   │   ├── stt/
│   │   │   └── WhisperLocalEngine.ts    # Local STT via whisper-node-addon
│   │   ├── translator/
│   │   │   └── GoogleTranslator.ts      # Google Cloud Translation API
│   │   └── e2e/
│   │       └── WhisperTranslateEngine.ts # Offline JA→EN (Whisper translate task)
│   ├── pipeline/
│   │   └── TranslationPipeline.ts  # STT → translate orchestration with hot-swap
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
- Adding a new engine = 1 file implementing the interface

**Two Pipeline Modes**
- `cascade`: STTEngine → TranslatorEngine (online: Whisper + Google)
- `e2e`: E2ETranslationEngine (offline: Whisper translate task)

**IPC Architecture**
- Renderer captures audio → sends via IPC to main process
- Main process runs Whisper (native addon) → translation → sends result via IPC
- Subtitle window receives results via IPC from main process

## Code Quality

- TypeScript strict mode enabled
- Run `npm run build` to verify no type errors before committing
