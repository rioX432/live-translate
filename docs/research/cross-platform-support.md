# Cross-Platform Support Evaluation for live-translate

**Issue:** #318
**Date:** 2026-03-24
**Status:** Research complete — Windows support is feasible with moderate effort; Linux is straightforward for packaging but needs native addon testing

## 1. Current State

| Platform | Status | Blocker |
|----------|--------|---------|
| macOS (arm64) | Production | — |
| macOS (x64) | Untested | Native addon builds |
| Windows (x64) | Experimental NSIS config exists | Native addon compatibility, no CI |
| Linux (x64) | No support | No packaging, no CI |

### Native Addon Dependencies
| Addon | macOS | Windows | Linux | Notes |
|-------|-------|---------|-------|-------|
| whisper-node-addon | Pre-built (arm64/x64) | Pre-built (x64) | Pre-built (x64/arm64) | No Windows CUDA yet |
| node-llama-cpp | Pre-built | Pre-built | Pre-built | Auto-detects GPU backend |
| electron-store | Pure JS | Cross-platform | Cross-platform | No native code |

## 2. Windows Support Assessment

### Native Addon Compatibility

**whisper-node-addon (@kutalia/whisper-node-addon):**
- Pre-built `.node` binaries available for Windows x64
- Automatic runtime detection — zero-config for Electron
- **Limitation:** No CUDA backend for Windows yet (maintainer lacks NVIDIA GPU for testing)
- CPU inference works out of the box; GPU acceleration via CUDA is a TODO

**node-llama-cpp:**
- Full Windows support with pre-built binaries
- Auto-detects available hardware: CPU, CUDA, Vulkan
- Falls back to source build with cmake if no pre-built binary matches

**whisper.cpp (direct build for Windows):**
- CUDA build supported: `cmake -DWHISPER_CUBLAS=ON` + MSVC + CUDA toolkit
- OpenBLAS available as CPU fallback
- DirectML support requested but not yet implemented
- Vulkan backend available as alternative GPU acceleration

### Windows NSIS Installer
- Existing config needs testing and likely updates for current dependency versions
- electron-builder NSIS is well-documented and widely used

### Windows CI Pipeline
- GitHub Actions `windows-latest` runner available
- Need to add: build, lint, test steps for Windows
- Native addon rebuild may be needed: `electron-builder install-app-deps`

### Estimated Effort: Windows
- 2-3 days: Fix NSIS installer, test native addons, verify audio capture
- 1-2 days: Add Windows CI pipeline
- 1 day: Platform-specific path handling (backslashes, AppData paths)
- **Total: ~5 days**

## 3. Linux Support Assessment

### Packaging Options

| Format | Pros | Cons |
|--------|------|------|
| AppImage | Self-contained, runs on any distro, no install needed | Larger file size, no auto-update integration |
| Flatpak | Sandboxed, centralized updates via Flathub | Runtime dependency, complex for native addons |
| .deb/.rpm | Native package manager integration | Distro-specific, need to maintain multiple formats |
| Snap | Auto-updates, Ubuntu native | Confinement issues with audio devices |

**Recommendation:** AppImage as primary (broadest compatibility), .deb as secondary (Ubuntu/Debian).

### Native Addon Compatibility
- whisper-node-addon: Pre-built for Linux x64/arm64
- node-llama-cpp: Pre-built for Linux, auto-detects CUDA/Vulkan
- Audio capture: PulseAudio or PipeWire required for `getUserMedia`

### Linux-Specific Concerns
- **Audio permissions:** PulseAudio/PipeWire access in AppImage may need `--no-sandbox` flag or proper Flatpak permissions
- **GPU acceleration:** CUDA (NVIDIA) or Vulkan (AMD/Intel) — need to handle both
- **Wayland vs X11:** Transparent overlay window behavior differs; X11 is more reliable for click-through

### Estimated Effort: Linux
- 1-2 days: AppImage packaging with electron-builder
- 1 day: Audio capture testing (PulseAudio/PipeWire)
- 1 day: Transparent overlay testing (X11/Wayland)
- 1 day: Linux CI pipeline
- **Total: ~5 days**

## 4. Cross-Platform STT Fallback Strategy

For reliable cross-platform STT, the engine selection should be:

| Platform | Primary STT | Fallback STT |
|----------|------------|--------------|
| macOS | WhisperKit (ANE) or MLX-Whisper | whisper.cpp (Metal) |
| Windows | whisper.cpp (CUDA) | Sherpa-ONNX (#311) |
| Linux | whisper.cpp (CUDA/Vulkan) | Sherpa-ONNX (#311) |

Sherpa-ONNX (#311) is the strongest cross-platform fallback — it supports Windows, Linux, macOS with ONNX Runtime and has no native compilation requirements.

## 5. Competitive Landscape

| Competitor | Platforms | Approach |
|-----------|-----------|----------|
| DeepL Voice | Web (all platforms) | Cloud-based |
| Wordly | Web (all platforms) | Cloud-based |
| KUDO | Web (all platforms) | Cloud-based |
| LiveCaptions-Translator | Windows only | Local whisper.cpp |
| RTranslator | Android only | Local |
| **live-translate** | **macOS (current)** | **Local-first** |

Adding Windows support would capture the largest desktop market. Most local competitors are single-platform.

## 6. Recommendations

### Priority Order
1. **Windows support first** — largest desktop market share, existing NSIS config to build on, native addons already have pre-built Windows binaries
2. **Linux second** — smaller market but important for developer/enterprise audience
3. **macOS x64 third** — declining market (Intel Macs), but low effort if Windows works

### Implementation Plan
1. Fix and test Windows NSIS installer
2. Add Windows CI pipeline (GitHub Actions)
3. Verify all native addons work on Windows x64
4. Add Sherpa-ONNX as cross-platform STT fallback (#311)
5. Add AppImage packaging for Linux
6. Add Linux CI pipeline
7. Test audio capture and overlay on each platform

## References
- [whisper-node-addon (cross-platform)](https://github.com/Kutalia/whisper-node-addon)
- [node-llama-cpp (cross-platform)](https://github.com/withcatai/node-llama-cpp)
- [whisper.cpp Windows CUDA build](https://blog.binaee.com/2025/04/whisper-cpp-cuda-build-windows/)
- [electron-builder AppImage](https://www.electron.build/appimage.html)
- [electron-builder Flatpak](https://www.electron.build/flatpak.html)
- [Building a Linux Electron App](https://www.dolthub.com/blog/2025-05-29-building-a-linux-electron-app/)
- [LiveCaptions-Translator (Windows competitor)](https://github.com/nickmurraynyc/LiveCaptions-Translator)
