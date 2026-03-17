# live-translate

Real-time speech translation overlay for presentations.

Displays bilingual subtitles over slides on an external display during live presentations on macOS.

## Features

- **Real-time speech recognition** — Local STT via Whisper (whisper.cpp)
- **Bidirectional JA↔EN translation** — Auto-detects language and translates both directions
- **Transparent subtitle overlay** — Rendered on top of slides on an external display
- **Streaming display** — Local Agreement algorithm shows subtitles while still speaking
- **Pluggable engines** — Strategy pattern allows swapping translation engines
- **API auto-rotation** — Automatically rotates across multiple translation APIs' free tiers (up to 3M chars/month)
- **Production stability** — Auto-recovery, hallucination filter, memory monitoring
- **Transcript logging** — Timestamped session logs saved automatically
- **Free** — Runs on API free tiers + local models at ¥0/month

## Translation Engines

| Mode | STT | Translation | Offline | Free Tier |
|------|-----|-------------|---------|-----------|
| **Auto Rotation (recommended)** | Whisper local | Azure → Google → DeepL | ✗ | 3M chars/month |
| **Online — Google** | Whisper local | Google Cloud Translation | ✗ | 500K chars/month |
| **Online — DeepL** | Whisper local | DeepL API | ✗ | 500K chars/month |
| **Online — Gemini** | Whisper local | Gemini 2.5 Flash | ✗ | Generous free tier |
| **Offline — OPUS-MT** | Whisper local | OPUS-MT (Hugging Face) | ✅ | Unlimited |
| **Offline — Whisper** | Whisper local | Whisper translate task | ✅ | Unlimited (JA→EN only) |

Engines are swappable via the settings panel. New engines can be added by implementing the `TranslatorEngine` interface.

## Requirements

- macOS 13+ (Ventura or later)
- Apple Silicon (M1 or later)
- 16GB RAM recommended
- API key for online engines (Google / DeepL / Azure — at least one)

## Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Package as .app
npm run package
```

## Usage

1. Launch the app
2. Select your microphone
3. Choose translation engine (Auto Rotation recommended)
4. Enter API key(s) if using online engines
5. Select the display for subtitle overlay
6. Click **Start**
7. Present your slides — subtitles appear automatically on the external display

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

Session duration is displayed in the settings panel while running.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical design.

### Plugin System

Adding a new translation engine requires a single file:

```typescript
// src/engines/translator/MyTranslator.ts
import type { TranslatorEngine, Language } from '../types'

export class MyTranslator implements TranslatorEngine {
  readonly id = 'my-translator'
  readonly name = 'My Translator'
  readonly isOffline = false

  async initialize() { /* setup */ }
  async translate(text: string, from: Language, to: Language) { /* translate */ }
  async dispose() { /* cleanup */ }
}
```

## Tech Stack

- **Framework**: Electron + React + TypeScript
- **Build**: electron-vite
- **STT**: whisper-node-addon (whisper.cpp native binding)
- **VAD**: @ricky0123/vad-web (Silero VAD)
- **Translation**: Google / DeepL / Azure / Gemini / OPUS-MT / Whisper translate
- **Streaming**: Local Agreement algorithm for low-latency subtitle display
- **No Python required**

## License

MIT
