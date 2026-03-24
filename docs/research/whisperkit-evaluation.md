# WhisperKit Evaluation for live-translate

**Issue:** #317
**Date:** 2026-03-24
**Status:** Research complete — viable via local server subprocess; recommended as macOS-exclusive high-performance STT option

## 1. Model Overview

WhisperKit is Argmax's reimplementation of OpenAI Whisper optimized for Apple Neural Engine (ANE). It achieves near-peak hardware utilization on Apple Silicon while consuming less power than CPU or GPU execution paths.

### Performance Benchmarks

| Metric | WhisperKit | whisper.cpp (CPU) | Cloud (gpt-4o-transcribe) |
|--------|-----------|-------------------|--------------------------|
| Mean latency (per-word) | 0.46s | ~1-2s | 0.45s (Fireworks) |
| WER (LibriSpeech) | 2.2% | 2.8% | ~2.5% |
| WER (LibriSpeech, CoreML) | 2.44% | — | — |
| Power consumption | Low (ANE) | Medium (CPU) | N/A (cloud) |

### Model Sizes (CoreML optimized)

| Variant | Size | QoI Score | Notes |
|---------|------|-----------|-------|
| large-v3 (full) | ~3.1 GB | 99.8% | Best accuracy |
| large-v3-turbo | ~1.6 GB | 95%+ | Streaming optimized |
| large-v3 (compressed) | ~0.6 GB | 90.8% | Mixed-bit quantization, within 1% WER |
| small | ~0.5 GB | ~85% | Fastest, lower accuracy |

### Hardware Support
- M1, M2, M3, M4 Neural Engines all supported
- M3/M4 ANE is faster than M1; WhisperKit optimizes per-chip
- iOS 17+ and macOS 14+ required (ANE API availability)

## 2. Integration Options

### Option A: WhisperKit Local Server (RECOMMENDED)

WhisperKit ships a local HTTP server (`whisperkit-local-server`) that implements the OpenAI Audio API.

**How:**
1. Bundle the `whisperkit-local-server` executable with the Electron app
2. Spawn as a subprocess on app launch
3. Send audio via HTTP POST to `localhost:{port}/v1/audio/transcriptions`
4. Receive streaming transcription results

**Pros:**
- OpenAI-compatible API — can reuse existing client code
- No Swift compilation required in the build pipeline
- Streaming support for real-time transcription
- Clean process isolation (crash doesn't affect main app)
- Build with `make build-local-server` from WhisperKit repo

**Cons:**
- macOS-only (ANE is Apple-exclusive hardware)
- Additional ~50 MB for the server binary
- HTTP overhead vs direct native binding (minimal for audio chunks)

### Option B: Swift Subprocess with CLI

**How:** Build WhisperKit CLI tool, invoke via `child_process.spawn`, pipe audio via stdin.

**Pros:** Simpler than HTTP server
**Cons:** Less flexible, no streaming API, harder to manage lifecycle

### Option C: Native Addon (Swift → C → Node.js N-API)

**How:** Write a C bridge between Swift WhisperKit and Node.js N-API.

**Pros:** Lowest latency, direct memory sharing
**Cons:** Complex build pipeline, fragile across Swift/Node version upgrades, not worth the maintenance cost

## 3. Comparison with Current STT Engines

| Engine | Latency | WER | Size | Platform | GPU Accel |
|--------|---------|-----|------|----------|-----------|
| WhisperKit (ANE) | 0.46s | 2.2% | 0.6-3.1 GB | macOS only | ANE |
| whisper.cpp (current) | ~1-2s | 2.8% | 1.5 GB | Cross-platform | Metal/CUDA |
| MLX-Whisper (#308) | ~0.5-1s | ~2.5% | 1.5 GB | macOS only | Metal |
| Moonshine ONNX | ~0.3s | ~5% | 60 MB | Cross-platform | WebGPU/CPU |

WhisperKit provides the best latency-to-accuracy ratio on macOS, but is Apple-exclusive.

## 4. Implementation Plan

### Phase 1: Prototype
1. Build `whisperkit-local-server` from WhisperKit repo
2. Create `WhisperKitEngine` class implementing `STTEngine` interface
3. Manage server lifecycle (spawn on init, kill on dispose)
4. Route audio to HTTP endpoint, parse streaming responses

### Phase 2: Integration
1. Add "WhisperKit (ANE)" option to Settings Panel (macOS only)
2. Auto-detect macOS and ANE availability
3. Bundle compressed large-v3 model (~600 MB) or download on first use
4. Fallback to whisper.cpp if WhisperKit server fails to start

### Estimated Effort
- 2-3 days for basic integration
- 1 day for model download/management
- 1 day for testing across M1/M2/M3

## 5. Recommendations

- **Integrate WhisperKit as a premium macOS STT option** using the local server approach.
- Use the compressed large-v3 model (600 MB) as default for best size/quality tradeoff.
- Keep whisper.cpp as the cross-platform default; WhisperKit is a macOS-only enhancement.
- This gives live-translate a hardware advantage that no cross-platform competitor can match on Mac.

## References
- [WhisperKit GitHub](https://github.com/argmaxinc/WhisperKit)
- [WhisperKit Paper (arXiv)](https://arxiv.org/abs/2507.10860)
- [WhisperKit Benchmarks](https://github.com/argmaxinc/WhisperKit/blob/main/BENCHMARKS.md)
- [WhisperKit CoreML Models](https://huggingface.co/argmaxinc/whisperkit-coreml)
- [Apple SpeechAnalyzer + WhisperKit](https://www.argmaxinc.com/blog/apple-and-argmax)
