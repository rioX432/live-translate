# Live Translate

Real-time speech translation overlay for presentations and meetings.

Bidirectional JA↔EN translation with transparent subtitles overlaid on any display. Local-first, GPU-accelerated, free.

[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/rioX432/live-translate)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

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
- **Local-first** — Runs entirely offline with OPUS-MT or TranslateGemma 4B (GPU)
- **API rotation** — Combine free tiers of Google, DeepL, Azure, and Gemini (4M+ chars/month)
- **Subtitle overlay** — Transparent, always-on-top subtitles on any display
- **Customizable subtitles** — Font size, colors, opacity, position
- **Speaker diarization** — Speaker change detection with labels
- **Meeting summaries** — Generate summaries via local LLM after sessions
- **Multiple STT engines** — Whisper, mlx-whisper (Apple Silicon), Moonshine AI
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
- For online engines: API key(s) from Google / DeepL / Azure / Gemini

## Translation Engines

| Engine | Quality | Speed | Offline | Free Tier |
|--------|---------|-------|---------|-----------|
| **Auto Rotation** (recommended) | Best | Fast | No | 4M+ chars/month |
| TranslateGemma 4B | High | Medium | Yes | Unlimited |
| OPUS-MT | Good | Fast | Yes | Unlimited |
| Google Translate | High | Fast | No | 500K chars/month |
| DeepL | High | Fast | No | 500K chars/month |
| Gemini 2.5 Flash | High | Fast | No | Generous |

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
- **UtilityProcess**: TranslateGemma runs in isolated process (node-llama-cpp)
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
- **STT**: whisper.cpp, mlx-whisper, Moonshine AI
- **VAD**: Silero VAD (@ricky0123/vad-web)
- **Translation**: Google, DeepL, Azure, Gemini, OPUS-MT, TranslateGemma 4B
- **LLM**: node-llama-cpp (meeting summaries, context-aware translation)
- **Testing**: Vitest

## License

MIT
