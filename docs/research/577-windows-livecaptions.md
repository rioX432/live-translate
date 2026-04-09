# Windows LiveCaptions STT Integration Research

**Issue:** #577
**Date:** 2026-04-09
**Status:** Research complete — viable; recommended as primary zero-setup STT engine on Windows 11 22H2+

---

## 1. Summary

Windows 11's built-in Live Captions feature provides on-device, system-wide speech recognition that can be accessed programmatically via the Windows UI Automation (UIA) API. The LiveCaptions-Translator open-source project (C#, 2.7k stars) proves this pattern works: it polls the `CaptionsTextBlock` UIA element every ~25ms and feeds extracted text to translation APIs. For live-translate, this means **zero model download, zero GPU requirement, and zero per-second audio buffering** on Windows — audio capture is handled entirely by the OS.

The integration adds a new `LiveCaptionsEngine.ts` that bypasses audio processing entirely: instead of feeding PCM audio through Whisper, it reads text from the OS-managed caption window.

---

## 2. Windows 11 Live Captions — How It Works

### Architecture

Live Captions is an accessibility feature shipped in Windows 11 22H2 (build 22621+). It runs a compact Azure AI Speech on-device model that processes any audio playing on the system (system audio + optional microphone mix).

- **On-device processing**: all inference runs locally after an initial ~50MB language pack download
- **Model**: compact Azure AI Speech variant, same fairness training as cloud Speech-to-Text
- **Audio sources**: system audio, microphone, or both (user-controlled)
- **Activation**: `Win + Ctrl + L`, Quick Settings, or `Start > All Apps > Accessibility > Live Captions`
- **Window class**: `LiveCaptionsDesktopWindow` (discoverable via UIA)

### Language Support (Recognition)

20 languages supported for speech recognition (not translation):

| Language | Variants |
|----------|----------|
| Chinese | Simplified, Traditional |
| Danish | — |
| English | US, UK, AU, CA, IN, NZ |
| French | Canada, France |
| German | — |
| Italian | — |
| Japanese | — |
| Korean | — |
| Portuguese | Brazil, Portugal |
| Spanish | Mexico, Spain |

**Translation** (24H2+ Copilot+ PCs only): 44 languages → English, 27 languages → Simplified Chinese. Translation is a separate feature from recognition and is not needed for this integration (live-translate handles translation).

### ARM64 Support

ARM64 Windows 11 is supported with caveats:
- Chinese Traditional captions do **not** work on ARM64
- Language pack installation progress may be hidden on ARM64
- Unexpected delays possible when adding languages on ARM64

### Accuracy

- Described as "extremely high" for English under ideal conditions
- Handles simultaneous speakers and background game audio reasonably well
- Struggles with non-standard accents, technical jargon, overlapping speech
- Real-world reviews note it is "almost always faster" than Microsoft Teams captioning
- No published WER/CER benchmarks for Japanese; English real-world accuracy ~90-95% estimated

### Known Limitations

- Music, applause, and sung lyrics are not reliably transcribed
- Only one audio device at a time (default output + optional mic)
- "Captions are being missed" dialog appears in some audio gap scenarios
- Window sizing resets across display resolution changes
- **Not available on Windows 10** — hard requirement: Windows 11 22H2+

---

## 3. Windows UI Automation API — UIA Access from Node.js

### How LiveCaptions-Translator Does It (C# Reference Implementation)

The reference implementation (`SakiRinn/LiveCaptions-Translator`) is pure C# + .NET 8, using `UIAutomationClient`:

