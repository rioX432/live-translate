# Real-time translation tool — technology & market research

Updated: 2026-06

## Purpose

Display real-time bidirectional Japanese↔English subtitles on a Mac extended
display during presentations, so the audience can follow regardless of which
language the speaker is using. Transcript logging is required. The tool must
run on a personal laptop, not a corporate seat license.

## Requirements

- Bidirectional Japanese↔English translation (end-to-end latency target: <2s)
- Automatic language detection / switching as speakers alternate
- Transparent subtitle overlay on a Mac extended display (over slides)
- Business-meeting quality translation
- Transcript saved locally
- Minimal cost (ideally free)

---

## Why this project (positioning vs. the 2026 alternatives)

| Project / product | License | Cost | Focus | Offline default | Why we still ship our own |
|---|---|---|---|---|---|
| **[Sokuji](https://github.com/kizuna-ai-lab/sokuji)** | AGPL-3.0 | Free (self-host) | 40+ languages, 7 AI providers | Partial (provider-dependent) | AGPL copyleft is a non-starter for some closed-source corporate users; UX is generalist, not JA↔EN-tuned. |
| **[Felo Subtitles](https://felo.ai/)** | Commercial | Freemium / subscription | Browser extension, hosted | No (cloud-only) | Cloud-only; sends audio to a third party; pricing scales per user. |
| **[DeepL Voice](https://www.deepl.com/en/products/voice)** | Commercial | Enterprise (≥50 seats) | Curated language pairs, hosted | No (cloud-only) | Seat-license minimum locks out individuals and small teams. |
| **live-translate (this project)** | **MIT** | **Free** | **JA↔EN, overlay-first** | **Yes (default)** | Free, MIT, runs offline by default, with an *optional* Azure F0 cloud boost on top. |

The differentiator is **(MIT) × (local-first) × (JA↔EN tuned)**. We do not
chase the multilingual frontier; we chase the two languages our core users
actually speak and let the cloud be an opt-in accelerator.

---

## 1. Existing tools (2026-06 snapshot)

### Video-conferencing platforms

| Tool | Translation feature | Japanese | Price | Notes |
|---|---|---|---|---|
| Google Meet caption translation | 69-language caption translation | Yes | Business Standard+ with Gemini add-on | Gemini add-on required since 2025-01 |
| Google Meet voice translation | 6-language voice translation | No | Business Plus+ | Japanese still unsupported |
| MS Teams AI Interpreter | 9-language simultaneous voice interpretation | Yes | Copilot (≈¥4,500/user/month) | Costly per seat |
| Zoom translated captions | 35-language captions | Yes | ~¥750/user/month add-on | Cheapest of the platform options |

### Dedicated translation tools

| Tool | Price | Japanese | Notes |
|---|---|---|---|
| Sentio (Pocketalk) | ~¥3,300/month for 500 users | Yes | Best price/performance, free 30 min/month tier |
| VoicePing | Free → ¥20,000/month | Yes | Japanese vendor, Whisper V2-based |
| DeepL Voice | ≥50 seats | Yes | Top translation quality, enterprise-only |
| Felo Subtitles (Chrome ext.) | Free / paid tiers | Yes | Hosted; useful for quick demos |

### Chrome extensions (Google Meet)

| Extension | Notes | Risk |
|---|---|---|
| Felo Subtitles | Real-time translation, free tier | DOM scraping; breaks on Meet UI changes |
| JotMe | 77 languages, meeting notes | Same DOM-scraping fragility |
| ELI | Unlimited free | Google Meet only |

---

## 2. Speech-to-text (STT) options

### Cloud APIs

| Service | Latency | JA accuracy | Price (/min) | Streaming | Code-switching |
|---|---|---|---|---|---|
| Google Cloud STT | ~300 ms | High (CER 2.7%) | $0.024 | Yes | Up to 3 languages |
| Deepgram Nova-3 | <300 ms | Medium-high | $0.0043 | Yes | **Native 10-language multilingual** |
| Azure Speech | ~300 ms | High | $0.017 | Yes | Limited |
| OpenAI Whisper API | Batch only | High | $0.006 | No | No |

### Local models

| Model | Speed | JA accuracy | Cost | Notes |
|---|---|---|---|---|
| **Kotoba-Whisper v2.0** | 6.3× large-v3 | Best (JA-specialized) | ¥0 | Cannot handle EN code-switch |
| **MLX Whisper** | Apple Silicon-tuned | JA CER 8.1% / EN WER 3.8% | ¥0 | ~2.9 s per chunk |
| **Apple SpeechTranscriber** | Native, macOS 26+ | High | ¥0 | Zero-setup, ANE-native |
| **whisper.cpp (Whisper Local)** | ~2 s / chunk | ≥90% | ¥0 | Cross-platform default |
| Lightning Whisper MLX | — | **CER 162% — removed** | — | Failed JA benchmark |
| Moonshine base | — | **CER 221% — removed** | — | Failed JA benchmark |
| Moonshine Tiny JA | 845 ms | CER 10.1% | ¥0 | Improved variant; experimental |

### Web Speech API (rejected)

- 60-second hard timeout, drops after 7s of silence.
- Prior art is "barely working".
- Audio is sent to Google (privacy concern).
- Not production-grade.

---

## 3. Translation options

### Translation APIs

| Service | JA↔EN quality | Short-sentence accuracy | Latency | Free tier | Real-time fit |
|---|---|---|---|---|---|
| **Azure Translator (F0)** | High | Good | <300 ms | **2 M chars/month** | ★★★ — **recommended single-key boost** |
| Google Translation | High | Good | 100-300 ms | 480 K chars/month | ★★★ |
| DeepL API Free | Top | Slightly weaker on short utterances | ms | 500 K chars/month (≤600 chars/min) | ★★ |
| GPT-4o / Claude | Top | Good | seconds | None | ★ |
| Gemini 2.5 Flash | High | Good | Sub-second | Generous | ★★★ |

> Real-time translation runs many short utterances back to back, so
> **short-sentence accuracy and latency** dominate. DeepL is optimized for
> long-form text and can mis-translate short utterances; Azure F0 and Google
> are both strong on short input.
>
> live-translate's `ApiRotationController` rotates **Azure → Google → DeepL →
> Gemini → local fallback** when more than one key is configured. The local
> fallback was added in [#703](https://github.com/rioX432/live-translate/issues/703)
> so that exhausting every cloud key never breaks the overlay.

### Local translation models

| Model | Quality | Cost | Notes |
|---|---|---|---|
| **HY-MT1.5 1.8B** | High | ¥0 | ~180 ms / sentence; **current default** (replaces OPUS-MT, #544) |
| **LFM2** | Medium-high | ¥0 | ~230 MB, ultra-fast |
| **Hunyuan-MT 7B** | Highest local | ¥0 | 3.7-6.3 s / sentence; quality mode only |
| OPUS-MT | Medium | ¥0 | 279-462 ms; legacy fallback for low-memory systems |
| M2M100 | Medium | ¥0 | LocalVocal-style |
| PLaMo | — | ¥0 | Under evaluation; removed from adaptive routing (#705) |

### Translation benchmark (2026-06)

We added a conversational JA↔EN benchmark in
[#706](https://github.com/rioX432/live-translate/issues/706) under
[`benchmark/conversational-ja-en/`](../benchmark/conversational-ja-en/). The
dataset is 25 representative meeting utterances (15 JA, 10 EN). The metric
is **chrF** (sacreBLEU defaults: n=6, β=2) — used as a tractable stand-in
for COMET-22, because the official Unbabel implementation is PyTorch-only
today and no battle-tested Node.js ONNX path exists yet. The TODO to swap
in COMET-22 is recorded in `benchmark/conversational-ja-en/metrics.ts` and
referenced by issue #706.

---

## 4. Japanese↔English auto language switching

### Approach comparison

| Approach | Mechanism | Accuracy | Cost |
|---|---|---|---|
| **VoicePing whisper-ja-en** | VAD split → language detect → bi-directional translation | High | ¥0 |
| **Deepgram Nova-3 multi** | Unified multilingual model | Highest | $26/month |
| Whisper VAD split | Run `detect_language()` per segment | Medium | ¥0 |
| Google STT multi | Specify up to 3 languages | Medium-high | Paid |

### Whisper limitations

- The 30-second language probe runs once; per-segment switching is not a
  built-in feature.
- Kotoba-Whisper is JA-specialized and degrades on English.
- Workaround: VAD-segment → `detect_language()` → re-decode with the
  detected language.

---

## 5. Mac subtitle overlay

### Use case

```
Presenter Mac → HDMI / extended display → projector
Primary display:  presenter notes / controls
Extended display: slides + subtitle overlay (audience view)
```

### Implementation options

| Approach | Transparent window | Stability | Effort |
|---|---|---|---|
| **Electron** | Yes (transparent + frameless) | High | Low |
| SwiftUI + AppKit | Yes | Highest | Medium |
| Tauri v2 | Partial (bugs reported) | Medium | Low |

### Reference OSS

| Project | Notes | Tech |
|---|---|---|
| **[Sokuji](https://github.com/kizuna-ai-lab/sokuji)** | Most polished Electron translator (AGPL) | Electron + React, 7 AI providers |
| [electron-speech-to-speech](https://github.com/Kutalia/electron-speech-to-speech) | 100% local | Whisper WebGPU + VITS |
| [OBS LocalVocal](https://github.com/royshil/obs-localvocal) | OBS subtitle plugin | whisper.cpp + M2M100 |

---

## 6. Architecture decision

We adopted **Whisper STT + (HY-MT1.5 local | Azure F0 cloud boost)** for the
following reasons:

- HY-MT1.5 1.8B is ~180 ms per sentence on Apple Silicon — the best
  latency/quality trade-off for a fully-offline default.
- Azure F0 gives us a single optional cloud key with the largest free
  quota (2 M chars/month) — bigger than Google or DeepL Free combined.
- `ApiRotationController` provides a graceful local fallback when the
  cloud quota is gone or the network is down (#703).
- Electron lets us reuse the existing subtitle overlay and the cross-platform
  CI without rewriting in Swift.

This supersedes the 2026-03 recommendation of "VoicePing-only" — VoicePing
remains a viable alternative but is not the default because HY-MT1.5
benchmarks better on the conversational dataset (#706) and is easier to
upgrade in a Node.js pipeline.

---

## 7. Cost comparison

| Configuration | STT | Translation | Monthly cost |
|---|---|---|---|
| **A: HY-MT1.5 local only** | ¥0 | ¥0 | **¥0** |
| **B: HY-MT1.5 + Azure F0 boost** | ¥0 | ¥0 (≤2 M chars) | **¥0** |
| B (over Azure F0 quota) | ¥0 | local fallback or ~$10/M chars | ¥0 (fallback) or ~$10-20 |
| C: Stacked rotation (Azure + Google + DeepL + Gemini) | ¥0 | ¥0 (≤4 M chars combined) | **¥0** |
| Ref: Deepgram + DeepL Pro | $26/month | $5.49 + usage | **~$40-60** |

---

## 8. Open items

- **COMET-22 swap-in** — Replace chrF in
  `benchmark/conversational-ja-en/metrics.ts` once a stable Node.js ONNX
  COMET inference path exists. Tracked via the TODO in that file and #706.
- **PLaMo re-evaluation** — Removed from adaptive routing (#705); revisit
  when a smaller / faster checkpoint lands.
- **GPT-Realtime + Whisper** — Evaluate as a future STT path (#698).

---

## References

### OSS

- [Sokuji](https://github.com/kizuna-ai-lab/sokuji) — Electron translator
- [VoicePing whisper-ja-en](https://github.com/voiceping-ai/whisper-ja-en-speech-translation) — JA↔EN bi-directional model
- [OBS LocalVocal](https://github.com/royshil/obs-localvocal) — OBS subtitle plugin
- [whisper-node-addon](https://github.com/Kutalia/whisper-node-addon) — Electron Whisper native addon
- [Lightning Whisper MLX](https://github.com/mustafaaljadery/lightning-whisper-mlx) — Apple Silicon-tuned (failed JA benchmark)
- [Kotoba-Whisper v2.0](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0) — JA-specialized Whisper
- [WhisperLive](https://github.com/collabora/WhisperLive) — Real-time Whisper

### Commercial

- [Azure Translator pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/translator/)
- [Google Cloud Translation](https://cloud.google.com/translate)
- [DeepL API](https://www.deepl.com/pro-api)
- [Deepgram Nova-3](https://deepgram.com/)
