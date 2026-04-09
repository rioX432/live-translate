# Voice Cloning / Speech-to-Speech Translation Research

**Issue:** #588
**Date:** 2026-04-09
**Status:** Research complete — cloud API (Cartesia Sonic-3) recommended for near-term prototype; local CosyVoice2-0.5B for offline mode

## 1. Summary

Google Meet (Feb 2026) and Zoom AI Companion 3.0 (Dec 2025) have both shipped voice-preserving speech translation, validating this as the next table-stakes feature for meeting translation tools. The current live-translate pipeline uses Kokoro TTS for speech output but without voice identity preservation. Adding voice cloning requires a speaker enrollment step (2–5 seconds of audio) and a TTS backend that accepts a voice reference. The hard constraint is **<200ms added latency** on top of the existing STT+MT pipeline.

## 2. Competitive Landscape

### 2.1 Google Meet Speech Translation (GA: Feb 2026)

- **Approach:** Dubbed audio overlay over original speech; voice timbre preserved to help listeners identify speakers
- **Languages:** English ↔ Spanish, French, German, Portuguese, Italian (bidirectional pairs, one pair per meeting)
- **Latency in practice:** ~10 seconds end-to-end (informal testing by Slator); not suitable as a latency benchmark for local tools
- **Privacy:** No audio is saved; no models are trained on user voice
- **Availability:** Google Workspace paid plans only
- **Takeaway:** Validates the UX direction; latency is too high for real-time overlay use, confirming that local/edge solutions are necessary

### 2.2 Zoom Speech-to-Speech (AI Companion 3.0, Dec 2025)

- **Approach:** Real-time voice translation built into Zoom Meetings; includes lifelike AI avatars for async video messages in multiple languages
- **Voice cloning specifics:** Not confirmed as true speaker-voice cloning; focuses on real-time TTS translation rather than identity preservation
- **Availability:** Eligible paid Zoom Workplace plans; regional/vertical restrictions apply
- **Takeaway:** Feature parity pressure is real, but their implementation appears to use speaker-agnostic TTS rather than true voice banking

## 3. Technology Comparison

### 3.1 Cloud TTS with Voice Cloning

| Service | TTFA | Voice Clone Input | Languages | Pricing (API) | Offline |
|---------|------|-------------------|-----------|---------------|---------|
| Cartesia Sonic-3 Turbo | **40ms** | 3s audio | 15+ | ~$0.03/min | No |
| Cartesia Sonic-3 Standard | **90ms** | 3s audio | 15+ | ~$0.03/min | No |
| ElevenLabs Flash v2.5 | **75ms** | 1–3s audio | 32 | $0.06/1K chars | No |
| ElevenLabs Turbo v2.5 | **250–300ms** | 1–3s audio | 32 | $0.06/1K chars | No |

**Cartesia Sonic-3** is the clear frontrunner for latency-critical applications:
- Sonic Turbo: 40ms TTFA; Sonic Standard: 90ms TTFA — both well within the 200ms budget
- Instant Voice Cloning from a 3-second reference clip; Pro Voice Cloning available with one-time training fee
- Streaming WebSocket API (real-time chunk delivery)
- 15+ languages including Japanese and English (confirmed use-case for live-translate)
- Pricing: ~$0.03/min usage-based; no per-voice-clone fee for instant cloning

### 3.2 Open-Source / Local Engines

| Engine | TTFA (streaming) | Voice Clone Input | Params | Languages | License |
|--------|-----------------|-------------------|--------|-----------|---------|
| CosyVoice2-0.5B | **150ms** | 3s audio | 0.5B | Multilingual (JA, EN, ZH, …) | Apache-2.0 |
| Kokoro + KokoClone | **40–70ms (GPU)** | Short clip | 82M | EN, JA, FR, KO, ZH | Apache-2.0 |
| F5-TTS | ~500ms (no stream) | 3–6s audio | ~330M | EN, ZH (multilingual expanding) | MIT |
| FlashLabs Chroma 1.0 | **135–150ms** | 3–5s audio | — | Multilingual | Open-source |
| XTTS-v2 (Coqui) | **<200ms** | 3–10s audio | — | 16 languages (incl. JA) | MPL-2.0 |