```csharp
// 1. Launch LiveCaptions process
Process.Start("LiveCaptions");

// 2. Find the window by process ID
var condition = new PropertyCondition(AutomationElement.ProcessIdProperty, processId);
AutomationElement window = AutomationElement.RootElement.FindFirst(TreeScope.Children, condition);
// Validates window.Current.ClassName == "LiveCaptionsDesktopWindow"

// 3. Extract caption text (cached element)
private static AutomationElement captionsTextBlock;

public static string GetCaptions(AutomationElement window) {
    if (captionsTextBlock == null)
        captionsTextBlock = FindElementByAId(window, "CaptionsTextBlock");
    return captionsTextBlock?.Current.Name ?? string.Empty;
}

// 4. Poll + change detection (~25ms loop)
// idleCount: unchanged text cycles; syncCount: incomplete sentence cycles
// Queue for translation when: terminal punctuation, idleCount > MaxIdleInterval,
// or syncCount > MaxSyncInterval
```

Key automation IDs:
- `"CaptionsTextBlock"` — the element containing all visible caption text (`.Current.Name` property)
- `"SettingsButton"` — for programmatic settings access

### Node.js / Electron Integration Options

Three viable approaches, ordered by recommendation:

#### Option A: Native Node Addon (N-API) — Recommended

Write a small C++ N-API addon (`live-captions-uia.node`) that wraps `UIAutomationClient.h` COM interfaces. Compiled via `node-gyp` on Windows, ships as prebuilt binary for x64/ARM64.

```
Electron main process
  └── require('./live-captions-uia.node')
        ├── LaunchLiveCaptions()       → spawns LiveCaptions.exe, returns HWND/pid
        ├── GetCaptionsText()          → returns string from CaptionsTextBlock.Name
        └── IsLiveCaptionsAvailable()  → checks Windows version + process state
```

Pros:
- No extra runtime dependency (.NET not required)
- Direct COM calls, minimal latency overhead
- Full control over element caching and polling frequency
- Compatible with Electron's native addon architecture (same as whisper-node-addon)

Cons:
- Requires Windows-only build step in CI (GitHub Actions)
- ~200-400 lines of C++/COM boilerplate

Precedent in this codebase: `whisper-node-addon` follows the same pattern.

#### Option B: electron-edge-js (C# in-process)

`electron-edge-js` (npm, v40.0.1, actively maintained) runs C# code in-process with Electron. Supports Electron 29-41 with pre-compiled binaries for x64 and ARM64.

```typescript
// In Electron main process (via IPC, not main thread — crashes on main thread)
import edge from 'electron-edge-js'
const getCaptions = edge.func(`
  using System.Windows.Automation;
  // ... C# UIA access inline or from compiled DLL
`)
const text = await getCaptions(null)
```

Pros:
- No C++ required; C# can be inline string or compiled DLL
- Re-uses exact same C# patterns as reference implementation
- Supports Electron 29-41 natively

Cons:
- Requires .NET 8+ runtime on user machine (extra user-facing dependency)
- **Must run via IPC** (using edge-js on the main Electron thread causes hard crash on window refresh)
- Adds ~15-30MB to distribution size

#### Option C: @bright-fish/node-ui-automation (npm)

Pure Node.js N-API wrapper around `UIAutomationClient`, written in C++. MIT license.

```typescript
import { Automation, PropertyIds, TreeScopes } from '@bright-fish/node-ui-automation'
const root = Automation.getRootElement()
const condition = Automation.createPropertyCondition(PropertyIds.AutomationId, 'CaptionsTextBlock')
const el = root.findFirst(TreeScopes.Descendants, condition)
const text = el.getCurrentPropertyValue(PropertyIds.Name)
```

Pros:
- npm install, no C++ authoring required
- Wraps standard UIA COM interfaces

Cons:
- Low maintenance activity (small project, ~2 maintainers)
- Electron version compatibility unconfirmed — needs testing
- May need manual Electron ABI rebuild (`electron-rebuild`)

---

## 4. Architecture Diagram

