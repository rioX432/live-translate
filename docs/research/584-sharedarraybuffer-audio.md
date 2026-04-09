# Research: SharedArrayBuffer Zero-Copy Audio IPC (#584)

**Date:** 2026-04-09
**Author:** research agent
**Issue:** [#584 – SharedArrayBuffer zero-copy audio IPC](https://github.com/rioX432/live-translate/issues/584)

---

## Summary

Issue #584 proposes replacing the current `Array.from(Float32Array)` → IPC → `new Float32Array()` copy pattern with a SharedArrayBuffer-based ring buffer for zero-copy audio transfer between the renderer and main/UtilityProcess. This document evaluates feasibility, design, performance impact, and security implications.

**Recommendation: Defer to v2.0 / post-MVP. The current `MessagePort + transferable ArrayBuffer` path (added in #553) already eliminates the serialization cost that motivated this issue. SharedArrayBuffer adds non-trivial complexity and requires COOP/COEP headers or a custom Electron session protocol handler, and the incremental gain over transferable ArrayBuffers is marginal for the 3-second audio chunk sizes in the current pipeline.**

---

## 1. Current IPC Baseline

### Current Path (pre-#553)
```
Renderer                     Main
Float32Array  →  Array.from()  →  ipcRenderer.invoke()  →  JSON serialize/deserialize  →  new Float32Array()
```
- Two memory allocations + deep JSON copy per chunk
- ~3s × 16kHz = 48,000 floats = 192 KB per chunk → JSON string ~1.2 MB

### Current Path (post-#553, `audio-port.ts`)
```
Renderer                     Main
Float32Array  →  buffer.slice()  →  port.postMessage(buf, [buf])  →  new Float32Array(buf)
```
- ArrayBuffer is **transferred** (ownership move, O(1) in time, zero copy)
- One allocation in renderer; main receives the same memory block
- This is already near-optimal for renderer ↔ main audio transfer

The key insight: **transferable ArrayBuffers already achieve zero-copy** semantics between renderer and main because Chromium IPC ownership-transfers the underlying memory. The sender's reference is neutered after postMessage.

---

## 2. SharedArrayBuffer in Electron

### 2.1 Cross-Origin Isolation Requirement

SharedArrayBuffer (SAB) was disabled by all browsers in early 2018 due to the Spectre vulnerability and re-enabled in 2020 only under cross-origin isolation. In standard Chromium/Electron renderer contexts, a document must set:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Only then is `crossOriginIsolated === true` and `new SharedArrayBuffer()` available.

### 2.2 Electron Issue #45034

[electron/electron#45034](https://github.com/electron/electron/issues/45034) (opened December 2024) requests a first-class Electron API for sharing read-only ArrayBuffers from main to renderer without requiring cross-origin isolation. As of April 2026 this issue is **still open with no merged implementation**. No native Electron SAB-over-IPC API exists yet.

### 2.3 How to Enable SAB in Electron Today

Three approaches are documented:

**Option A — Session protocol handler with COOP/COEP headers (recommended)**
```typescript
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Cross-Origin-Opener-Policy': ['same-origin'],
      'Cross-Origin-Embedder-Policy': ['require-corp'],
    },
  })
})
```
This makes `crossOriginIsolated = true` in the renderer; SAB becomes available.

**Option B — `enableBlinkFeatures: 'SharedArrayBuffer'`** in `webPreferences`
Historically worked but is undocumented, fragile, and may be removed in future Electron versions.

**Option C — Service worker header injection**
Feasible but adds runtime overhead and complexity.

**Verdict:** Option A is the only reliable, officially-supported path. It requires injecting headers in `window-manager.ts` and auditing all third-party iframes/resources for CORP compliance (currently live-translate loads no external resources, so this is low-risk).

### 2.4 UtilityProcess Limitation

**Critical constraint:** `SharedArrayBuffer` cannot be passed to a `UtilityProcess` (Node.js child process) via the standard `process.parentPort.postMessage()` path. The Electron UtilityProcess runs in a Node.js environment, not a Chromium renderer; it has no `SharedArrayBuffer` in its V8 isolate unless SAB support is explicitly compiled in. The `worker-pool.ts` / `slm-worker.ts` pipeline that handles translation **cannot receive SAB directly**. Any SAB ring buffer would stop at the main process boundary; from main to UtilityProcess, audio data still must be serialized (or SharedMemory mapped at the OS level, which is out of scope).

---

## 3. Ring Buffer Design with Atomics

The canonical pattern for SAB-based audio is a **wait-free SPSC (Single Producer, Single Consumer) ring buffer**, as documented in:
- [padenot/ringbuf.js](https://github.com/padenot/ringbuf.js) — production-ready, MIT, 1.3 kB gzip
- [Chrome DevRel – AudioWorklet design pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern)

### Layout (Float32, 3s at 16 kHz = 48,000 samples = 192 KB)

```
SAB layout (bytes):
[0..3]   writeHead  (Int32, atomic)
[4..7]   readHead   (Int32, atomic)
[8..N]   audio data (Float32Array view)
```

### Producer (AudioWorklet / renderer)
```javascript
// Write samples to ring, advance writeHead with Atomics.store
const head = Atomics.load(ctrl, WRITE_HEAD)
const available = capacity - ((head - Atomics.load(ctrl, READ_HEAD) + capacity) % capacity)
if (available >= frameLength) {
  // copy into data[head % capacity]
  Atomics.store(ctrl, WRITE_HEAD, (head + frameLength) % capacity)
}
```

### Consumer (main process, after SAB is transferred)
```javascript
// Atomics.notify / Atomics.wait for wake-up
Atomics.wait(ctrl, SYNC_FLAG, 0) // blocks Node.js thread — PROBLEMATIC (see §5)
```

### AudioWorklet Constraint

`Atomics.wait()` (blocking) is **prohibited inside AudioWorkletGlobalScope** because the audio rendering thread must never block. The producer (AudioWorklet) can only use `Atomics.notify()` and non-blocking `Atomics.load/store`. The consumer (Worker or main) uses `Atomics.waitAsync()` or `Atomics.wait()`.

Since the current live-translate pipeline uses `processorType: 'AudioWorklet'` per CLAUDE.md rules, the producer fits the AudioWorklet model. However, the `main` process is Node.js — `Atomics.wait()` blocks the main thread, which is unacceptable. **The consumer must use `Atomics.waitAsync()` (non-blocking) or poll via `setImmediate`.**

---

## 4. Performance Analysis

### 4.1 Transferable ArrayBuffer vs. SharedArrayBuffer

| Method | Copy cost | Ownership | Latency (3s chunk) | Suitable for live-translate |
|---|---|---|---|---|
| JSON IPC (old) | 2× alloc + serialize | Copied | ~2–5 ms overhead | No (pre-#553) |
| Transferable ArrayBuffer (current) | 0 copies | Moved | ~0.1–0.3 ms | ✅ Yes |
| SharedArrayBuffer | 0 copies | Shared | ~0.05–0.1 ms | ✅ Marginal gain |

Key insight from [surma.dev benchmarks](https://surma.dev/things/is-postmessage-slow/): transferring an ArrayBuffer is O(1) regardless of size — the cost is pure IPC roundtrip overhead (~0.1–0.3 ms), not memory bandwidth. SAB removes even this small overhead but at the cost of Atomics synchronization complexity.

### 4.2 Actual Payload Size

```
3s × 16,000 Hz × 4 bytes = 192,000 bytes ≈ 188 KB per chunk
```

At 188 KB, even a naive copy takes < 0.5 ms on a modern CPU (DDR5 bandwidth ~50+ GB/s). The bottleneck is **Whisper STT inference time (500 ms–2.9 s)**, not IPC transfer time. The transfer overhead is < 0.1% of total pipeline latency.

### 4.3 Where SAB Would Actually Help

SAB would provide measurable benefit only if audio were transferred at AudioWorklet frame size (128 samples = 512 bytes, every ~8 ms). The current architecture batches into VAD-detected speech segments (0.5–5s), completely eliminating this concern.

---

## 5. Cross-Process SAB Sharing

### Renderer ↔ Main
Feasible after enabling COOP/COEP headers (Option A in §2.3). SAB can be sent via `MessageChannelMain` / `webContents.postMessage`.

### Main ↔ UtilityProcess (`slm-worker`)
**Not feasible without OS-level shared memory.** The UtilityProcess is a Node.js process; its `parentPort` uses Chromium IPC under the hood, but `SharedArrayBuffer` cannot traverse this boundary in Electron's current API surface. The UtilityProcess receives translation requests as JSON (`{ text, id }`) — this is not audio data and is negligible in size (~100 bytes per request).

### Renderer ↔ Subtitle Window
Subtitle window is a separate `BrowserWindow`. SABs cannot be shared between two renderer processes in Electron without explicit `postMessage` with `[sharedArrayBuffer]` in the transfer list — and both windows need COOP/COEP. This is not a current bottleneck.

---

## 6. Security Implications

### Spectre Mitigations
COOP/COEP force cross-origin isolation, which puts the renderer in a dedicated process and prevents cross-origin timing attacks via shared timers. For a desktop Electron app with `contextIsolation: true` and no external origins, this has **no practical user-facing impact**.

### What Changes with COOP/COEP in Electron
- `crossOriginIsolated` becomes `true` in renderer
- `performance.now()` gains higher precision (already useful)
- Third-party iframes or external `<script src="...">` resources must send `Cross-Origin-Resource-Policy: cross-origin` — **live-translate loads no such resources, so this is a non-issue**
- Existing `MessageChannelMain` audio path continues to work unchanged

### electron-store Encryption
No impact. SAB is an in-memory transport; stored API keys remain encrypted.

### IPC Path Validation
SAB does not change the IPC channel attack surface. Directory traversal validation in existing handlers is unaffected.

---

## 7. Existing Implementations in Production

| Project | SAB Usage | Notes |
|---|---|---|
| [ringbuf.js](https://github.com/padenot/ringbuf.js) | AudioWorklet ↔ Worker | Reference SPSC implementation, Firefox Audio team |
| Chrome AudioWorklet design pattern | AudioWorklet ↔ SharedWorker | Google reference implementation |
| Figma | Requested but not implemented | Forum thread; uses WASM shared memory instead |
| Web-based DAWs (e.g., Soundtrap) | AudioWorklet internal | Not cross-process Electron |

No widely-deployed Electron app was found that routes microphone audio via SAB across renderer ↔ main process as of April 2026. The common pattern for Electron audio apps is MessagePort + transferable buffers (exactly what #553 implemented).

---

## 8. AudioWorklet Compatibility

The current live-translate pipeline uses `processorType: 'AudioWorklet'` (CLAUDE.md rules). AudioWorklet compatibility with SAB:

- **SAB creation**: requires `crossOriginIsolated === true` in the main document — achievable with COOP/COEP headers
- **Atomics.wait**: **prohibited** in `AudioWorkletGlobalScope` (spec-mandated; the audio rendering thread must never block)
- **Atomics.store/load/notify**: allowed — usable for non-blocking producer writes
- **SAB in postMessage from worklet**: allowed with proper cross-origin isolation

The existing VAD + AudioWorklet pipeline produces 0.5–5s speech segments, not 128-sample frames. Routing these through SAB instead of transferable ArrayBuffers would require restructuring the producer side of `useAudioCapture.ts` with minimal benefit.

---

## 9. Technical Design (If Implemented)

### Prerequisites
1. Add COOP/COEP header injection in `window-manager.ts` (session webRequest)
2. Verify `crossOriginIsolated === true` in renderer on startup
3. Audit all loaded resources for CORP compliance (currently: none needed)

### Ring Buffer Architecture
```
[Renderer AudioWorklet]
  → writes Float32 frames into SAB ring (Atomics.store)
  → Atomics.notify(ctrl, SYNC_FLAG)

[Main Process — audio-port.ts]
  → receives SAB reference at startup (one-time postMessage)
  → Atomics.waitAsync(ctrl, SYNC_FLAG, 0).then(() => drainRing())
  → drainRing(): reads accumulated samples, runs VAD in-process
  → on speech end: slices Float32Array view (zero-copy) → STT engine

[UtilityProcess — slm-worker.ts]
  → unchanged: receives translation request as JSON string
```

### SAB Allocation
```typescript
// Main process or renderer (whichever creates the SAB)
const CAPACITY = 16000 * 10  // 10s at 16kHz
const sab = new SharedArrayBuffer(
  8 +                      // 2x Int32 for read/write heads
  CAPACITY * Float32Array.BYTES_PER_ELEMENT
)
const ctrl = new Int32Array(sab, 0, 2)   // [writeHead, readHead]
const data = new Float32Array(sab, 8)    // audio ring
```

### Estimated Code Change
- `window-manager.ts`: +15 lines (COOP/COEP header injection)
- `audio-port.ts`: ~+80 lines (SAB init, ring drain, Atomics.waitAsync loop)
- `useAudioCapture.ts`: ~+50 lines (SAB write path alongside existing MessagePort path)
- New file `src/renderer/audio-ring.ts`: ~100 lines (producer helper)
- Total: ~250 lines, replaces/wraps existing transferable path

---

## 10. Recommendation

**Status: Defer**

| Factor | Assessment |
|---|---|
| Latency gain vs. current (#553) | < 0.3 ms per chunk (< 0.1% of pipeline) |
| Implementation complexity | Medium–high (COOP/COEP, Atomics, dual code path) |
| Risk of regression | Medium (AudioWorklet + SAB + Electron edge cases) |
| UtilityProcess gain | None (SAB cannot cross this boundary) |
| Value for real-time streaming (SimulMT) | Low-medium — streaming chunks are smaller but STT dominates |

The transferable ArrayBuffer path from #553 already eliminates all copy overhead for the current chunk sizes. SAB would add meaningful value only if the pipeline moves to AudioWorklet frame-level (128-sample) routing — a much larger architectural change.

**Revisit when:**
- electron/electron#45034 lands with a native shared-buffer API
- A sub-100ms latency requirement emerges from streaming/SimulMT work
- VAD moves fully in-process (main), enabling tighter producer–consumer coupling

---

## References

- [padenot/ringbuf.js — Wait-free SPSC ring buffer](https://github.com/padenot/ringbuf.js)
- [Chrome DevRel — AudioWorklet design pattern with SharedArrayBuffer](https://developer.chrome.com/blog/audio-worklet-design-pattern)
- [AudioWorklet + SharedArrayBuffer + Worker sample (Google)](https://googlechromelabs.github.io/web-audio-samples/audio-worklet/design-pattern/shared-buffer/)
- [MDN — SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [web.dev — Making your website cross-origin isolated using COOP and COEP](https://web.dev/articles/coop-coep)
- [web.dev — Why you need cross-origin isolated for powerful features](https://web.dev/articles/why-coop-coep)
- [electron/electron#45034 — Read-only shared buffer from main to renderer](https://github.com/electron/electron/issues/45034)
- [electron/electron#10409 — How to send SharedArrayBuffer from main to Window processes](https://github.com/electron/electron/issues/10409)
- [surma.dev — Is postMessage slow?](https://surma.dev/things/is-postmessage-slow/)
- [paul.cx — A wait-free SPSC ring buffer for the Web](https://blog.paul.cx/post/a-wait-free-spsc-ringbuffer-for-the-web/)
- [WebAudio spec issue #1848 — Why AudioWorklet disables Atomics.wait](https://github.com/webaudio/web-audio-api/issues/1848)
- [LogRocket — Understanding SharedArrayBuffer and cross-origin isolation](https://blog.logrocket.com/understanding-sharedarraybuffer-and-cross-origin-isolation/)
