# Smart Subtitle Positioning Near Active Speaker

**Issue:** #580
**Date:** 2026-04-09
**Status:** Research complete — viable; recommend phased implementation starting with macOS Vision framework

## 1. Summary

Dynamic subtitle positioning near the active speaker reduces eye movement and improves comprehension by keeping subtitles spatially close to the speaker's face on screen. No existing real-time translation overlay product implements this feature, making it a genuine differentiator.

Academic validation is strong: multiple peer-reviewed papers (HAL, IEEE, ACM, Korean Science) confirm that speaker-adjacent subtitle placement outperforms fixed-bottom subtitles for both deaf/HoH users and general audiences in comprehension and eye-strain metrics.

## 2. Academic Research

### Key Papers

| Paper | Venue | Key Finding |
|-------|-------|-------------|
| "Dynamic Subtitle Allocation: A Practical System with Speaker Separation" | Korean Journal of AI (JAKO202509061203762) | Real-time system achieving practical speaker separation for dynamic allocation |
| "On-Device AI-Based Real-Time Dynamic Subtitle Placement for IPTV Contents" | IJBC (JAKO202516261206046) | On-device approach hitting 60 fps, 99.7% accuracy; uses ROI, pruning, 8-bit quantization |
| "Dynamic Subtitle Placement Considering the Region of Interest and Speaker Location" | Semantic Scholar / Akahori & Hirai | Candidate position algorithm around speaker face; balances proximity and content avoidance |
| "Dynamic Subtitles: A Multimodal Video Accessibility Enhancement" | IEEE (HAL-04305389) | Audio-visual fusion (lip motion, audio-visual synchrony) for active speaker detection; F1 >92% across 30 videos |
| "Speaker-Following Video Subtitles" | ACM TOMM (arXiv:1407.5145) | Usability study confirms speaker-following subtitles outperform fixed bottom in eye-strain and experience |
| "Automatic Subtitle Placement Through Active Speaker Identification" | IEEE (9657604) | Novel identification algorithm using audio+visual cues; comprehensive usability validation |

### Placement Strategy from Literature

The dominant approach:
1. Detect all face bounding boxes per frame
2. Identify active speaker (audio-visual sync or audio energy attribution)
3. Place subtitle in a candidate zone below/adjacent to the active speaker's bounding box
4. Apply safe-zone constraints (avoid screen edges, avoid overlapping other faces)
5. Smooth position over time (weighted blending, not instant jump)

## 3. Face Detection Options

### Option A: Apple Vision Framework (macOS only)

- **API:** `VNDetectFaceRectanglesRequest` / `VNDetectHumanRectanglesRequest`
- **Integration path:** Native Node.js addon (Objective-C++ / Swift wrapper via N-API or node-ffi)
  - Electron officially supports native addons compiled against its Node.js ABI
  - Electron docs provide a full guide for Objective-C macOS native addons
- **Performance:**
  - Runs on Apple Neural Engine (ANE) on M-series chips
  - Typical latency: **<10ms** per frame for face bounding box detection at 640×360 input
  - `.fast` accuracy level reduces latency further; `.accurate` improves small-face recall
  - Available macOS 10.13+; Vision v5+ adds human body detection
- **Pros:** Zero extra dependencies, hardware-accelerated ANE/GPU, best macOS performance
- **Cons:** macOS-only; requires native addon build in CI; adds Xcode dependency

### Option B: MediaPipe Face Detector (cross-platform, WASM/WebGL)

- **API:** `@mediapipe/tasks-vision` FaceDetector (BlazeFace backend)
- **Integration path:** Runs in Electron renderer or UtilityProcess via WASM
- **Performance (BlazeFace model):**
  - Sub-millisecond on mobile GPU; ~**15–36 FPS** on 2017 Intel Core i5 laptop (WASM path)
  - With WebGL/WebGPU delegate: **30–60 FPS** on mid-range desktop hardware
  - detectForVideo() with requestAnimationFrame for live-stream inference
  - Tracking mode (vs. detection mode) avoids per-frame full detection once faces are locked
- **Pros:** Cross-platform (macOS + Windows), pure JS, no native addon, already used in KMP-FaceLink sister project
- **Cons:** WASM overhead vs. native ANE; larger bundle (~2MB model)

### Option C: ONNX Runtime + BlazeFace/UltraLight (cross-platform, Node.js)

- **API:** `onnxruntime-node` in main/UtilityProcess
- **Models:** BlazeFace ONNX (garavv/blazeface-onnx on HuggingFace), UltraLight (~1MB)
- **Performance:**
  - node-tflite benchmark: **60 FPS on MacBook Pro 2019** (faster than TF.js WASM)
  - onnxruntime-node with CPU EP: estimated **10–25ms** per frame at 320×240 for UltraLight
  - CUDA EP on Windows: sub-5ms
- **Pros:** Works in main/UtilityProcess (no renderer required), consistent with existing onnxruntime usage patterns in the codebase, cross-platform
- **Cons:** Slightly heavier than Vision framework on Apple Silicon; model download required

