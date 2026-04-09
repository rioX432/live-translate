# Windows Copilot Runtime Translation API — Research

**Issue:** #583
**Date:** 2026-04-09
**Status:** Research complete — Translation API is NOT yet available to third-party developers; recommend monitoring roadmap and implementing Phi Silica workaround in the interim

---

## 1. Summary

Windows Copilot+ PCs include an on-device real-time translation feature in Live Captions that supports 44+ languages including Japanese. However, as of April 2026, **the Live Captions Translation API is explicitly listed as "Not yet supported" on the official Windows AI APIs documentation page**. Third-party developers cannot call this translation engine directly via Windows App SDK or WinRT.

The available on-device AI path for Electron integration is `Microsoft.Windows.AI.Text.LanguageModel` (Phi Silica), which is a general-purpose SLM that can be prompted to translate — but is not a dedicated translation API, and its translation quality for JA↔EN has not been benchmarked against HY-MT1.5-1.8B.

---

## 2. API Status

### Windows AI APIs — What's Available (Windows App SDK 1.7.1+)

| API | Namespace | Status | Notes |
|-----|-----------|--------|-------|
| Phi Silica (LanguageModel) | `Microsoft.Windows.AI.Text` | Stable (1.7.1) | General SLM, can be prompted for translation |
| Text Recognition (OCR) | `Microsoft.Windows.AI.Imaging` | Stable (1.7.1) | — |
| Image Super Resolution | `Microsoft.Windows.AI.Imaging` | Stable (1.7.1) | — |
| Image Object Extractor | `Microsoft.Windows.AI.Imaging` | Stable (1.7.1) | — |
| Image Description | `Microsoft.Windows.AI.Imaging` | Stable (1.7.1) | — |
| Object Erase | `Microsoft.Windows.AI.Imaging` | Stable (1.8.0) | — |
| Phi Silica LoRA fine-tuning | `Microsoft.Windows.AI.Text` | Preview (1.8 preview) | — |
| **Live Caption Translations** | — | **Not yet supported** | Explicitly listed as future item |
| Semantic Search | — | Private preview | Waitlist only |

