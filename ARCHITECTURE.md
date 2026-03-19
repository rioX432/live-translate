# Live Translate Architecture

## Overview

Real-time speech translation overlay app for macOS.
Bidirectional JA↔EN translation with transparent subtitles overlaid on any display.
GPU-accelerated offline translation, pluggable engine system, meeting summaries.

## Tech Stack

- **Framework**: Electron + React + TypeScript
- **Build**: electron-vite
- **STT**: whisper-node-addon (whisper.cpp), mlx-whisper (Python bridge), Moonshine AI (ONNX)
- **VAD**: @ricky0123/vad-web (Silero VAD)
- **Translation (online)**: Google Cloud Translation, DeepL, Azure Microsoft Translator, Gemini 2.5 Flash
- **Translation (offline)**: OPUS-MT (Hugging Face), TranslateGemma 4B (node-llama-cpp, UtilityProcess)
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
│  │  │ mlx-whisper/│   │ OPUS-MT / TranslateGemma / Rotation         │ │   │
│  │  │ Moonshine   │   └──────────────────────────────────────────────┘ │   │
│  │  └─────────────┘                                                    │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────┐  ┌───────────────────────────────┐  │   │
│  │  │ SpeakerTracker             │  │ ContextBuffer (ring buffer)   │  │   │
│  │  │ (silence-gap diarization)  │  │ (context-aware translation)   │  │   │
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
│  │ SLM Worker (UtilityProcess) │  ← TranslateGemma 4B + Meeting Summaries │
│  │ node-llama-cpp, GPU/Metal   │                                           │
│  └──────────────────────────────┘                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
live-translate/
├── src/
│   ├── main/
│   │   ├── index.ts                   # Entry point, IPC handlers, pipeline wiring
│   │   ├── store.ts                   # electron-store (encrypted settings, quota)
│   │   └── slm-worker.ts             # UtilityProcess: TranslateGemma + summarization
│   ├── preload/
│   │   ├── index.ts                   # Context bridge with unsubscribe support
│   │   └── index.d.ts                # Type declarations for all IPC channels
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── SettingsPanel.tsx      # Control panel (auto/8 engines, STT selector, subtitles)
│   │   │   └── SubtitleOverlay.tsx    # Transparent subtitle window (speaker labels, settings-driven)
│   │   └── hooks/
│   │       └── useAudioCapture.ts     # Mic/virtual audio capture via Silero VAD
│   ├── engines/
│   │   ├── types.ts                   # STTEngine, TranslatorEngine, TranslateContext
│   │   ├── model-downloader.ts        # Whisper + GGUF model download (resume, SHA256)
│   │   ├── gpu-detector.ts            # GPU detection via node-llama-cpp
│   │   ├── plugin-loader.ts           # Plugin manifest validation and loading
│   │   ├── stt/
│   │   │   ├── WhisperLocalEngine.ts  # whisper.cpp + hallucination filter
│   │   │   ├── MlxWhisperEngine.ts    # mlx-whisper via Python subprocess
│   │   │   └── MoonshineEngine.ts     # Moonshine AI via ONNX
│   │   └── translator/
│   │       ├── GoogleTranslator.ts
│   │       ├── DeepLTranslator.ts
│   │       ├── GeminiTranslator.ts
│   │       ├── MicrosoftTranslator.ts
│   │       ├── OpusMTTranslator.ts
│   │       ├── SLMTranslator.ts       # TranslateGemma 4B (UtilityProcess proxy)
│   │       └── ApiRotationController.ts
│   ├── pipeline/
│   │   ├── TranslationPipeline.ts     # Orchestration, streaming, auto-recovery
│   │   ├── LocalAgreement.ts          # LCP for streaming stability
│   │   ├── ContextBuffer.ts           # Ring buffer for context-aware translation
│   │   ├── SpeakerTracker.ts          # Silence-gap speaker change detection
│   │   ├── PyannoteDiarizer.ts        # pyannote.audio via Python subprocess
│   │   └── whisper-filter.ts          # Hallucination detection
│   └── logger/
│       ├── TranscriptLogger.ts        # Plain text session logging
│       └── SessionManager.ts          # JSON sessions, search, export (text/SRT/MD)
├── resources/
│   ├── mlx-whisper-bridge.py          # Python bridge for mlx-whisper
│   └── pyannote-bridge.py             # Python bridge for pyannote diarization
├── scripts/
│   ├── fix-whisper-addon.js           # postinstall: fix macOS dylib paths
│   └── after-pack.js                  # electron-builder: fix paths in packaged app
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
