# live-translate

Real-time speech translation overlay for presentations.

Mac のプレゼン発表中に、拡張ディスプレイ上のスライドに重ねてリアルタイム翻訳字幕を表示する社内ツール。

## Features

- 🎤 **リアルタイム音声認識** — Whisper (whisper.cpp) によるローカル STT
- 🌐 **日英双方向翻訳** — 日本語 → 英語、英語 → 日本語を自動検出・自動切替
- 🖥️ **透過字幕オーバーレイ** — スライドに重ねて表示。拡張ディスプレイ対応
- 🔌 **エンジン差し替え可能** — Strategy パターンで翻訳エンジンをプラグイン式に切替
- 📝 **文字起こしログ保存** — セッションごとにタイムスタンプ付きログを自動保存
- 💰 **無料** — API 無料枠 + ローカルモデルで月額 ¥0

## Translation Engines

| Mode | STT | Translation | Offline | Quality |
|------|-----|-------------|---------|---------|
| **Online (recommended)** | Whisper local | Google Cloud Translation | ✗ | High |
| **Offline** | Whisper local | Whisper translate task | ✅ | Medium (JA→EN only) |

Engines are swappable via the settings panel. New engines can be added by implementing the `TranslatorEngine` interface.

## Requirements

- macOS 13+ (Ventura or later)
- Apple Silicon (M1 or later)
- 16GB RAM recommended
- Google Cloud Translation API Key (for online mode)

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
3. Choose translation engine (Online recommended)
4. Select the display for subtitle overlay
5. Click **Start**
6. Present your slides — subtitles appear automatically on the external display

```
┌────────────────────────────────────────┐
│            Your Slides                 │
│                                        │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ 🟢 今日の売上について説明します     │ │
│ │ 🔵 I'll explain about today's sales│ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

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
- **Translation**: Google Cloud Translation API v2 / Whisper translate task
- **No Python required**

## License

Private — Internal use only