```
Windows 11 (22H2+)
┌─────────────────────────────────────────────────────────────┐
│  System Audio / Microphone                                  │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────┐    Win+Ctrl+L or                      │
│  │  LiveCaptions   │◄── programmatic spawn                 │
│  │  (OS process)   │                                       │
│  │  Azure AI model │                                       │
│  │  on-device      │                                       │
│  └────────┬────────┘                                       │
│           │ CaptionsTextBlock.Name (UIA)                   │
│           │ polled every ~25ms                             │
│           ▼                                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Electron main process                               │  │
│  │  ┌────────────────────────┐                         │  │
│  │  │  LiveCaptionsEngine.ts │                         │  │
│  │  │  - isAvailable()       │◄── Win11 version check  │  │
│  │  │  - initialize()        │    spawn LiveCaptions   │  │
│  │  │  - startPolling()      │    25ms setInterval     │  │
│  │  │  - changeDetection()   │    idleCount/syncCount  │  │
│  │  │  - emit('result', ...) │    → EventEmitter       │  │
│  │  └────────────────────────┘                         │  │
│  │           │                                         │  │
│  │           ▼                                         │  │
│  │  TranslationPipeline (existing)                     │  │
│  │  → TranslatorEngine → subtitle overlay             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Key difference from existing STT engines: `LiveCaptionsEngine` emits **text segments** directly — no PCM audio is ever processed by live-translate. The `processAudio()` method returns `null` and is a no-op; text arrives via polling.

---

## 5. Polling Mechanism & Change Detection

Based on the reference implementation:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Poll interval | ~25ms (40 Hz) | `setInterval` or native loop |
| `idleCount` threshold | configurable | Sentence considered complete when text stable for N cycles |
| `syncCount` threshold | configurable | Incomplete but changing text flushed after N cycles |
| Sentence detection | terminal punctuation (`。.!?…`) | Flush immediately on punctuation |
| Element caching | yes — re-lookup on `ElementNotAvailableException` | Element reference can go stale |

Change detection pseudocode:
```typescript
let prev = ''
let idleCount = 0
let syncCount = 0

setInterval(() => {
  const current = nativeAddon.getCaptionsText()
  if (current === prev) {
    idleCount++
    if (idleCount > MAX_IDLE) flush(prev)
  } else {
    idleCount = 0
    syncCount++
    if (endsWithPunctuation(current) || syncCount > MAX_SYNC) flush(current)
    prev = current
  }
}, 25)
```

---

## 6. Latency Characteristics

| Metric | LiveCaptionsEngine | WhisperLocal (default) | MLX Whisper |
|--------|-------------------|----------------------|-------------|
| First-word latency | ~200-500ms (OS-controlled) | ~2-3s (VAD + inference) | ~2.9s |
| Polling overhead | ~0ms (text read, no inference) | N/A | N/A |
| Setup latency | ~1-2s (spawn LiveCaptions process) | ~3-5s (model load) | ~5-10s (model load) |
| Model download | ~50MB language pack (OS, one-time) | ~540MB whisper model | ~1-2GB |
| GPU/CPU load | 0% (OS-managed) | High (Whisper inference) | High (MLX) |

LiveCaptions is faster in time-to-first-word but the OS controls the internal VAD and chunking — live-translate cannot tune these parameters. Whisper offers more control (VAD sensitivity, chunk size) at the cost of higher latency.

---

## 7. Auto-Detection and Fallback

```typescript
// LiveCaptionsEngine.isAvailable()
async function isAvailable(): Promise<boolean> {
  // 1. Platform check
  if (process.platform !== 'win32') return false

  // 2. Windows 11 22H2+ check via registry or os.release()
  // Windows 11 = build 22000+; 22H2 = build 22621+
  const build = getWindowsBuildNumber() // from registry or ver command
  if (build < 22621) return false

  // 3. Verify LiveCaptions.exe exists
  // %SystemRoot%\System32\LiveCaptions.exe
  return existsSync(join(process.env.SystemRoot!, 'System32', 'LiveCaptions.exe'))
}
```

Fallback chain:
```
LiveCaptionsEngine (Windows 11 22H2+)
  └── if not available → WhisperLocalEngine (existing default)
