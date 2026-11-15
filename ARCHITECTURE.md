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
- **Translation (online, opt-in)**: Azure Translator F0 (recommended), Google Cloud Translation, DeepL, Gemini 2.5 Flash — managed by `ApiRotationController` with quota tracking and local fallback
- **Translation (offline, default)**: HY-MT1.5 1.8B (fast default), Hunyuan-MT 7B (quality), OPUS-MT (legacy fallback) via node-llama-cpp UtilityProcess
- **Diarization**: FluidAudio (CoreML) for speaker labels on macOS
- **LLM**: node-llama-cpp (LLM-based translation, context-aware, prefix-cache pre-warming)
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
│   │   ├── index.ts                   # Entry point, pipeline wiring, startup migrations
│   │   ├── ipc/                       # Modular IPC: pipeline, settings, onboarding, shortcuts
│   │   ├── shortcut-manager.ts        # Global keyboard shortcuts (Ctrl+Shift based)
│   │   ├── onboarding-downloader.ts   # Tier 1/2 progressive model loading (LFM2 → HY-MT1.5)
│   │   ├── store.ts                   # electron-store (encrypted settings, quota state)
│   │   ├── store-migrations.ts        # Startup migrations for legacy engine IDs (#702, #705)
│   │   ├── worker-pool.ts             # Shared UtilityProcess pool for LLM engines
│   │   └── slm-worker.ts              # UtilityProcess: Hunyuan-MT family + LLM tasks
│   ├── preload/
│   │   ├── index.ts                   # Context bridge with unsubscribe support
│   │   └── index.d.ts                # Type declarations for all IPC channels
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── SettingsPanel.tsx      # Control panel (engines, STT, subtitles)
│   │   │   ├── SubtitleOverlay.tsx    # Transparent subtitle window
│   │   │   ├── Onboarding.tsx         # Three-step wizard (Quick Start → Quality Upgrade → Cloud Boost)
│   │   │   ├── onboarding-steps.ts    # Pure helpers (state machine, Azure URL, validation)
│   │   │   └── settings/              # Modular settings panels
│   │   │       ├── AccessibilitySettings.tsx  # High contrast, dyslexia font, WCAG
│   │   │       ├── KeyboardShortcuts.tsx      # Shortcut configuration UI
│   │   │       ├── TranslatorSettings.tsx     # 5-option engine selector
│   │   │       └── ...                        # Audio, Language, STT, Subtitle, etc.
│   │   └── hooks/
│   │       ├── useAudioCapture.ts     # Mic/virtual audio capture via Silero VAD
│   │       └── useEngineSettings.ts   # Engine state with legacy-ID coercion
│   ├── engines/
│   │   ├── types.ts                   # STTEngine, TranslatorEngine, TranslateContext
│   │   ├── model-downloader.ts        # Whisper + GGUF download (resume, SHA256)
│   │   ├── gpu-detector.ts            # GPU detection via node-llama-cpp
│   │   ├── hardware-recommender.ts    # Auto-select engine for current hardware
│   │   ├── plugin-loader.ts           # Plugin manifest validation and loading
│   │   ├── diarization/
│   │   │   └── FluidAudioDiarizer.ts          # CoreML speaker diarization (macOS)
│   │   ├── stt/                       # 6 primary + 5 experimental engines
│   │   │   ├── WhisperLocalEngine.ts          # whisper.cpp + hallucination filter (default)
│   │   │   ├── MlxWhisperEngine.ts            # mlx-whisper Python subprocess (Apple Silicon)
│   │   │   ├── KotobaWhisperEngine.ts         # JA-optimized Whisper (JA CER 5.6%)
│   │   │   ├── Qwen3ASREngine.ts              # Qwen3-ASR 0.6B (best JA+EN accuracy)
│   │   │   ├── SenseVoiceSherpaEngine.ts      # SenseVoice via sherpa-onnx (~70ms/10s)
│   │   │   ├── AppleSpeechTranscriberEngine.ts # macOS 26+ native STT, ANE-accelerated
│   │   │   ├── MoonshineTinyJaEngine.ts       # Ultra-fast draft STT (experimental)
│   │   │   └── ...                            # SpeechSwift, QwenAsrNative, etc. (experimental)
│   │   └── translator/                # 7 primary + 5 experimental engines
│   │       ├── HunyuanMT15Translator.ts       # HY-MT1.5 1.8B fast default (~180ms)
│   │       ├── HunyuanMTTranslator.ts         # Hunyuan-MT 7B quality mode (3.7s)
│   │       ├── OpusMTTranslator.ts            # Legacy fallback (low-memory systems)
│   │       ├── LFM2Translator.ts              # Ultra-fast draft (~230MB)
│   │       ├── MicrosoftTranslator.ts         # Azure Translator F0 (2M chars/mo free)
│   │       ├── GoogleTranslator.ts            # Google Cloud Translation v2
│   │       ├── DeepLTranslator.ts             # DeepL API
│   │       ├── GeminiTranslator.ts            # Gemini 2.5 Flash
│   │       ├── ApiRotationController.ts       # Quota-tracked rotation + local fallback (#703)
│   │       ├── api-utils.ts                   # 429 classification (rate-limit vs quota)
│   │       ├── glossary-manager.ts            # CSV/JSON glossary (personal + org)
│   │       └── ...                            # PLaMo, Hybrid, ANE, Llama (experimental)
│   ├── pipeline/
│   │   ├── TranslationPipeline.ts     # Orchestration, streaming, auto-recovery
│   │   ├── EngineManager.ts           # Engine registration, creation, init/dispose
│   │   ├── StreamingProcessor.ts      # Streaming audio processing logic
│   │   ├── SegmentTracker.ts          # One final per VAD segment (open → finalizing → finalized)
│   │   ├── MemoryMonitor.ts           # Process memory usage monitoring
│   │   ├── LocalAgreement.ts          # LCP for streaming stability (flicker-free)
│   │   ├── ContextBuffer.ts           # Ring buffer for context-aware translation
│   │   ├── TranslationCache.ts        # LRU cache for repeated phrases
│   │   ├── ClauseBoundary.ts          # Clause-level streaming translation
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
├── benchmark/                         # Standalone benchmarks
│   ├── conversational-ja-en/          # JA↔EN meeting-corpus chrF + latency bench (#706)
│   ├── gpt-realtime-whisper-eval/     # GPT-Realtime-Whisper STT eval scaffold (#698)
│   └── src/                           # Legacy translator/STT benchmarks (60+ npm scripts)
├── docs/
│   ├── cloud-boost.md                 # Azure F0 setup + ApiRotation behavior
│   ├── glossary.md                    # Glossary format and usage
│   └── RESEARCH.md                    # 2026-06 market & technology research
├── e2e/                               # Playwright end-to-end tests
└── models/                            # Auto-downloaded models (gitignored)
```

## Engine Auto-Selection

Default mode `auto` resolves at startup via `useEngineSettings` + `hardware-recommender`:

| Condition | Translator |
|-----------|------------|
| Any cloud API key set | `ApiRotationController` (Azure → Google → DeepL → Gemini → local fallback) |
| Apple Silicon, ≥ 4 GB free | HY-MT1.5 1.8B (fast default) |
| Low-memory or model not yet downloaded | OPUS-MT (legacy fallback) |
| User explicitly selects quality mode | Hunyuan-MT 7B (Apache 2.0, ~4 GB) |

Cloud providers are opt-in; absent any API key, the pipeline stays fully offline. The rotation
controller falls back to `HunyuanMT15Translator` when every cloud provider is exhausted (#703).

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
| `onboarding-*` | R→M | Tier 1/2 download progress, skip, completion state |
| `shortcut-*` | R→M | Global keyboard shortcut registration |
| `glossary-*` | R→M | Personal/org glossary CRUD |
| `list-sessions` / `export-session` | R→M | Session management |

R=Renderer, M=Main, S=Subtitle window
