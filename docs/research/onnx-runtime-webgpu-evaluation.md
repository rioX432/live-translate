# ONNX Runtime WebGPU Evaluation for live-translate

**Issue:** #319
**Date:** 2026-03-24
**Status:** Research complete — viable for Moonshine and OPUS-MT acceleration; known Electron+Intel GPU issues to watch

## 1. Overview

ONNX Runtime Web with WebGPU execution provider enables GPU-accelerated ONNX model inference directly in the Electron renderer process, without native addons. This could accelerate Moonshine (STT) and OPUS-MT (translation) models.

### WebGPU Browser Support (as of 2026)
| Browser/Runtime | WebGPU Status | Notes |
|----------------|---------------|-------|
| Chrome 113+ | Enabled by default | Mac, Windows, ChromeOS |
| Chrome 121+ | Enabled by default | Android |
| Edge 113+ | Enabled by default | Same Chromium base |
| Firefox | Shipped on Windows | Other platforms in progress |
| Safari | In development | WebKit team actively working |
| **Electron 33+** | **Available** | **Uses Chromium 128+** |

### ONNX Runtime Web Versions
- ONNX Runtime 1.17+: WebGPU execution provider officially launched
- onnxruntime-web npm package: Drop-in for browser/Electron usage

## 2. Benchmarks

### General WebGPU Speedup (ONNX Runtime)
| Model | CPU (WASM) | WebGPU | Speedup | Hardware |
|-------|-----------|--------|---------|----------|
| Segment Anything (encoder) | Baseline | 19x faster | 19x | RTX 3060 |
| Segment Anything (decoder) | Baseline | 3.8x faster | 3.8x | RTX 3060 |

### Moonshine Web (ONNX + WebGPU)
Moonshine Web runs real-time speech recognition 100% in-browser using ONNX Runtime Web + Transformers.js with WebGPU acceleration and WASM fallback.

| Metric | Moonshine (WebGPU) | Moonshine (WASM) | whisper.cpp (native) |
|--------|--------------------|-------------------|---------------------|
| Model size (tiny) | ~60 MB | ~60 MB | ~75 MB |
| Latency | ~75ms | ~200-300ms | ~100ms |
| WER | ~5% | ~5% | ~2.8% |
| Platform | Any (browser) | Any (browser) | Native only |

SpeedPower.run benchmarks Moonshine-Tiny with hybrid-precision (FP32 encoder + Q4 decoder) to measure GPU throughput.

### OPUS-MT (WebGPU potential)
OPUS-MT ONNX models are small (~50-200 MB per language pair) and well-suited for WebGPU acceleration. Expected 3-5x speedup over WASM for the transformer attention layers.

## 3. Electron-Specific Considerations

### Known Issues
- **Intel integrated GPU bug:** Incorrect/unstable predictions on Intel Gen-9, Gen-11, Gen-12LP iGPUs when running ONNX Runtime WebGPU in Electron ([Issue #24442](https://github.com/microsoft/onnxruntime/issues/24442)). Does not occur in Chrome on the same hardware.
- **Workaround:** Detect Intel iGPU and fall back to WASM execution provider.

### Electron Configuration
```javascript
// Enable WebGPU in Electron
const win = new BrowserWindow({
  webPreferences: {
    // WebGPU is enabled by default in Electron 33+
    // No additional flags needed for Chromium 128+
  }
});

// Check WebGPU availability in renderer
if (navigator.gpu) {
  const adapter = await navigator.gpu.requestAdapter();
  // Use WebGPU EP
} else {
  // Fallback to WASM EP
}
```

### Architecture Decision: Renderer vs Main Process
| Aspect | Renderer (WebGPU) | Main Process (native) |
|--------|-------------------|----------------------|
| GPU access | WebGPU API | Metal/CUDA/Vulkan |
| Setup complexity | npm install only | Native addon build |
| Cross-platform | Yes (any Chromium) | Per-platform binaries |
| Performance | Good (3-20x vs WASM) | Best (direct GPU) |
| Memory sharing | Isolated (renderer) | Shared with main |

**Recommendation:** Use WebGPU in renderer for ONNX models (Moonshine, OPUS-MT). Keep native addons (whisper.cpp, llama.cpp) in main process for maximum performance.

## 4. Memory and GPU Contention

### Concurrent Model Inference
Running multiple ONNX models with WebGPU simultaneously:

| Scenario | GPU Memory | Risk |
|----------|-----------|------|
| Moonshine only | ~200 MB | Low |
| OPUS-MT only | ~300 MB | Low |
| Moonshine + OPUS-MT | ~500 MB | Medium — may cause GPU contention |
| + whisper.cpp (Metal) | +1.5 GB | High — Metal and WebGPU compete for GPU |

**Key concern:** If the user runs WhisperKit or whisper.cpp with Metal acceleration AND Moonshine/OPUS-MT with WebGPU, both compete for GPU resources. Solution: Don't run native GPU STT and WebGPU STT simultaneously.

### Mitigation Strategies
1. **Exclusive GPU mode:** Only one GPU-accelerated engine active at a time
2. **Fallback detection:** If WebGPU inference time degrades >2x, switch to WASM
3. **Memory monitoring:** Track `performance.memory` and GPU adapter limits

## 5. Implementation Plan

### Phase 1: WebGPU Detection and Fallback
1. Add WebGPU capability detection in renderer
2. Implement automatic fallback to WASM EP
3. Detect Intel iGPU and default to WASM (known bug)

### Phase 2: Moonshine WebGPU
1. Load Moonshine ONNX model with WebGPU EP in renderer
2. Benchmark against current WASM execution
3. Add to Settings Panel as "Moonshine (GPU-accelerated)"

### Phase 3: OPUS-MT WebGPU
1. Load OPUS-MT models with WebGPU EP
2. Benchmark translation speed improvement
3. Evaluate memory usage with concurrent STT + Translation

### Estimated Effort
- 2 days: WebGPU detection, fallback, Intel workaround
- 2 days: Moonshine WebGPU integration and benchmarking
- 2 days: OPUS-MT WebGPU integration and benchmarking
- **Total: ~6 days**

## 6. Recommendations

- **Adopt WebGPU EP for Moonshine and OPUS-MT** — significant speedup with no native addon complexity.
- **Keep native addons for primary STT** (whisper.cpp, WhisperKit) — they still offer better accuracy.
- **Implement Intel iGPU detection** — fall back to WASM to avoid the known Electron bug.
- **Avoid running WebGPU and Metal/CUDA models simultaneously** — GPU contention degrades both.
- This directly benefits cross-platform support (#318) since WebGPU works on Windows and Linux without platform-specific GPU bindings.

## References
- [ONNX Runtime WebGPU Tutorial](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- [onnxruntime-web npm](https://www.npmjs.com/package/onnxruntime-web)
- [ONNX Runtime WebGPU Blog](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/)
- [Moonshine Web (Xenova/Transformers.js)](https://huggingface.co/posts/Xenova/486935205804807)
- [Electron WebGPU Intel Bug](https://github.com/microsoft/onnxruntime/issues/24442)
- [WebGPU Browser Support](https://web.dev/blog/webgpu-supported-major-browsers)
- Related: #276 (Transformers.js v4 + WebGPU evaluation)
