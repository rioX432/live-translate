# Live Translate Architecture

## Overview

Real-time speech translation overlay app for macOS and Windows.
Bidirectional JA↔EN translation with transparent subtitles overlaid on any display.
GPU-accelerated offline translation, pluggable engine system, meeting summaries,
accessibility features (WCAG compliance), and global keyboard shortcuts.

## Tech Stack

- **Framework**: Electron + React + TypeScript
- **Build**: electron-vite
- **STT**: whisper-node-addon (whisper.cpp), mlx-whisper (Python bridge), Apple SpeechTranscriber (macOS 26+), Moonshine Tiny JA (draft)
- **VAD**: @ricky0123/vad-web (Silero VAD)
- **Translation (online)**: Google Cloud Translation, DeepL, Azure Microsoft Translator, Gemini 2.5 Flash
- **Translation (offline)**: OPUS-MT (Hugging Face), Hunyuan-MT 7B / HY-MT1.5 (node-llama-cpp, UtilityProcess)
- **LLM**: node-llama-cpp (meeting summaries, context-aware translation)
- **Streaming**: Local Agreement algorithm for low-latency display
- **Testing**: Vitest

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Electron App                                                               │
│                                                                             │
│  ┌──────────────────┐                                                       │
│  │ AudioCapture     │ (Web Audio API + Silero VAD)                          │
│  │ 16kHz PCM Float32│                                                       │
│  └──────┬───────────┘                                                       │
│         │ IPC (Array.from → Float32Array)                                    │
│         ▼                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ TranslationPipeline (Strategy Pattern)                               │   │
│  │                                                                      │   │
│  │  Cascade Mode:                                                       │   │
│  │  ┌─────────────┐   ┌──────────────────────────────────────────────┐ │   │
│  │  │ STT Engine  │──→│ Translator Engine                            │ │   │
│  │  │ Whisper /   │   │ Google / DeepL / Azure / Gemini /            │ │   │
│  │  │ mlx-whisper/│   │ OPUS-MT / Hunyuan-MT / Rotation             │ │   │
│  │  │ Apple STT   │   └──────────────────────────────────────────────┘ │   │
│  │  └─────────────┘                                                    │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────┐  ┌───────────────────────────────┐  │   │
│  │  │ TranslationCache (LRU)    │  │ ContextBuffer (ring buffer)   │  │   │
│  │  │ (repeated phrase caching)  │  │ (context-aware translation)   │  │   │
│  │  └────────────────────────────┘  └───────────────────────────────┘  │   │
│  │                                                                      │   │
│  │  Streaming: LocalAgreement                                           │   │
│  │  processStreaming() → interim results | finalizeStreaming() → final   │   │
│  └──────────────┬──────────────────────────┬────────────────────────────┘   │
│                 │                          │                                 │
│       ┌─────────┴──────────┐    ┌──────────┴───────────┐                    │
│       ▼                    ▼    ▼                      ▼                    │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐          │
│  │ SubtitleOver │  │ TranscriptLogger │  │ SessionManager       │          │
│  │ (transparent │  │ (file logging)   │  │ (JSON, search,       │          │
│  │  + speaker)  │  │                  │  │  export text/SRT/MD) │          │
│  └──────────────┘  └──────────────────┘  └──────────────────────┘          │
│                                                                             │
│  ┌──────────────────────────────┐                                           │
│  │ SLM Worker (UtilityProcess) │  ← Hunyuan-MT / HY-MT1.5 + Summaries    │
│  │ node-llama-cpp, GPU/Metal   │                                           │
│  └──────────────────────────────┘                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
live-translate/
├── src/
│   ├── main/
│   │   ├── index.ts                   # Entry point, pipeline wiring
│   │   ├── ipc-handlers.ts           # IPC handlers (pipeline, settings, sessions)
│   │   ├── ipc/                       # Modular IPC handlers (audio, pipeline, settings, etc.)
│   │   ├── shortcut-manager.ts        # Global keyboard shortcuts (Ctrl+Shift based)
│   │   ├── mdm-config.ts             # MDM/enterprise configuration
│   │   ├── tts-manager.ts            # Text-to-speech manager
│   │   ├── virtual-mic-manager.ts     # Virtual microphone manager
│   │   ├── store.ts                   # electron-store (encrypted settings, quota)
│   │   └── slm-worker.ts             # UtilityProcess: Hunyuan-MT + summarization
│   ├── preload/
│   │   ├── index.ts                   # Context bridge with unsubscribe support
│   │   └── index.d.ts                # Type declarations for all IPC channels
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── SettingsPanel.tsx      # Control panel (engines, STT, subtitles)
│   │   │   ├── SubtitleOverlay.tsx    # Transparent subtitle window
│   │   │   └── settings/             # Modular settings panels
│   │   │       ├── AccessibilitySettings.tsx  # High contrast, dyslexia font, WCAG
│   │   │       ├── KeyboardShortcuts.tsx      # Shortcut configuration UI
│   │   │       ├── EnterpriseSettings.tsx     # MDM config, admin lock, telemetry
│   │   │       └── ...                        # Audio, Language, STT, Subtitle, etc.
│   │   └── hooks/
│   │       └── useAudioCapture.ts     # Mic/virtual audio capture via Silero VAD
│   ├── engines/
│   │   ├── types.ts                   # STTEngine, TranslatorEngine, TranslateContext
│   │   ├── model-downloader.ts        # Whisper + GGUF model download (resume, SHA256)
│   │   ├── gpu-detector.ts            # GPU detection via node-llama-cpp
│   │   ├── plugin-loader.ts           # Plugin manifest validation and loading
│   │   ├── stt/
│   │   │   ├── WhisperLocalEngine.ts          # whisper.cpp + hallucination filter
│   │   │   ├── MlxWhisperEngine.ts            # mlx-whisper via Python subprocess
│   │   │   ├── AppleSpeechTranscriberEngine.ts # macOS 26+ native STT (experimental)
│   │   │   ├── MoonshineTinyJaEngine.ts       # Ultra-fast draft STT (experimental)
│   │   │   ├── KotobaWhisperEngine.ts         # JA-optimized Whisper (experimental)
│   │   │   └── SpeechSwiftEngine.ts           # speech-swift CLI bridge (experimental)
│   │   └── translator/
│   │       ├── GoogleTranslator.ts
│   │       ├── DeepLTranslator.ts
│   │       ├── GeminiTranslator.ts
│   │       ├── MicrosoftTranslator.ts
│   │       ├── OpusMTTranslator.ts
│   │       ├── SLMTranslator.ts       # TranslateGemma (UtilityProcess proxy)
│   │       ├── LFM2Translator.ts      # LFM2 draft model for speculative decoding
│   │       ├── PLaMoTranslator.ts     # PLaMo translation (experimental)
│   │       └── ApiRotationController.ts
│   ├── pipeline/
│   │   ├── TranslationPipeline.ts     # Orchestration, streaming, auto-recovery
│   │   ├── EngineManager.ts           # Engine registration, creation, init/dispose
│   │   ├── StreamingProcessor.ts      # Streaming audio processing logic
│   │   ├── MemoryMonitor.ts           # Process memory usage monitoring
│   │   ├── LocalAgreement.ts          # LCP for streaming stability
│   │   ├── ContextBuffer.ts           # Ring buffer for context-aware translation
│   │   ├── TranslationCache.ts        # LRU cache for repeated phrases
│   │   ├── GERProcessor.ts            # GER processing
│   │   └── whisper-filter.ts          # Hallucination detection
│   └── logger/
│       ├── TranscriptLogger.ts        # Plain text session logging
│       └── SessionManager.ts          # JSON sessions, search, export (text/SRT/MD)
├── resources/
│   ├── mlx-whisper-bridge.py          # Python bridge for mlx-whisper
│   ├── sensevoice-bridge.py           # Python bridge for SenseVoice
│   ├── moonshine-tiny-ja-bridge.py    # Python bridge for Moonshine Tiny JA
│   └── ane-translate-bridge.py        # Python bridge for ANE translation
├── scripts/
│   ├── fix-whisper-addon.js           # postinstall: fix macOS dylib paths
│   ├── after-pack.js                  # electron-builder: fix paths in packaged app
│   └── apple-stt/                     # Apple SpeechTranscriber Swift bridge
├── benchmark/                         # Standalone translation quality benchmark
└── models/                            # Auto-downloaded models (gitignored)
```

## Engine Auto-Selection

| Condition | Engine |
|-----------|--------|
| API keys configured | API Rotation (Azure → Google → DeepL → Gemini) |
| GPU detected, no keys | TranslateGemma 4B |
| No GPU, no keys | OPUS-MT |

## Plugin System

Third-party engines can be installed as plugins in `userData/plugins/`:

```json
{
  "name": "my-translator",
  "version": "1.0.0",
  "engineType": "translator",
  "engineId": "my-translator",
  "entryPoint": "index.js"
}
```

Plugins are auto-discovered and registered on app startup.

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `pipeline-start` / `pipeline-stop` | R→M | Pipeline lifecycle |
| `process-audio` | R→M | Final audio chunk |
| `process-audio-streaming` | R→M | Rolling buffer during speech |
| `finalize-streaming` | R→M | Speech ended, promote to final |
| `translation-result` / `interim-result` | M→R/S | Results to UI |
| `status-update` | M→R | Engine status messages |
| `subtitle-settings-changed` | M→S | Live subtitle preview |
| `detect-gpu` | R→M | GPU info for auto-selection |
| `generate-summary` | R→M | Meeting summary generation |
| `list-sessions` / `export-session` | R→M | Session management |

R=Renderer, M=Main, S=Subtitle window