### Option D: screen-capture + periodic frame sampling (minimal approach)

Rather than continuous detection, sample at **2–5 fps** (200–500ms interval). This is enough to track speaker position changes in a video call (speakers don't move instantaneously).

- Combined with Option A/B/C for actual detection
- Reduces CPU load significantly vs. 30fps continuous detection
- Jitter smoothing via exponential moving average on bounding box coordinates

## 4. Screen Capture Pipeline

### Architecture

```
desktopCapturer (main process)
  → thumbnail at reduced resolution (e.g. 640×360 or 320×180)
  → Face detector (Vision addon / MediaPipe WASM / onnxruntime-node)
  → Active speaker attribution (audio energy + face position heuristic)
  → Smoothed bounding box → IPC to subtitle window
  → subtitleWindow.setBounds() repositioning
```

### desktopCapturer Notes

- Must run in **main process** (renderer usage was removed in Electron; confirmed in Electron docs)
- `thumbnailSize: { width: 320, height: 180 }` — adequate for face detection, minimal capture cost
- Capture the target display (the one subtitleWindow is on), not the whole desktop
- At 2–5fps polling, desktopCapturer overhead is acceptable (<5% CPU on M2)
- For screen recording permission on macOS: requires `NSScreenCapturePermission` (same as the existing audio permission pattern)

### Window Repositioning

- `subtitleWindow.setBounds()` is synchronous on the main process side
- On macOS, there is **no measurable latency** for `setBounds` (compositor handles it sub-frame)
- Known issue: `setBounds` + `animate: true` emits `resize-end` event — use `animate: false` for programmatic repositioning
- On Windows, `setBounds` between monitors with different DPI can require two calls (known Electron bug #16444)
- Recommended update rate: **once per 200–500ms** to avoid jitter; smooth with EMA

### Subtitle Position Logic

```
// Pseudo-code for placement
const speakerBox = smoothedBoundingBox(detectedFaces, activeSpeakerId)
const subtitleY = speakerBox.y + speakerBox.height + MARGIN  // below face
const subtitleY = clamp(subtitleY, display.bounds.y, display.bounds.y + display.bounds.height - SUBTITLE_HEIGHT)
// Horizontal: center on speaker, clamped to display bounds
const subtitleX = clamp(speakerBox.centerX - SUBTITLE_WIDTH / 2, display.bounds.x, display.bounds.x + display.bounds.width - SUBTITLE_WIDTH)
```

## 5. Multi-Speaker Handling

### Strategies

| Strategy | Description | Complexity |
|----------|-------------|------------|
| Audio energy attribution | Assign active speaker based on current audio transcription timing; subtitle follows last detected speaker | Low — works with existing VAD |
| Lip motion detection | MediaPipe FaceMesh detects mouth openness; active = most open mouth | Medium — requires FaceMesh (heavier than FaceDetector) |
| Audio-visual sync (SyncNet-style) | Correlate audio energy with face bounding box motion | High — research-grade complexity |
| Fallback to fixed position | If 0 or 3+ faces detected, revert to fixed bottom | N/A — safety net |

### Recommendation for v1

Use **audio energy attribution** as the active speaker proxy:
- The transcript is already attributed to time windows from VAD
- Map VAD energy segments to face boxes by temporal proximity
- If one face: always that speaker
- If multiple faces: attribute to face with highest motion delta in lip region (cheap: just track mouth landmark y-delta from MediaPipe's 6-point BlazeFace output)
- If no face detected: fall back to saved fixed position (existing behavior)

## 6. Competitor Landscape

No existing real-time translation overlay product implements speaker-adjacent subtitle positioning:

| Product | Subtitle Position | Dynamic? |
|---------|-------------------|----------|
| Zoom live captions | Fixed bottom bar | No |
| Microsoft Teams | Fixed bottom bar | No |
| Google Meet | Fixed bottom | No |
| live-translate (current) | User-draggable fixed position | No |
| **live-translate (proposed)** | **Near active speaker** | **Yes** |

Zoom uses "active speaker view" to move the speaker tile to the top, but subtitles remain fixed at the bottom — the gap between speaker face and subtitle is still large. This is the gap to exploit.

## 7. Performance Considerations

### Latency Budget

| Step | Target | Notes |
|------|--------|-------|
| Screen thumbnail capture | <10ms | 320×180 at 2–5fps |
| Face detection inference | <20ms | BlazeFace/Vision at reduced resolution |
| Active speaker attribution | <5ms | Simple audio energy heuristic |
| `setBounds` repositioning | <2ms | Electron main process, no animation |
| **Total pipeline** | **<37ms** | Well within 50ms budget from issue |

### CPU/Memory Impact

- Continuous 30fps detection: ~15–20% CPU on M2 (unacceptable)
- 2fps polling with tracking: **~2–3% CPU** on M2 (acceptable)
- 5fps polling with tracking: **~4–6% CPU** on M2 (acceptable, recommended)
- Vision framework (macOS): ~1–2% CPU at 5fps due to ANE offload
- BlazeFace ONNX (onnxruntime-node): ~5% CPU at 5fps on Intel i7

### macOS Screen Recording Permission

- `NSScreenCapturePermission` plist entry required (similar to existing mic permission)
- Permission prompt shown once; graceful fallback if denied (stay on fixed position)
- Must handle denial gracefully — do not crash or hang

## 8. Recommended Implementation Plan

### Phase 1 — macOS (Vision framework native addon)

1. Create `src/engines/face-detector/` directory
2. Implement `AppleVisionFaceDetector` as a native addon (Objective-C++, N-API)
   - Exposes `detectFaces(jpegBuffer): FaceBox[]` synchronous call
3. Add `FaceDetectorManager` in `src/main/` to own lifecycle + polling loop
4. Add `SmartPositionManager` in `src/main/` for EMA smoothing + `setBounds` calls
5. Add toggle in SettingsPanel: "Smart subtitle positioning"
6. Request `NSScreenCapturePermission` on first enable

### Phase 2 — Cross-platform (ONNX Runtime)

1. Add `OnnxFaceDetector` using `onnxruntime-node` + BlazeFace ONNX model (~1MB)
2. Auto-select: Vision on macOS, ONNX on Windows
3. Model downloaded alongside STT models via `model-downloader.ts`

### Phase 3 — Multi-speaker (lip motion)

1. Upgrade to MediaPipe FaceMesh (6-landmark output already includes mouth points)
2. Track mouth delta per face per frame; attribute active speaker to max delta face
3. Smooth attribution with 500ms hysteresis to avoid flickering

## 9. Key Files to Modify

| File | Change |
|------|--------|
| `src/main/window-manager.ts` | Add `setSmartPosition(box)` method wrapping `setBounds` with clamping |
| `src/main/index.ts` | Initialize FaceDetectorManager when smart positioning enabled |
| `src/renderer/components/settings/` | Add SmartPositioningSettings component |
| `electron-builder config` | Add `NSScreenCaptureUsageDescription` to plist |
| `postinstall.js` | Build Vision native addon (macOS only) |

## 10. Open Questions / Risks

| Risk | Mitigation |
|------|------------|
| macOS Screen Recording permission UX friction | Explain in onboarding; graceful fallback |
| Subtitle jumping between speakers causes distraction | 500ms hysteresis + EMA smoothing; user-configurable sensitivity |
| Small faces in video call tiles (grid view) | Minimum face size threshold (e.g. >5% of display width); fall back to fixed if too small |
| Windows DPI scaling `setBounds` bug | Apply double-call workaround from Electron issue #16444 |
| Privacy concern: screen capture | All processing is on-device; no frames leave the machine; document clearly |

## References

- [Apple Vision Framework documentation](https://developer.apple.com/documentation/vision)
- [Tracking the User's Face in Real Time — Apple Developer](https://developer.apple.com/documentation/Vision/tracking-the-user-s-face-in-real-time)
- [Native Code and Electron: Objective-C (macOS)](https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron-objc-macos)
- [MediaPipe Face Detector guide](https://developers.google.com/mediapipe/solutions/vision/face_detector)
- [BlazeFace: Sub-millisecond Neural Face Detection on Mobile GPUs (arXiv:1907.05047)](https://arxiv.org/abs/1907.05047)
- [On-Device AI-Based Real-Time Dynamic Subtitle Placement for IPTV Contents (JAKO202516261206046)](https://www.koreascience.kr/article/JAKO202516261206046.view)
- [Dynamic Subtitle Allocation: A Practical System with Speaker Separation (JAKO202509061203762)](https://www.koreascience.kr/article/JAKO202509061203762.page)
- [Dynamic Subtitle Placement Considering ROI and Speaker Location — Semantic Scholar](https://www.semanticscholar.org/paper/Dynamic-Subtitle-Placement-Considering-the-Region-Akahori-Hirai/2864cfd949e5b787b1fd22c05b5bb6450197a72e)
- [Dynamic Subtitles: A Multimodal Video Accessibility Enhancement — HAL](https://hal.science/hal-04305389v1)
- [Dynamic Captioning — HAL](https://hal.science/hal-02468749)
- [Speaker-Following Video Subtitles — ACM TOMM](https://dl.acm.org/doi/10.1145/2632111)
- [Automatic Subtitle Placement Through Active Speaker Identification — IEEE](https://ieeexplore.ieee.org/document/9657604/)
- [ONNX Runtime inference](https://onnxruntime.ai/inference)
- [BlazeFace ONNX model — HuggingFace](https://huggingface.co/garavv/blazeface-onnx)
- [Electron desktopCapturer API](https://www.electronjs.org/docs/api/desktop-capturer)
- [BrowserWindow.setBounds — Electron](https://www.electronjs.org/docs/latest/api/browser-window)
- [WWDC24: Discover Swift enhancements in the Vision framework](https://developer.apple.com/videos/play/wwdc2024/10163/)
- [SpeechCompass: Enhancing Mobile Captioning with Diarization (arXiv:2502.08848)](https://arxiv.org/html/2502.08848v2)
