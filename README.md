# Live Translate

Real-time speech translation overlay for presentations and meetings.

Bidirectional JA↔EN translation with transparent subtitles overlaid on any display. Local-first, GPU-accelerated, free.

[![CI](https://github.com/rioX432/live-translate/actions/workflows/ci.yml/badge.svg)](https://github.com/rioX432/live-translate/actions/workflows/ci.yml)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/rioX432/live-translate)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

<!-- TODO: Add demo GIF here -->
<!-- ![Demo](docs/demo.gif) -->

```
┌────────────────────────────────────────┐
│            Your Slides                 │
│                                        │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ 今日の売上について説明します       │ │
│ │ I'll explain about today's sales   │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

## Features

- **Real-time translation** — Whisper STT + pluggable translation engines
- **Local-first** — Runs entirely offline with OPUS-MT (279ms) or Hunyuan-MT 7B (quality mode)
- **API rotation** — Combine free tiers of Google, DeepL, and Gemini (4M+ chars/month)
- **Subtitle overlay** — Transparent, always-on-top subtitles on any display
- **Customizable subtitles** — Font size, colors, opacity, position
- **Speaker diarization** — Speaker change detection with labels
- **Meeting summaries** — Generate summaries via local LLM after sessions
- **Multiple STT engines** — Whisper Local (whisper.cpp), MLX Whisper (Apple Silicon optimized)
- **Streaming display** — Local Agreement algorithm for flicker-free interim results
- **GPU auto-detection** — Automatically selects best engine for your hardware
- **Plugin system** — Extensible engine architecture with manifest-based plugins

## Quick Start

```bash
git clone https://github.com/rioX432/live-translate.git
cd live-translate
npm install
npm run dev
```

## Build & Distribute

```bash
npm run build        # Build for production
npm run package:dmg  # Build macOS DMG installer
npm run test         # Run unit tests
```

### Installing the DMG

1. Open `dist/Live Translate-x.x.x-arm64.dmg`
2. Drag the app to Applications
3. First launch: right-click the app > Open (bypasses Gatekeeper since the app is not code-signed)
4. Grant microphone permission when prompted

## Requirements

- macOS 13+ (Apple Silicon recommended)
- Node.js 20+
- For online engines: API key(s) from Google / DeepL / Gemini

## STT Engines

| Engine | JA CER | EN WER | Latency | Notes |
|--------|--------|--------|---------|-------|
| **Whisper Local** | — | — | Fast | Native whisper.cpp, primary default |
| **MLX Whisper** | 8.1% | 3.8% | 2.9s | Apple Silicon optimized |

<details>
<summary>Experimental STT engines (hidden from UI)</summary>

| Engine | Notes |
|--------|-------|
| SenseVoice | Under evaluation |
| Qwen3-ASR | Under evaluation |
| Sherpa-ONNX | Under evaluation |

Removed: Lightning Whisper MLX (JA CER 162%), Moonshine (JA CER 221%)
</details>

## Translation Engines

| Engine | JA→EN | EN→JA | Memory | Offline | Free Tier |
|--------|-------|-------|--------|---------|-----------|
| **OPUS-MT** (fast default) | 279ms | 462ms | 0.98GB | Yes | Unlimited |
| **Hunyuan-MT 7B** (quality) | 3.7s | 6.3s | 4GB | Yes | Unlimited |
| **Google Translate** | Fast | Fast | — | No | 500K chars/month |
| **DeepL** | Fast | Fast | — | No | 500K chars/month |
| **Gemini 2.5 Flash** | Fast | Fast | — | No | Generous |

<details>
<summary>Experimental translation engines (hidden from UI)</summary>

| Engine | Notes |
|--------|-------|
| TranslateGemma | 8s/sentence — too slow for real-time |
| HY-MT1.5 | Under evaluation |
| CT2 OPUS-MT | CTranslate2 variant |
| CT2 Madlad-400 | CTranslate2, 450+ languages |
| ANE | Apple Neural Engine backend |

Removed: ALMA-Ja, Gemma-2-JPN
</details>

## Usage

1. Launch the app
2. Select microphone (or virtual audio device for Zoom/Teams)
3. Choose translation engine (Auto recommended)
4. Enter API key(s) if using online engines
5. Select subtitle display
6. Click **Start** — subtitles appear automatically

## Architecture

```
Microphone → Silero VAD → STT Engine → Translator → Subtitle Overlay
                                    ↘ TranscriptLogger → Session Manager
```

- **Cascade mode**: Independent STT + Translator engines
- **Streaming**: Local Agreement algorithm for stable interim display
- **UtilityProcess**: Local LLM engines run in isolated process (node-llama-cpp)
- **Plugin system**: Drop-in engine plugins via manifest files

### Adding a Translation Engine

```typescript
import type { TranslatorEngine, Language } from '../types'

export class MyTranslator implements TranslatorEngine {
  readonly id = 'my-translator'
  readonly name = 'My Translator'
  readonly isOffline = false

  async initialize() { /* setup */ }
  async translate(text: string, from: Language, to: Language) { return '...' }
  async dispose() { /* cleanup */ }
}
```

## Tech Stack

- **Framework**: Electron + React + TypeScript
- **Build**: electron-vite
- **STT**: whisper.cpp (native), MLX Whisper (Apple Silicon)
- **VAD**: Silero VAD (@ricky0123/vad-web)
- **Translation**: OPUS-MT (fast), Hunyuan-MT 7B (quality), Google, DeepL, Gemini
- **LLM**: node-llama-cpp (meeting summaries, context-aware translation)
- **Testing**: Vitest

## License

MIT