**CosyVoice2-0.5B** is the strongest local candidate:
- 150ms streaming latency on edge hardware; 0.5B parameters (~1GB model)
- Zero-shot voice cloning from 3-second clip; cross-lingual voice preservation
- Apache-2.0 license; active maintenance by Alibaba FunAudioLLM group
- Python inference required — needs UtilityProcess bridge (same pattern as existing SLM worker)

**KokoClone** (Kokoro-ONNX + voice cloning) is attractive because Kokoro is already integrated:
- Extends the existing Kokoro engine rather than adding a new stack
- 40–70ms on GPU; ONNX runtime enables CPU fallback without Python
- Limited to languages Kokoro supports (EN, JA, FR, KO, ZH) — sufficient for primary use cases
- Less mature voice cloning quality vs. CosyVoice2

**Note on Coqui TTS / XTTS-v2:** Coqui AI company closed in Dec 2025; the OSS library (coqui-tts on PyPI) continues as a community fork but is no longer actively maintained by original authors. Not recommended for new integrations.

### 3.3 Meta SeamlessExpressive

- **Architecture:** Prosody-aware UnitY2 (speech-to-unit translation) + PRETSSEL (unit-to-speech with cross-lingual expressivity)
- **What it preserves:** Speech rate, pauses, vocal style, emotional tone across translation
- **Languages:** Only 6 — English, French, Spanish, German, Mandarin, Italian (no Japanese)
- **Open-source:** Yes — Apache-2.0 on GitHub (`facebookresearch/seamless_communication`); available on Hugging Face (`facebook/seamless-expressive`)
- **Latency:** Not optimized for real-time streaming; designed for offline/batch translation
- **Verdict:** Japanese is out of scope; not viable for live-translate's JA↔EN primary use case

### 3.4 MARS-Flash

- **Claimed:** Sub-150ms voice cloning latency; MARS8 model supports 2-second voice enrollment with 0.87 speaker similarity
- **Reality check:** Marketing claims; no peer-reviewed benchmark found. FlashLabs Chroma 1.0 (open-source, Jan 2026) appears to be the actual deliverable from this team — 135–150ms end-to-end, 3–5s reference audio, Apache-2.0
- **Verdict:** Track Chroma 1.0 rather than MARS-Flash branding; evaluate once ONNX export is available

## 4. Voice Banking Feasibility (2–5 Seconds of Audio)

Current zero-shot TTS models (2025–2026) have made 3-second enrollment the practical minimum:

- **2 seconds:** Marginal; some models (MARS8, Chroma) claim support but quality degrades below 3s
- **3 seconds:** Reliable baseline for most cloud and local engines (Cartesia, CosyVoice2, KokoClone)
- **5–10 seconds:** Noticeably better speaker similarity; recommended for quality mode
- **Speaker similarity scores at 3s:** ~0.85–0.87 cosine similarity (MARS8); XTTS-v2 reports 85–95% similarity at 10s

**Implementation approach for live-translate:**
1. Capture first 5 seconds of each speaker's audio automatically at session start
2. Enroll voice once per session (no repeated API calls)
3. Store enrollment ID/embedding in session memory; clear on session end
4. Allow manual re-enrollment if speaker changes (e.g., presenter hand-off)

## 5. Latency Budget Analysis

Current pipeline budget (STT + MT + output):
- STT (Whisper Turbo / MLX): ~300–500ms
- Translation (HY-MT1.5-1.8B fast default): ~180ms
- Audio playback scheduling: ~20ms
- **Subtotal before TTS:** ~500–700ms

Voice cloning TTS options within 200ms budget:
| Option | Added Latency | Total Pipeline | Feasible? |
|--------|--------------|----------------|-----------|
| Cartesia Sonic-3 Turbo (cloud) | ~40ms + network | ~560–760ms | Yes (if network <50ms) |
| Cartesia Sonic-3 Standard (cloud) | ~90ms + network | ~610–810ms | Yes (if network <50ms) |
| ElevenLabs Flash v2.5 (cloud) | ~75ms + network | ~595–795ms | Yes (if network <50ms) |
| CosyVoice2-0.5B (local) | ~150ms | ~650–850ms | Yes |
| KokoClone ONNX (local GPU) | ~40–70ms | ~560–590ms | Yes |
| KokoClone ONNX (local CPU) | ~200–300ms | ~700–1000ms | Marginal |
| SeamlessExpressive (local) | 1–3s | >2000ms | No |