```

This mirrors the `AppleSpeechTranscriberEngine` pattern on macOS: platform-native zero-setup engine as primary, Whisper as universal fallback.

---

## 8. Limitations Summary

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Windows 11 22H2+ only | ~70% of Windows users as of 2025 | Whisper fallback |
| ARM64: Chinese Traditional broken | Edge case | Document, fallback to Whisper for zh-TW on ARM64 |
| No music/applause transcription | Low (meeting/conversation use case) | Acceptable |
| User must grant mic permission in LiveCaptions settings | One-time setup | Show onboarding dialog |
| Cannot tune VAD sensitivity | Live-translate loses control | Acceptable trade-off |
| LiveCaptions may show "captions missed" dialog | Occasional interruption | `HideLiveCaptions()` pattern from reference impl |
| Translation feature (24H2+) separate from recognition | live-translate doesn't need it | N/A |
| Not open source (OS black box) | Cannot fix bugs | Whisper fallback |

---

## 9. Implementation Recommendation

**Recommended approach: Option A (Native N-API addon)**

Rationale:
1. Consistent with `whisper-node-addon` — same native addon pattern already in the codebase
2. No .NET runtime dependency on user machine
3. Full control over polling, element caching, and error recovery
4. Pre-built binaries for x64 and ARM64 via existing GitHub Actions CI infrastructure

**Implementation plan (matching issue #577 tasks):**

1. Create `scripts/win-livecaptions/` with C++ N-API addon source:
   - `LiveCaptionsAddon.cc` — UIA COM calls, `LaunchLiveCaptions`, `GetCaptionsText`, `IsAvailable`
   - `binding.gyp` — Windows-only build config
   - `postinstall.js` — prebuilt binary download (same pattern as whisper-node-addon)

2. Create `src/engines/stt/LiveCaptionsEngine.ts`:
   - Implements `STTEngine` interface (same as all other engines)
   - `processAudio()` → returns `null` (no-op, OS handles audio)
   - Starts polling on `initialize()`, stops on `dispose()`
   - `isAvailable()` checks `win32` + build 22621+

3. Register in `src/main/index.ts` → `initPipeline()` but **hide from UI SettingsPanel** (experimental) until benchmarked

4. Auto-detect on Windows: if available, offer as default over WhisperLocal in Windows setup wizard

5. Add Windows 11 version detection util to `src/main/platform.ts`

**Estimated effort:** ~3-4 days (C++ addon ~1.5d, TS engine ~0.5d, CI/build ~1d, testing ~1d)

---

## 10. References

- [Windows Live Captions — Microsoft Support](https://support.microsoft.com/en-us/windows/use-live-captions-to-better-understand-audio-b52da59c-14b8-4031-aeeb-f6a47e6055df)
- [LiveCaptions-Translator (SakiRinn, 2.7k stars)](https://github.com/SakiRinn/LiveCaptions-Translator)
- [LiveCaptions-Translator: Translation Process (DeepWiki)](https://deepwiki.com/SakiRinn/LiveCaptions-Translator/3.2-translation-process)
- [LiveCaptions-Translator: Windows Integration (DeepWiki)](https://deepwiki.com/SakiRinn/LiveCaptions-Translator/8.1-windows-livecaptions-integration)
- [Windows UI Automation — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32)
- [electron-edge-js (agracio)](https://github.com/agracio/electron-edge-js)
- [@bright-fish/node-ui-automation (npm)](https://www.npmjs.com/package/@bright-fish/node-ui-automation)
- [Windows LiveCaptions: Real-World Review (David Edmiston, 2025)](https://davidedmiston.com/post/2025/windows-live-captions/)
- [Microsoft: Real-Time Translation in Live Captions — Insider Blog](https://blogs.windows.com/windows-insider/2024/12/18/releasing-real-time-translation-in-live-captions-to-more-copilot-pcs-in-the-dev-channel/)