**Source:** [Windows AI APIs overview (learn.microsoft.com)](https://learn.microsoft.com/en-us/windows/ai/apis/), last updated 2026-01-27.

### What "Not yet supported" Means

The Live Captions translation engine runs entirely on the NPU and is available to the OS (Live Captions app). Microsoft has flagged it as a goal to expose a third-party API for this, but no SDK namespace, contract version, or target release date has been published as of this writing. The 1.7-experimental builds that first exposed Copilot Runtime APIs did not include a translation namespace.

---

## 3. NPU Hardware Requirements

- **Minimum:** 40 TOPS NPU (Copilot+ PC requirement)
- **Supported silicon:** Qualcomm Snapdragon X Elite/Plus, AMD Ryzen AI 300 series, Intel Core Ultra 200V series
- **Supported devices (examples):** Surface Laptop Copilot+ PC, Surface Pro Copilot+ PC, HP OmniBook X 14, Dell Latitude 7455/XPS 13, Lenovo Yoga Slim 7x, Samsung Galaxy Book4 Edge, ASUS Vivobook S 15

Copilot+ PCs require Windows 11 and the NPU ≥ 40 TOPS threshold. Non-Copilot+ PCs (no NPU or < 40 TOPS) do not support any Windows AI API, including Phi Silica.

**Market coverage estimate:** As of early 2026, Copilot+ PCs launched in mid-2024. Coverage among active Windows users remains a small fraction; most enterprise fleets will not have Copilot+ hardware for 2–4 years.

---

## 4. Language Pairs

The OS-level Live Captions translation supports **translation into English only** from 44+ languages. Confirmed languages include: Arabic, Bulgarian, Czech, Danish, German, Greek, **Japanese**, Korean, Chinese (Simplified), Spanish, French, Hindi, Portuguese, Russian, and more.

**Critical limitation:** The existing user-facing feature translates **into English only**. There is no documented support for translating English into Japanese (EN→JA). This is a dealbreaker for live-translate's primary use case of bidirectional JA↔EN translation.

---

## 5. Integration Approach from Electron

### Path A — Phi Silica via NodeRT (Feasible Now)

Phi Silica (`Microsoft.Windows.AI.Text.LanguageModel`) is a stable WinRT API accessible from Electron via NodeRT.

**Architecture:**
```
Renderer → IPC → Main Process → Native Node Addon (NodeRT) → WinRT LanguageModel → Phi Silica (NPU)
```

**Steps:**
1. Generate NodeRT bindings for `microsoft.windows.ai.text` namespace using the NodeRT CLI
2. Compile the native addon targeting the Electron ABI (NodeRT does not use N-API; must be recompiled per Electron version)
3. Wrap in a `CopilotTranslator.ts` engine implementing the existing `TranslatorEngine` interface
4. Use `GenerateResponseAsync()` with a translation prompt (e.g., `"Translate the following Japanese text to English: {input}"`)
5. Register as an experimental engine; auto-detect availability via `LanguageModel.GetReadyState()`

**Risks:**
- NodeRT modules must be compiled per Electron ABI — adds CI complexity for Windows builds
- `cppwinrt` (header-only C++) or NodeRT CLI required as build dependency
- Phi Silica is a general SLM, not a translation-tuned model; translation quality unknown
- EN→JA quality likely poor (Phi-3-mini-derived, not multilingual-translation-optimized)
- No streaming token support in the current NodeRT binding pattern

**Alternative — Custom C++ native addon:**
Write a `windows-ai-translator.node` addon directly using `cppwinrt` targeting `Microsoft.Windows.AI.Text.LanguageModel`. More complex to build but avoids NodeRT's ABI issue if using N-API wrappers manually.

### Path B — Wait for Native Translation API (Recommended for Production)

Microsoft has signaled the intent to expose the Live Captions translation engine to third parties. When available, the API is expected to be significantly faster and higher quality than using Phi Silica via prompt.

Monitoring steps:
- Watch [Windows App SDK releases](https://github.com/microsoft/WindowsAppSDK/releases) for a translation namespace
- Watch [Windows AI APIs docs](https://learn.microsoft.com/en-us/windows/ai/apis/) — the "Not yet supported" line will change
- Watch experimental channel (`1.x-experimental`) for early access

### Path C — Azure Translator (Cloud Fallback)

`MicrosoftTranslator.ts` already exists in the codebase. This serves as the non-Copilot+ fallback and supports full bidirectional JA↔EN with no hardware requirement.

---

## 6. Quality Benchmarks

No public benchmarks for Phi Silica JA↔EN translation exist as of this writing. Phi Silica is derived from Phi-3-mini (3.3B parameters), which is primarily English-optimized.

| Engine | JA→EN | EN→JA | Offline | Memory | Latency |
|--------|-------|-------|---------|--------|---------|
| HY-MT1.5-1.8B (current default) | ~180ms | ~180ms | Yes | ~1GB | Fast |
| Phi Silica via prompt (estimated) | Unknown | Likely poor | Yes | ~0 (OS-managed) | ~500ms–2s |
| Native Live Captions Translation (future) | Unknown | EN→JA not confirmed | Yes | ~0 (OS-managed) | Expected fast |
| Azure Translator (MicrosoftTranslator.ts) | Fast | Fast | No | — | ~200ms |

Phi Silica translation quality for JA should be validated empirically before shipping. A prototype test with 50 JA→EN sentences against HY-MT1.5-1.8B output would establish whether quality is acceptable.

---

## 7. Offline Capability and Model Management

- Phi Silica: Fully offline. Model is OS-managed — installed as part of Windows and downloaded via Windows Update on Copilot+ PCs. No user-initiated download required.
- Future Live Captions Translation API: Expected to be fully offline and OS-managed, same pattern.
- Both require Copilot+ PC hardware; no model file is bundled with the app.

---

## 8. Fallback Strategy

```
Is Copilot+ PC?
  ├─ Yes → Is Live Captions Translation API available? (check contract version)
  │         ├─ Yes (future) → Use CopilotTranslator (NPU, zero download)
  │         └─ No (now)    → Use Phi Silica via prompt OR fall through
  └─ No  → Use HY-MT1.5-1.8B (local GGUF, ~1GB download)
             └─ No disk space / low memory → OPUS-MT legacy fallback
```

Auto-detection logic:
```ts
// Pseudocode — check if Windows AI APIs are available
import { LanguageModel } from '@nodert-win11/microsoft.windows.ai.text';

async function isCopilotPlusAvailable(): Promise<boolean> {
  try {
    const state = LanguageModel.getReadyState();
    return state !== 'not-supported';
  } catch {
    return false; // not on Windows or NodeRT not available
  }
}
```

---

## 9. Recommendation

**Do not block issue #583 on a native Live Captions Translation API** — it does not exist for third-party apps yet.

**Short-term (now):**
- Keep HY-MT1.5-1.8B as the Windows default (already works)
- Track the Windows AI APIs page for when Live Captions Translation status changes

**Medium-term (when Phi Silica path is desired):**
- Prototype `CopilotTranslator.ts` using Phi Silica + translation prompt
- Benchmark JA→EN quality against HY-MT1.5-1.8B before enabling
- Add as experimental engine with `copilot_plus` capability flag
- Note: EN→JA is uncertain quality; do not enable by default

**Long-term (when native API ships):**
- Implement `CopilotTranslationEngine.ts` using the native WinRT translation namespace
- Use as auto-selected engine on Copilot+ PCs (zero download, NPU-accelerated)
- Investigate if EN→JA is supported before promoting to primary engine

**Combined with #577 (Windows LiveCaptions STT):** A fully OS-native pipeline (STT + Translation) on Copilot+ PCs is the strategic goal, but translation API availability is blocking. STT (#577) can proceed independently.

---

## References

- [Windows AI APIs overview](https://learn.microsoft.com/en-us/windows/ai/apis/)
- [Copilot+ PCs developer guide](https://learn.microsoft.com/en-us/windows/ai/npu-devices/)
- [Windows App SDK 1.7 release notes](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-notes/windows-app-sdk-1-7)
- [Windows App SDK 1.8 release notes](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/release-notes/windows-app-sdk-1-8)
- [LanguageModel API reference](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.windows.ai.text.languagemodel)
- [NodeRT — WinRT to Node.js generator](https://github.com/NodeRT/NodeRT)
- [Using Native Windows Features from Electron (Felix Rieseberg)](https://felixrieseberg.com/using-native-windows-features-from-electron/)
- [Real-Time Translation in Live Captions — Windows Insider Blog](https://blogs.windows.com/windows-insider/2024/12/18/releasing-real-time-translation-in-live-captions-to-more-copilot-pcs-in-the-dev-channel/)
- [Unlock a new era of innovation with Windows Copilot Runtime](https://blogs.windows.com/windowsdeveloper/2024/05/21/unlock-a-new-era-of-innovation-with-windows-copilot-runtime-and-copilot-pcs/)