All cloud options depend on network latency. On a typical office network with <30ms RTT to Cartesia's CDN edge, total pipeline stays under 800ms — perceptually acceptable for meeting overlay use.

## 6. Integration Architecture (Electron)

### 6.1 Cloud Path (Cartesia Sonic-3)

```
Renderer (AudioWorklet) → IPC → Main → TranslationPipeline
  → HY-MT1.5-1.8B (translation)
  → CartesiaVoiceCloneEngine (new)
      → POST /voices/clone (enrollment, once per session)
      → WebSocket /tts/streaming (per utterance)
  → Speaker → AudioOutput (renderer)
```

- Add `CartesiaVoiceCloneEngine.ts` in `src/engines/tts/`
- Implement `TTSEngine` interface (new interface needed alongside existing TTS-less pipeline)
- API key stored via electron-store (encrypted, existing pattern)
- WebSocket streaming: send text chunks as translation arrives, pipe audio chunks to renderer via IPC

### 6.2 Local Path (CosyVoice2-0.5B)

```
UtilityProcess (cosyvoice-worker.ts)  ←→  Python subprocess (CosyVoice2 inference server)
  → REST on localhost:port
  → Main process TTS engine wrapper
```

- Follows existing `slm-worker.ts` / UtilityProcess pattern
- Python subprocess managed by the worker; auto-download model on first use
- ~1GB model stored in `userData/models/cosyvoice/`
- Requires Python environment (bundled or system) — adds complexity

### 6.3 Hybrid (Recommended)

- Default: Cartesia Sonic-3 cloud (low setup friction, best latency)
- Offline fallback: KokoClone ONNX (extends existing Kokoro engine, no Python needed)
- Quality mode: CosyVoice2-0.5B local (opt-in, requires model download)
- UI: "Voice Preservation" toggle in SettingsPanel; show enrollment status indicator
- Experimental flag: hide from non-experimental UI until quality validated

## 7. Recommendation

**Phase 1 (prototype):** Integrate Cartesia Sonic-3 as a new experimental TTS engine
- Fastest path to working demo; validates the UX with real users
- Cartesia offers free tier for evaluation; no upfront cost
- Implement `CartesiaVoiceCloneEngine.ts` behind experimental flag

**Phase 2 (offline/quality):** Add KokoClone ONNX as local fallback
- Extends existing Kokoro integration; no new runtime dependencies
- JA + EN coverage sufficient for primary use cases
- Makes the feature available without API key

**Phase 3 (quality mode):** Evaluate CosyVoice2-0.5B or Chroma 1.0 once ONNX exports mature
- Better multilingual quality and speaker similarity
- Gate behind optional model download (~1GB)

**Not recommended at this time:**
- SeamlessExpressive: no Japanese support
- XTTS-v2 / Coqui: company closed, community fork only
- TranslateGemma path: 8s/sentence (existing CLAUDE.md note confirms this)

## 8. References

- [Cartesia Sonic-3 docs](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest)
- [Cartesia pricing](https://cartesia.ai/pricing)
- [CosyVoice2-0.5B (HuggingFace)](https://huggingface.co/FunAudioLLM/CosyVoice2-0.5B)
- [FlashLabs Chroma 1.0 paper](https://arxiv.org/abs/2601.11141)
- [Meta SeamlessExpressive (HuggingFace)](https://huggingface.co/facebook/seamless-expressive)
- [facebookresearch/seamless_communication (GitHub)](https://github.com/facebookresearch/seamless_communication)
- [Google Meet speech translation GA (Feb 2026)](https://workspaceupdates.googleblog.com/2026/02/speech-translation-meet-ga.html)
- [How Google built real-time translation for Meet](https://blog.google/products-and-platforms/products/workspace/google-meet-langauge-translation-ai/)
- [Zoom AI Companion 3.0 / Zoomtopia 2025](https://news.zoom.com/zoomtopia2025/)
- [Best voice cloning models for edge deployment 2026](https://www.siliconflow.com/articles/en/best-voice-cloning-models-for-edge-deployment)
- [ElevenLabs Flash v2.5 latency](https://elevenlabs.io/docs/overview/capabilities/text-to-speech)
- [KokoClone GitHub](https://github.com/Ashish-Patnaik/kokoclone)
