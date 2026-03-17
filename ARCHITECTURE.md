# live-translate Architecture

## Overview

Real-time speech translation overlay app for macOS.
Displays bilingual subtitles over slides on an external display during live presentations.

## Tech Stack

- **Framework**: Electron + React + TypeScript
- **Build**: electron-vite
- **STT**: whisper-node-addon (whisper.cpp Node.js native addon)
- **VAD**: @ricky0123/vad-web (Silero VAD, voice activity detection)
- **Translation (online)**: Google Cloud Translation API v2, DeepL API, Azure Microsoft Translator, Gemini 2.5 Flash
- **Translation (offline)**: OPUS-MT (Hugging Face transformers), Whisper translate task (JA→EN only)
- **Streaming**: Local Agreement algorithm for low-latency display
- **Python**: **Not required**

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Electron App                                                           │
│                                                                         │
│  ┌──────────────────┐                                                   │
│  │ AudioCapture     │ (Web Audio API + Silero VAD)                      │
│  │ 16kHz PCM Float32│                                                   │
│  └──────┬───────────┘                                                   │
│         │ IPC (Array.from → Float32Array)                                │
│         ▼                                                               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ TranslationPipeline (Strategy Pattern)                           │   │
│  │                                                                  │   │
│  │  Mode A: Cascade (Online)                                        │   │
│  │  ┌─────────────┐   ┌────────────────────────────────────────┐   │   │
│  │  │ WhisperLocal│──→│ Translator                             │   │   │
│  │  │ (STT+LangDet)│  │ Google / DeepL / Azure / Gemini /     │   │   │
│  │  └─────────────┘   │ OPUS-MT / ApiRotationController       │   │   │
│  │                     └────────────────────────────────────────┘   │   │
│  │  Mode B: E2E (Offline, JA→EN only)                               │   │
│  │  ┌────────────────────────┐                                      │   │
│  │  │ WhisperTranslate       │                                      │   │
│  │  └────────────────────────┘                                      │   │
│  │                                                                  │   │
│  │  Streaming: LocalAgreement                                       │   │
│  │  ┌────────────────────────────────────────────────────┐          │   │
│  │  │ processStreaming() → interim results (during speech)│          │   │
│  │  │ finalizeStreaming() → final result (speech ends)    │          │   │
│  │  └────────────────────────────────────────────────────┘          │   │
│  │                                                                  │   │
│  │  Production Hardening:                                           │   │
│  │  • Memory monitoring (heap/RSS every 60s)                        │   │
│  │  • Auto-recovery after 3 consecutive errors                      │   │
│  │  • Whisper hallucination filter                                  │   │
│  │  • Graceful degradation (STT-only on translator failure)         │   │
│  └──────────────────┬───────────────────────────────────────────────┘   │
│                     │                                                   │
│         ┌───────────┴───────────┐                                       │
│         ▼                       ▼                                       │
│  ┌──────────────┐    ┌──────────────────┐                               │
│  │ SubtitleOver │    │ TranscriptLogger │                               │
│  │ (transparent │    │ (file logging)   │                               │
│  │  + interim)  │    │                  │                               │
│  └──────────────┘    └──────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
live-translate/
├── src/
│   ├── main/                          # Electron main process
│   │   ├── index.ts                   # Entry point, IPC handlers, pipeline wiring
│   │   └── store.ts                   # electron-store (settings, quota tracking)
│   │
│   ├── preload/                       # Context bridge (renderer ↔ main IPC)
│   │   └── index.ts                   # Exposes IPC channels with unsubscribe support
│   │
│   ├── renderer/                      # React UI
│   │   ├── App.tsx                    # Hash routing (#/subtitle for overlay)
│   │   ├── components/
│   │   │   ├── SettingsPanel.tsx      # Main control panel (6 engine modes, session timer)
│   │   │   └── SubtitleOverlay.tsx    # Transparent subtitle window (final + interim lines)
│   │   └── hooks/
│   │       └── useAudioCapture.ts     # Mic capture via Silero VAD
│   │
│   ├── engines/                       # Pluggable engines (Strategy pattern)
│   │   ├── types.ts                   # Interfaces: STTEngine, TranslatorEngine, E2ETranslationEngine
│   │   ├── model-downloader.ts        # Whisper GGML model auto-download
│   │   ├── stt/
│   │   │   └── WhisperLocalEngine.ts  # Local STT via whisper-node-addon + hallucination filter
│   │   ├── translator/
│   │   │   ├── GoogleTranslator.ts    # Google Cloud Translation API v2
│   │   │   ├── DeepLTranslator.ts     # DeepL API
│   │   │   ├── GeminiTranslator.ts    # Gemini 2.5 Flash (LLM-based)
│   │   │   ├── MicrosoftTranslator.ts # Azure Microsoft Translator
│   │   │   ├── OpusMTTranslator.ts    # OPUS-MT via Hugging Face transformers (offline)
│   │   │   └── ApiRotationController.ts # Multi-provider rotation with quota tracking
│   │   └── e2e/
│   │       └── WhisperTranslateEngine.ts # Offline JA→EN (Whisper translate task)
│   │
│   ├── pipeline/
│   │   ├── TranslationPipeline.ts     # STT → translate orchestration, streaming, recovery
│   │   ├── LocalAgreement.ts          # Longest common prefix for streaming stability
│   │   └── whisper-filter.ts          # Whisper hallucination detection and filtering
│   │
│   └── logger/
│       └── TranscriptLogger.ts        # Session transcript file writer
│
├── scripts/
│   └── fix-whisper-addon.js           # postinstall: fix macOS dylib paths
├── models/                            # Whisper GGML models (auto-downloaded, gitignored)
└── logs/                              # Transcript logs (gitignored)
```

## Engine Interfaces

```typescript
interface STTResult {
  text: string
  language: 'ja' | 'en'
  isFinal: boolean
  timestamp: number
}

