# Chrome Built-in AI Translator API — Research

**Date:** 2026-04-09
**Issue:** [#582](https://github.com/rioX432/live-translate/issues/582)
**Researcher:** agent

---

## Summary

Chrome's built-in Translator API (`Translator.create()`) uses an on-device expert model (distinct from the full Gemini Nano LLM) to perform translations entirely within the browser. As of Chrome 138+ (stable), the Translator API and Language Detector API are generally available on desktop without origin trial. Japanese ↔ English is a confirmed supported language pair. The API is **desktop-only** and has steep hardware requirements (22 GB free disk, 4 GB VRAM or 16 GB RAM). Quality is roughly on par with Google Translate for common language pairs but has not been independently benchmarked for JA↔EN specifically.

---

## 1. API Availability & Status

| Dimension | Detail |
|---|---|
| **Status** | Generally available (Chrome 138+ stable) — no origin trial required |
| **API surface** | `Translator.create()`, `translator.translate()`, `translator.translateStreaming()` |
| **Platforms** | Desktop only: Windows 10/11, macOS 13+, Linux, ChromeOS 16389+ |
| **Mobile** | Not supported (Chrome Android / iOS) |
| **Other browsers** | Not supported (Edge, Firefox, Safari) |
| **W3C status** | Adopted by W3C WebML Working Group alongside Language Detector API |

Feature detection:

```javascript
if ('Translator' in self) {
  // API is supported
}
```

Availability check before creating:

```javascript
const availability = await Translator.availability({
  sourceLanguage: 'ja',
  targetLanguage: 'en'
});
// Returns: 'unavailable' | 'downloadable' | 'downloading' | 'available'
```

---

## 2. How to Enable

For **production use**, no flags are needed in Chrome 138+. The API is enabled by default.

For **development / local testing** or enabling on older builds:

1. Navigate to `chrome://flags/#optimization-guide-on-device-model` → set to **Enabled**
2. For the Prompt API (Gemini Nano LLM, not Translator): also enable `chrome://flags/#prompt-api-for-gemini-nano`
3. Relaunch Chrome

**Important:** The Translator API uses a separate expert model, not the Gemini Nano LLM — the Prompt API flag is not needed for translation.

---

## 3. Language Pair Coverage

JA↔EN is explicitly confirmed as supported. The API supports 40+ languages total including:

- Japanese (`ja`) ↔ English (`en`) — **confirmed**
- Spanish (`es`), French (`fr`), German (`de`), Italian (`it`)
- Simplified Chinese (`zh`), Traditional Chinese (`zh-Hant`)
- Korean (`ko`), Portuguese (`pt`), Arabic (`ar`), Russian (`ru`), and others

Language pair support is checked dynamically via `Translator.availability()`. Chrome is tracking an issue (#68) to expose a programmatic API to list all supported pairs without enumerating them individually.

**Privacy note:** Chrome intentionally reports *all* language pairs as "downloadable" regardless of actual availability — to prevent fingerprinting the user's installed languages.

---

## 4. Hardware Requirements & Model Size

| Requirement | Value |
|---|---|
| **Free disk space** | 22 GB minimum (model is removed if disk drops below 10 GB after download) |
| **GPU VRAM** | > 4 GB (GPU path), OR |
| **RAM + CPU** | 16 GB RAM + 4+ cores (CPU path) |
| **Network** | Unmetered connection for initial download only; offline after that |
| **Model size** | ~1.5–2 GB per language pair (download on first use) |

The model is downloaded the first time a website or extension uses a given language pair. Subsequent uses are fully offline.

**Implication for live-translate:** The 22 GB disk space requirement and 1.5–2 GB per language pair download are significant barriers for casual users. Users with < 22 GB free disk will see `availability: 'unavailable'`.

---

## 5. API Usage & Chrome Extension Integration

### Basic usage

```javascript
// Check if API is available
if (!('Translator' in self)) {
  // Fallback to desktop relay
}

const availability = await Translator.availability({
  sourceLanguage: 'ja',
  targetLanguage: 'en'
});

if (availability === 'unavailable') {
  // Fallback
}

const translator = await Translator.create({
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  // Monitor download progress if status is 'downloadable'
  monitor(m) {
    m.addEventListener('downloadprogress', (e) => {
      console.log(`Downloaded ${e.loaded} of ${e.total} bytes`);
    });
  }
});

// Await model ready (if still downloading)
await translator.ready;

const result = await translator.translate('こんにちは');
console.log(result); // "Hello"
```

### Streaming (for long text)

```javascript
const stream = translator.translateStreaming(longText);
for await (const chunk of stream) {
  // Append chunk to UI
}
```

### Chrome Extension pattern

- **Service worker / background script**: Call `Translator.create()` and cache the translator instance per language pair
- **Content script**: Collect text → send via `chrome.runtime.sendMessage()` → background translates → return result
- **User activation**: `create()` requires transient user activation (click, keypress, etc.) if a download is pending. Background service workers cannot initiate downloads autonomously — the user must have triggered the extension action.
- **Permissions**: Add `"permissions": ["aiLanguageModelOriginTrial"]` (or `"ai"` in newer manifests) as needed per Chrome extension docs

### API changes to watch

Significant structural changes occurred between Chrome 138 and 141 (e.g., `window.translation` → `Translator`, method renames). Always use feature detection rather than version checks.

---

## 6. Limitations & Constraints

| Limitation | Detail |
|---|---|
| **Sequential processing** | Requests are queued and processed one at a time — no parallel translation |
| **Desktop only** | Mobile Chrome not supported |
| **Storage gating** | 22 GB free disk required; model deleted if storage drops below 10 GB |
| **User activation** | Download requires a user gesture (cannot silently pre-download in background) |
| **No rate limits documented** | No official rate limits, but sequential-only processing limits throughput |
| **API stability** | Experimental; breaking changes occurred between minor Chrome versions |
| **Privacy fingerprinting mitigation** | All language pairs reported as "downloadable" — cannot detect pre-installed pairs |
| **Not in Web Workers** | API unavailable in Worker contexts |
| **HTTPS required** | Secure context only |

---

## 7. Quality Assessment

### What we know

- Uses a dedicated **expert translation model** (not the Gemini Nano LLM) — purpose-built for translation, expected to be better than prompting Gemini Nano directly
- Described as "high-quality" in official docs but no independent BLEU/ChrF benchmarks for this API have been published
- Community feedback: mixed ratings for Chrome extensions using the API (e.g., "Translate with Gemini Nano" = 3.3/5, "Gemini Translator" = 4.4/5)

### Comparison to current live-translate engines

| Engine | JA→EN Quality | Latency | Offline | Notes |
|---|---|---|---|---|
| Chrome Translator API | Unknown (rough parity with Google Translate expected) | ~low | Yes (after download) | On-device, privacy-safe |
| HY-MT1.5-1.8B (current default) | Good | ~180ms | Yes | Confirmed good JA quality |
| Google Translate API | Good | ~100ms | No | 500K chars/month free |
| DeepL | Very good | ~100ms | No | Best for European pairs; JA quality debated |

**Verdict on quality:** The Chrome Translator API is likely comparable to Google Translate for JA↔EN, but inferior to DeepL and probably inferior to the tuned local model (HY-MT1.5-1.8B). No live-translate-specific benchmarking has been done. **Quality must be benchmarked before using as a primary engine.**

---

## 8. Recommendation

### Should we implement as a translation option in the Chrome extension?

**Yes, as an optional/fallback engine — not a default.**

**Reasons to implement:**
1. Zero operational cost after initial model download
2. Privacy-safe (no data leaves device)
3. Reduces dependency on desktop Electron app for extension users
4. Good alignment with the offline-capable requirement

**Reasons not to make it default:**
1. 22 GB free disk requirement will disqualify many users
2. Quality unverified for JA↔EN — needs benchmarking
3. Sequential-only processing limits throughput for rapid subtitle translation
4. API still evolving; breaking changes are frequent
5. Desktop-only — no path to mobile

### Recommended implementation plan

1. **Prototype** `Translator.create()` in a Chrome extension content/background script with JA↔EN
2. **Benchmark quality** against HY-MT1.5-1.8B and Google Translate using 100 representative JA sentences (conference/meeting domain)
3. **Add as optional engine** in extension settings (off by default)
4. **Implement graceful fallback**: if `availability === 'unavailable'` or language pair not supported, fall back to desktop relay (existing Electron app IPC)
5. **Do not block** on model download — show download progress and fall back immediately if not ready

### Integration architecture

```
Chrome Extension
├── background.js
│   ├── Check Translator.availability('ja', 'en')
│   ├── If available: use Translator.create() for translation
│   └── If unavailable: relay to Electron app via native messaging
└── content.js
    └── Capture audio/subtitle text → send to background
```

---

## References

- [Chrome Translator API docs](https://developer.chrome.com/docs/ai/translator-api)
- [Client-side translation with AI](https://developer.chrome.com/docs/ai/translate-on-device)
- [Get started with built-in AI](https://developer.chrome.com/docs/ai/get-started)
- [Built-in AI overview](https://developer.chrome.com/docs/ai/built-in/overview)
- [MDN: Translator and Language Detector APIs](https://developer.mozilla.org/en-US/docs/Web/API/Translator_and_Language_Detector_APIs)
- [Chrome Status: Translator API](https://chromestatus.com/feature/5172811302961152)
- [Half a year with Chrome Built-in AI (Aug 2025)](https://thangman22.com/2025/08/29/half-a-year-has-passed-lets-see-what-built-in-ai-on-chrome-can-do-today/)
- [Building Chrome Built-in AI Translation Demo](https://techhub.iodigital.com/articles/building-a-translation-demo-with-chromes-built-in-ai-apis)
