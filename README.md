# Live Translate

Real-time speech translation overlay for presentations and meetings.

Bidirectional JA↔EN translation with transparent subtitles overlaid on any display. Local-first, GPU-accelerated, free.

[![CI](https://github.com/rioX432/live-translate/actions/workflows/ci.yml/badge.svg)](https://github.com/rioX432/live-translate/actions/workflows/ci.yml)
[![macOS](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/rioX432/live-translate)
[![Windows](https://img.shields.io/badge/platform-Windows-blue)](https://github.com/rioX432/live-translate)
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

## Why live-translate?

- **Free** — MIT-licensed, no subscription, no per-seat pricing. Bring your own (optional) cloud key.
- **Local-first** — Default pipeline runs entirely offline. Audio never leaves your machine unless you opt in to a cloud translator.
- **Optional Cloud Boost** — Plug in one Azure F0 key (2M chars/month free) and the rotation controller transparently flips to cloud quality when online, then falls back to the local engine when the quota is exhausted or the network drops.
- **JA↔EN focused** — Tuned for Japanese↔English meeting subtitles. We do not chase 40+ languages; instead we optimize the two we ship.
- **MIT, not AGPL** — Safe to use inside closed-source corporate environments without copyleft contamination.

See [docs/cloud-boost.md](docs/cloud-boost.md) for the Azure F0 setup that we recommend, and [docs/glossary.md](docs/glossary.md) for the term-dictionary feature.

## Comparison with alternatives

| Capability | live-translate | [Sokuji](https://github.com/kizuna-ai-lab/sokuji) | [Felo Subtitles](https://felo.ai/) | [DeepL Voice](https://www.deepl.com/en/products/voice) |
|---|---|---|---|---|
| License | **MIT** | AGPL-3.0 | Commercial / proprietary | Commercial / proprietary |
| Pricing | Free | Free (self-host) | Freemium (paid tiers) | Enterprise (≥50 seats) |
| Offline mode | **Yes (default)** | Partial (depends on provider) | No (cloud-only) | No (cloud-only) |
| JA↔EN focus | **Yes — tuned default** | No — 100+ languages, generalist | No — multilingual generalist | Yes (curated language pairs) |
| Recommended cloud | Azure F0 (1 key, 2M chars/mo) | 7 AI providers — bring your own | Hosted (no key needed) | DeepL hosted |
| Quota tracking & rotation | **Built in (#703)** | Manual per-provider | N/A (hosted) | N/A (hosted) |
| Glossary (CSV/JSON) | **Yes — personal + org** | No | No | Glossary (paid) |
| Speaker labels | **Yes (FluidAudio, macOS)** | No | No | No |
| Transparent overlay | **Yes (any display)** | App window | Browser extension only | App / meeting plugins |
| Closed-source environment safe | **Yes (MIT)** | Caution (AGPL copyleft) | Yes (commercial) | Yes (commercial) |

In short: Sokuji is the right pick if you need 40+ languages and don't mind AGPL; Felo and DeepL Voice are the right pick if you want a hosted subscription. live-translate is the right pick if you want a free, MIT-licensed, JA↔EN-tuned overlay that runs offline by default and only optionally borrows a free Azure key.

## Differentiating features

- **Glossary (CSV / JSON)** — Personal and organization-wide term dictionaries. Drop a CSV with `source,target` rows and brand names, product names, and acronyms stay consistent across every translation. Organization terms override personal terms on conflict. Details: [docs/glossary.md](docs/glossary.md).
- **Speaker labels (macOS)** — On-device speaker diarization via FluidAudio (CoreML). Each speaker gets a color-coded label on the overlay; ~32 MB of models, ~40 μs per chunk on Apple Silicon, no audio leaves the device.
- **API rotation with quota tracking** — `ApiRotationController` cycles through Azure → Google → DeepL → Gemini, persists monthly character counts, classifies 429 rate-limits separately from quota exhaustion, and falls back to the local engine when every cloud provider is out (#703).
- **Azure F0 single-provider recommendation** — Rather than asking every user to register four cloud accounts, we recommend the Azure Translator F0 tier (2M chars / month, one key) as the single optional boost. See [docs/cloud-boost.md](docs/cloud-boost.md) for the 5-minute walkthrough.
- **MDM-managed enterprise keys** — For organizations, a Microsoft Translator key + region can be pushed via macOS managed preferences (#704); users never touch the key. See [docs/mdm-config.md](docs/mdm-config.md).

## Features

- **Real-time translation** — Whisper STT + pluggable translation engines
- **Local-first** — Runs entirely offline with HY-MT1.5 1.8B (~180ms default), OPUS-MT (legacy fallback), or Hunyuan-MT 7B (quality mode)
- **API rotation** — Combine free tiers of Azure, Google, DeepL, and Gemini (4M+ chars/month)
- **Progressive onboarding** — Three-step wizard: Quick Start (Tier 1, ~371 MB) → Quality Upgrade (Tier 2, ~1.6 GB background) → optional Cloud Boost (Azure F0)
- **Adaptive routing** — Per-segment complexity scoring routes simple utterances to the fast engine and rare/long ones to the quality engine
- **Generative Error Correction (GER)** — Asynchronous SLM post-edit that fixes proper nouns, numbers, and glossary terms without blocking the streaming pipeline
- **Subtitle overlay** — Transparent, always-on-top subtitles on any display
- **Customizable subtitles** — Font size, colors, opacity, position
- **Translation cache** — LRU cache for repeated phrases, instant re-translation
- **Multiple STT engines** — Whisper Local (whisper.cpp), MLX Whisper (Apple Silicon), Kotoba-Whisper (JA-tuned), Qwen3-ASR, SenseVoice, Apple SpeechTranscriber (macOS 26+)
- **Streaming display** — Local Agreement algorithm for flicker-free interim results
- **GPU auto-detection** — Automatically selects best engine for your hardware
- **Global keyboard shortcuts** — Ctrl+Shift based shortcuts for overlay control
- **Accessibility** — High contrast mode, dyslexia-friendly font, letter/word spacing, WCAG compliance
- **Cross-platform** — macOS and Windows support with CI
- **Plugin system** — Extensible engine architecture with manifest-based plugins

## Quick Start

```bash
git clone https://github.com/rioX432/live-translate.git
cd live-translate
npm install
npm run dev
```

The default pipeline is fully offline — no keys, no signup. The first launch will download a Whisper STT model (~540 MB) and the HY-MT1.5 1.8B translator (~1 GB).

### Optional: add an Azure F0 key for cloud-quality translation

The Azure Translator **F0 (free) tier** gives you 2 million characters / month at no cost. One key is enough to make cloud translation the primary path while the local engine waits in the background as a fallback.

1. Create an Azure Translator resource on the **F0** pricing tier — see [docs/cloud-boost.md](docs/cloud-boost.md) for the 5-minute walkthrough.
2. In Settings → Translator, paste the key and region (e.g. `japaneast`).
3. Live Translate will route through Azure first, drop back to the offline engine automatically when the monthly quota is reached, and resume cloud usage at the start of the next month.

You can stack additional Google / DeepL / Gemini keys for ~4M+ characters/month combined, but a single Azure F0 key is the recommended starting point.

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

- macOS 13+ (Apple Silicon recommended) or Windows 10+ (CUDA recommended for GPU acceleration)
- Node.js 20+
- For online engines: API key(s) from Azure / Google / DeepL / Gemini

## STT Engines

| Engine | JA CER | EN WER | Latency | Notes |
|--------|--------|--------|---------|-------|
| **Whisper Local** | — | — | Fast | Native whisper.cpp, primary default |
| **MLX Whisper** | 8.1% | 3.8% | 2.9s | Apple Silicon optimized |

<details>
<summary>Experimental STT engines (hidden from UI)</summary>

| Engine | Notes |
|--------|-------|
| Apple SpeechTranscriber | macOS 26+ native, zero model management |
| Moonshine Tiny JA | Ultra-fast draft STT (JA CER 10.1%, 845ms) |
| Kotoba-Whisper v2.0 | JA-optimized Whisper variant |
| SpeechSwift | speech-swift CLI bridge |
| SenseVoice | Under evaluation |
| Qwen3-ASR | Under evaluation |
| Sherpa-ONNX | Under evaluation |

Removed: Lightning Whisper MLX (JA CER 162%), Moonshine base (JA CER 221%)
</details>

## Translation Engines

| Engine | JA→EN | EN→JA | Memory | Offline | Free Tier |
|--------|-------|-------|--------|---------|-----------|
| **HY-MT1.5 1.8B** (fast default) | ~180ms | ~180ms | ~1GB | Yes | Unlimited |
| **LFM2** (ultra-fast) | Fast | Fast | ~230MB | Yes | Unlimited |
| **Hunyuan-MT 7B** (quality) | 3.7s | 6.3s | 4GB | Yes | Unlimited |
| **Azure Translator** (cloud boost) | Fast | Fast | — | No | **2M chars/month (F0)** |
| **Google Translate** | Fast | Fast | — | No | 480K chars/month |
| **DeepL** | Fast | Fast | — | No | 500K chars/month |
| **Gemini 2.5 Flash** | Fast | Fast | — | No | Generous |
| **OPUS-MT** (legacy fallback) | 279ms | 462ms | 0.98GB | Yes | Unlimited |

> Conversational JA↔EN quality is benchmarked under [`benchmark/conversational-ja-en/`](benchmark/conversational-ja-en/) using **chrF** as a tractable stand-in for COMET-22 (the official Unbabel reference is PyTorch-only today). The chrF numbers will be swapped for COMET-22 scores once a stable Node.js ONNX inference path lands — see [#706](https://github.com/rioX432/live-translate/issues/706).

<details>
<summary>Experimental translation engines (hidden from UI)</summary>

| Engine | Notes |
|--------|-------|
| TranslateGemma | 8s/sentence — too slow for real-time |
| PLaMo | Under evaluation |
| CT2 OPUS-MT | CTranslate2 variant |
| CT2 Madlad-400 | CTranslate2, 450+ languages |
| ANE | Apple Neural Engine backend |
| Hybrid | Two-stage: OPUS-MT draft + LLM refinement |

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
- **STT**: whisper.cpp (native), MLX Whisper (Apple Silicon), Apple SpeechTranscriber (macOS 26+)
- **VAD**: Silero VAD (@ricky0123/vad-web)
- **Translation**: HY-MT1.5 1.8B (fast default), LFM2 (ultra-fast), Hunyuan-MT 7B (quality), OPUS-MT (legacy fallback), Azure, Google, DeepL, Gemini
- **LLM**: node-llama-cpp (meeting summaries, context-aware translation)
- **Testing**: Vitest

## Further reading

- [docs/cloud-boost.md](docs/cloud-boost.md) — Azure F0 key acquisition and ApiRotation setup
- [docs/glossary.md](docs/glossary.md) — Personal and organization glossary usage
- [docs/mdm-config.md](docs/mdm-config.md) — Enterprise MDM-managed configuration
- [docs/RESEARCH.md](docs/RESEARCH.md) — Market and technology research
- [benchmark/conversational-ja-en/README.md](benchmark/conversational-ja-en/README.md) — Conversational JA↔EN benchmark
- [ARCHITECTURE.md](ARCHITECTURE.md) — System diagram, directory layout, IPC channels

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the list of changes since the last release.

## Security

For security issues, see [SECURITY.md](SECURITY.md). Please do not file public Issues for vulnerabilities.

## License

MIT