interface TranslationResult {
  sourceText: string
  translatedText: string
  sourceLanguage: 'ja' | 'en'
  targetLanguage: 'ja' | 'en'
  timestamp: number
  isInterim?: boolean  // true for streaming interim results
}

interface STTEngine {
  readonly id: string
  readonly name: string
  readonly isOffline: boolean
  initialize(): Promise<void>
  processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null>
  dispose(): Promise<void>
}

interface TranslatorEngine {
  readonly id: string
  readonly name: string
  readonly isOffline: boolean
  initialize(): Promise<void>
  translate(text: string, from: Language, to: Language): Promise<string>
  dispose(): Promise<void>
}

interface E2ETranslationEngine {
  readonly id: string
  readonly name: string
  readonly isOffline: boolean
  initialize(): Promise<void>
  processAudio(audioChunk: Float32Array, sampleRate: number): Promise<TranslationResult | null>
  dispose(): Promise<void>
}
```

## Pipeline Modes

### Mode A: Cascade (Online)
```
Mic → VAD → Whisper STT (local) → Language detection → Translator API → Subtitle
```
- JA↔EN bidirectional
- 6 translator options (Google, DeepL, Azure, Gemini, OPUS-MT, Auto Rotation)
- Auto Rotation: Azure (2M) → Google (480K) → DeepL (500K) with quota tracking

### Mode B: E2E (Offline)
```
Mic → VAD → Whisper translate task → Subtitle
```
- JA→EN only (Whisper translate always outputs English)
- No internet required

### Streaming (Local Agreement)
```
During speech:  processStreaming() → interim result (confirmed + tentative text)
Speech ends:    finalizeStreaming() → final result (all text confirmed)
```
- Compares consecutive Whisper results to find stable (agreed-upon) text
- Only translates newly confirmed text to minimize API calls
- Word boundary snapping to avoid partial-word confirmation
- Interim results displayed in italic, final results in normal style

## Production Hardening

- **Memory monitoring**: Logs heap/RSS usage every 60 seconds during active sessions
- **Auto-recovery**: After 3 consecutive processing errors, reinitializes engines with 1s delay
- **Whisper hallucination filter**: Detects and filters repetitive patterns, known hallucination phrases (EN/JA), and extremely short text
- **Graceful degradation**: When translator fails, shows STT-only result instead of dropping the segment
- **IPC cleanup**: All IPC listeners return unsubscribe functions to prevent memory leaks on component unmount
- **Session duration**: Elapsed time displayed in settings panel during active sessions

## API Rotation Controller

Manages multiple translation providers with automatic fallback on quota exhaustion:

| Priority | Provider | Free Tier |
|----------|----------|-----------|
| 1 | Azure Microsoft Translator | 2M chars/month |
| 2 | Google Cloud Translation | 480K chars/month (safe cap) |
| 3 | DeepL | 500K chars/month |

- Tracks character usage per provider per month via electron-store
- Automatically switches to next provider when current one's quota is exhausted
- Resets counters on month change

## Adding a New Engine

1. Create a file in `src/engines/translator/` implementing `TranslatorEngine`
2. Register the factory in `src/main/index.ts` → `initPipeline()`
3. Add the engine option to `src/renderer/components/SettingsPanel.tsx`

## Distribution

- macOS arm64 .app file
- Python **not required** (pure Electron app)
- Whisper model (~540MB) auto-downloads on first launch
- No Apple Developer Program required (unsigned, for local use)

## System Requirements

| Item | Requirement |
|------|-------------|
| Mac | Apple Silicon (M1+) |
| RAM | 16GB+ recommended |
| Storage | 1GB free (for models) |
| macOS | 13 Ventura+ |
| Network | Online engines only |
