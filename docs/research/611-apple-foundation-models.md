# Apple Foundation Models JA↔EN Translation Adapter Research

**Issue:** #611
**Date:** 2026-04-10
**Status:** Research complete — viable with significant caveats (macOS 26+ only, adapter retraining per OS version)

---

## 1. Summary

Apple's Foundation Models framework (macOS 26+) exposes the on-device ~3B parameter LLM at the core of Apple Intelligence via a Swift API. Third-party apps can load custom LoRA adapters (rank 32, ~130-160MB) trained with Apple's Python toolkit. A community project (FoundationModelsTranslator) has already demonstrated EN→ZH translation using a custom adapter.

For live-translate, this represents a **zero-download translation engine**: the base model ships with macOS, and only a small adapter file (~150MB) needs bundling. ANE-native inference is extremely power-efficient (~1/10th GPU power consumption). No third-party translation app has shipped Foundation Models integration yet — this is a first-mover opportunity.

Key trade-off: macOS 26+ only, no Windows/Linux support, and adapters must be retrained for each OS version when Apple updates the base model.

---

## 2. Apple Foundation Models Framework Overview

### 2.1 Architecture

| Property | Value |
|---|---|
| Base model | ~3B parameter dense LLM |
| Quantization | Mixed 2-bit/4-bit palletization (avg 3.7 bits-per-weight) |
| Inference hardware | Apple Neural Engine (ANE) + GPU fallback |
| Token generation rate | ~30 tok/s on iPhone 15 Pro; estimated 40-60 tok/s on M-series Macs |
| Time-to-first-token | ~0.6ms per prompt token |
| Power efficiency | ~1/10th of GPU alternatives |
| Memory (ANE) | ~500MB (vs ~8GB for GPU path on 8B models) |
| Framework availability | macOS 26+, iOS 26+, iPadOS 26+, visionOS 26+ |

### 2.2 Swift API

The framework is accessed through `SystemLanguageModel`:

```swift
import FoundationModels

// Base model
let model = SystemLanguageModel.default

// Check availability
switch model.availability {
case .available:
    let session = LanguageModelSession(model: model)
    let response = try await session.respond(to: "Translate to English: こんにちは")
case .unavailable(let reason):
    // .deviceNotEligible, .appleIntelligenceNotEnabled, .modelNotReady
    break
}
```

### 2.3 Custom Adapter Loading

```swift
// Load custom adapter from bundled .fmadapter file
let adapter = try SystemLanguageModel.Adapter(fileURL: adapterURL)
// Or by registered name
let adapter = try await SystemLanguageModel.Adapter(name: "ja-en-translation")

let model = SystemLanguageModel.default
let session = LanguageModelSession(model: model, adapter: adapter)
let response = try await session.respond(to: sourceText)
```

### 2.4 Key Features

- **Guided Generation:** `@Generable` macro on Swift structs/enums for structured output at compile-time
- **Streaming:** `session.streamResponse(to:)` for token-by-token output
- **Tool Calling:** Model can invoke app-defined tools autonomously
- **Speculative Decoding:** FoundationModelsTranslator uses 5 draft tokens for faster inference

### 2.5 Python SDK (Beta)

Apple also provides `python-apple-fm-sdk` (pip install apple-fm-sdk) for Python-based inference on macOS 26+. This runs Foundation Models via Swift under the hood, ensuring evaluations reflect real on-device performance. Useful for benchmarking adapters before building the Swift helper.

---

## 3. Adapter Training Pipeline

### 3.1 Toolkit Overview

| Property | Value |
|---|---|
| Name | Foundation Models Adapter Training Toolkit |
| Access | Apple Developer Program membership required |
| Language | Python |
| LoRA rank | 32 (fixed) |
| Export format | `.fmadapter` package |
| Training hardware | Mac with Apple Silicon (32GB+ RAM) or Linux GPU |
| Dataset format | JSONL (prompt/completion pairs) |

### 3.2 Dataset Format

JSONL with role-based message pairs:

```jsonl
[{"role": "user", "content": "Translate the following Japanese text to English:\n今日の会議は午後3時からです。"}, {"role": "assistant", "content": "Today's meeting starts at 3 PM."}]
[{"role": "user", "content": "Translate the following English text to Japanese:\nThe quarterly report is due next Friday."}, {"role": "assistant", "content": "四半期報告書は来週の金曜日が期限です。"}]
```

Apple recommends 100–1,000 samples for basic tasks. For translation quality comparable to dedicated MT models, significantly more data (10K–100K+ pairs) is likely needed.

### 3.3 Training Command

```bash
python -m examples.train_adapter \
  --train-data train.jsonl \
  --eval-data eval.jsonl \
  --epochs 5 \
  --learning-rate 1e-4 \
  --batch-size 4 \
  --checkpoint-dir ./output
```

### 3.4 Export to .fmadapter

The toolkit includes utility functions to export the trained adapter in the `.fmadapter` package format that Xcode and the Foundation Models framework expect.

### 3.5 Version Compatibility Constraint

**Critical:** Each adapter is compatible with a single specific base model version. Apple updates the base model as part of OS updates — not every OS update changes the model, but when it does, the adapter must be retrained.

Implications:
- Must monitor Apple beta releases for base model changes
- Maintain a CI pipeline to retrain adapters promptly when a new toolkit version drops
- Ship multiple adapter versions to support users on different OS versions
- No API exists to query which base model version is running on a user's device

### 3.6 Community Reference: FoundationModelsTranslator

FradSer's FoundationModelsTranslator (EN→ZH) provides a working reference implementation:

| Property | Value |
|---|---|
| Direction | English → Chinese (Simplified) |
| Adapter size | ~133MB (adapter_weights.bin + metadata) |
| Training data | ~100K samples (multi-dataset, intelligently sampled) |
| LoRA rank | 32 |
| Speculative decoding | 5 draft tokens |
| Fallback | Graceful degradation to base model if adapter fails |
| License | MIT |

This validates the feasibility of training translation adapters. However, EN→ZH and JA↔EN are different tasks — JA↔EN quality needs independent validation.

---

## 4. Training Data Requirements

### 4.1 JA↔EN Parallel Corpus Options

| Corpus | Size | Domain | License | Notes |
|---|---|---|---|---|
| JParaCrawl v3.0 | 21M+ sentence pairs | Web-crawled (general) | Free for research | Best coverage; NTT-curated; good pre-training base |
| JESC | ~3.2M pairs | Movie/TV subtitles | CC-BY | Conversational register; good for meeting/casual translation |
| WMT JA-EN | ~15K pairs (test sets) | News | Free | Small; useful for evaluation, not training |
| Tatoeba JA-EN | ~200K pairs | Short example sentences | CC-BY | Good supplementary data for short utterances |
| Business Scene Dialogue | ~1M pairs | Business meetings | Restricted | Ideal domain match but license needs verification |

### 4.2 Recommended Data Strategy

For live-translate's meeting translation use case:

1. **Base training:** JParaCrawl v3.0 filtered subset (100K–200K high-quality pairs)
2. **Domain fine-tuning:** JESC (conversational), filtered for quality
3. **Evaluation set:** WMT JA-EN test sets (standard MT benchmark)
4. **Bidirectional:** Separate adapters for JA→EN and EN→JA, or a single bidirectional adapter with direction prefix in the prompt

### 4.3 Data Preparation Pipeline

1. Download raw corpora (JParaCrawl, JESC)
2. Filter by quality score (JParaCrawl includes alignment scores)
3. Deduplicate and normalize (remove HTML, fix encoding)
4. Convert to Apple JSONL format with translation instruction prompts
5. Split 90/10 train/eval
6. Verify schema against toolkit's Schema.md

---

## 5. Integration Architecture

### 5.1 Overview

```
Electron Main Process
  │
  ├── AppleFoundationModelsTranslator.ts (engine interface)
  │     │
  │     └── Spawns Swift Helper Process (stdio JSON-RPC)
  │           │
  │           ├── Loads Foundation Models framework
  │           ├── Loads .fmadapter from app bundle
  │           └── Returns translation via stdout JSON
  │
  └── Falls back to HY-MT1.5-1.8B on pre-macOS 26
```

### 5.2 Swift Helper Process

Electron cannot directly call Foundation Models (Swift-only framework). The established pattern is a **compiled Swift CLI binary** that communicates via JSON-over-stdio:

**Why Swift CLI over other approaches:**
- Electron's official docs recommend native Swift for macOS-specific APIs
- `child_process.spawn()` with stdio pipes is the simplest IPC pattern
- XPC services are overkill for a single-purpose translation helper
- The Python SDK (`apple-fm-sdk`) could work but adds a Python dependency; native Swift is leaner

**Swift helper design:**

```swift
// fm-translator (compiled Swift CLI)
import Foundation
import FoundationModels

struct TranslateRequest: Codable {
    let text: String
    let direction: String  // "ja-en" or "en-ja"
}

struct TranslateResponse: Codable {
    let translation: String
    let tokensPerSecond: Double
}

@main
struct FMTranslator {
    static func main() async throws {
        let adapter = try SystemLanguageModel.Adapter(
            fileURL: URL(fileURLWithPath: CommandLine.arguments[1])
        )
        let session = LanguageModelSession(
            model: .default,
            adapter: adapter
        )

        // Read JSON requests from stdin, write JSON responses to stdout
        while let line = readLine() {
            let request = try JSONDecoder().decode(TranslateRequest.self, from: Data(line.utf8))
            let response = try await session.respond(to: request.text)
            let json = try JSONEncoder().encode(
                TranslateResponse(translation: response.content, tokensPerSecond: 0)
            )
            print(String(data: json, encoding: .utf8)!)
            fflush(stdout)
        }
    }
}
```

**TypeScript engine side:**

```typescript
// AppleFoundationModelsTranslator.ts
class AppleFoundationModelsTranslator implements TranslatorEngine {
    private process: ChildProcess | null = null;

    async initialize(): Promise<void> {
        const helperPath = path.join(app.getAppPath(), 'resources', 'fm-translator');
        const adapterPath = path.join(app.getPath('userData'), 'adapters', 'ja-en.fmadapter');
        this.process = spawn(helperPath, [adapterPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    }

    async translate(text: string, context?: TranslateContext): Promise<string> {
        // Send JSON request via stdin, read JSON response from stdout
    }

    async dispose(): Promise<void> {
        this.process?.kill();
    }
}
```

### 5.3 Build & Distribution

- Swift helper compiled as a standalone macOS binary via `swift build -c release`
- Binary bundled in `resources/` directory of the Electron app
- `.fmadapter` file (~150MB) bundled with the app or downloaded on first launch
- Code-signed with the same team ID as the Electron app (required for entitlements)
- macOS 26+ deployment target; Xcode 26+ required for building

### 5.4 Fallback Strategy

```
if macOS >= 26 && Apple Intelligence enabled:
    use AppleFoundationModelsTranslator (zero download, ANE-optimized)
else:
    use HY-MT1.5-1.8B (current fast default, ~1GB download)
```

Detection via `SystemLanguageModel.default.availability` in the Swift helper, with the result communicated back to Electron during initialization.

---

## 6. Performance Estimates

### 6.1 Latency Comparison

| Engine | Est. Latency (avg sentence) | Memory | Download Required |
|---|---|---|---|
| **Apple FM + adapter** | ~200-400ms (est.) | ~500MB (ANE) | None (adapter ~150MB bundled) |
| HY-MT1.5-1.8B | ~180ms | ~1GB | ~1GB GGUF |
| LFM2-350M | ~50ms | ~230MB | ~230MB |
| Hunyuan-MT 7B | 3.7s (JA→EN) | ~4GB | ~2.6GB GGUF |

**Estimation basis:** Apple reports 30 tok/s on iPhone 15 Pro. M-series Macs should achieve 40-60 tok/s. A typical translated sentence (20-30 tokens) would take 300-750ms at 30 tok/s, or 200-500ms at 60 tok/s. Speculative decoding (as used by FoundationModelsTranslator) could improve this by 1.5-2x.

### 6.2 Advantages

- **Zero model download:** Base model ships with macOS; only ~150MB adapter needed
- **ANE power efficiency:** ~1/10th power of GPU inference — critical for laptop battery life
- **No GGUF/llama.cpp dependency:** Uses Apple's native inference stack
- **Minimal memory footprint:** ~500MB on ANE vs 1-4GB for current local engines
- **Privacy:** All inference on-device, no data leaves the machine

### 6.3 Disadvantages

- **macOS 26+ only:** No Windows, no Linux, no older macOS versions
- **Adapter retraining per OS version:** Ongoing maintenance burden
- **Unproven JA↔EN quality:** 3B base model may underperform dedicated MT models (HY-MT 1.8B was specifically trained for translation)
- **No BLEU/COMET benchmarks available** for Foundation Models translation tasks
- **Apple Developer Program required** to access training toolkit

---

## 7. Evaluation Plan

### 7.1 Phase 1: Quality Assessment (Python SDK)

1. Install `apple-fm-sdk` on macOS 26 dev machine
2. Test base model (no adapter) on JA↔EN translation to establish baseline
3. Train minimal adapter with 10K JParaCrawl pairs as proof of concept
4. Evaluate with WMT JA-EN test set using BLEU and COMET metrics
5. Compare against HY-MT1.5-1.8B on same test set

### 7.2 Phase 2: Adapter Optimization

1. Scale training data to 100K pairs (JParaCrawl + JESC mix)
2. Experiment with bidirectional vs separate JA→EN / EN→JA adapters
3. Optimize prompt template for translation task
4. Measure quality improvement curve (10K → 50K → 100K pairs)

### 7.3 Phase 3: Integration Prototype

1. Build Swift helper CLI with stdio JSON-RPC
2. Implement `AppleFoundationModelsTranslator.ts` engine
3. Measure end-to-end latency (IPC overhead + inference)
4. Test streaming output for subtitle display

### 7.4 Quality Gate

| Metric | Minimum Threshold | Target |
|---|---|---|
| BLEU (JA→EN, WMT) | ≥ HY-MT1.5-1.8B | +5% over HY-MT1.5 |
| COMET (JA→EN) | ≥ 0.80 | ≥ 0.85 |
| Latency (avg sentence) | < 500ms | < 300ms |
| Memory (ANE) | < 1GB | < 500MB |

If quality does not meet minimum thresholds after Phase 2, this engine should remain experimental-only and not be added to the primary UI.

---

## 8. Risks and Limitations

| Risk | Severity | Mitigation |
|---|---|---|
| macOS 26+ only (no Windows/Linux) | High | Fallback to existing engines; FM is additive, not a replacement |
| Adapter retraining per OS update | High | CI pipeline to monitor Apple betas and retrain promptly |
| No API to detect base model version | Medium | Ship multiple adapter versions, try loading and handle failure |
| 3B model quality ceiling for translation | High | Empirical benchmarking in Phase 1 before committing to full integration |
| Apple Developer Program requirement | Low | Already required for Electron code signing |
| Swift helper binary size | Low | Estimated ~5-10MB compiled; negligible vs adapter size |
| Apple Intelligence must be enabled by user | Medium | Clear user-facing message explaining requirement |
| Adapter file size (~150MB) increases app bundle | Medium | Consider on-demand download vs bundling |
| No independent translation benchmarks exist | High | Must run own evaluation — cannot rely on community data |
| Foundation Models SDK for Python is Beta | Low | Use for evaluation only; production path is native Swift |

---

## 9. Recommendation

**Proceed with Phase 1 evaluation using Python SDK once macOS 26 is available.**

This engine is compelling as a zero-download, power-efficient translation option for Mac users, but the unproven JA↔EN quality of the 3B base model is the critical unknown. The evaluation plan is designed to answer this question early (Phase 1) before investing in Swift helper integration (Phase 3).

### Priority rationale:
- **First-mover advantage** is real but time-limited — other translation apps will discover this approach
- **Zero-download UX** is a significant differentiator for onboarding experience
- **Low incremental cost** — the adapter training infrastructure (Python, JSONL) is straightforward
- **No risk to existing engines** — this is purely additive as a macOS-specific option

### Decision points:
| Phase 1 Result | Action |
|---|---|
| Quality ≥ HY-MT1.5 AND latency < 500ms | Proceed to Phase 3, target primary engine on macOS 26+ |
| Quality < HY-MT1.5 but usable | Keep as experimental; revisit when Apple updates base model |
| Quality significantly below HY-MT1.5 | Abandon; 3B general model is insufficient for MT tasks |

---

## References

- Apple Foundation Models documentation: https://developer.apple.com/documentation/FoundationModels
- Foundation Models adapter training toolkit: https://developer.apple.com/apple-intelligence/foundation-models-adapter/
- WWDC25 — Meet the Foundation Models framework: https://developer.apple.com/videos/play/wwdc2025/286/
- WWDC25 — Deep dive into the Foundation Models framework: https://developer.apple.com/videos/play/wwdc2025/301/
- Loading and using a custom adapter: https://developer.apple.com/documentation/foundationmodels/loading-and-using-a-custom-adapter-with-foundation-models
- SystemLanguageModel API reference: https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel
- Apple Foundation Models tech report 2025: https://machinelearning.apple.com/research/apple-foundation-models-tech-report-2025
- Apple Foundation Models 2025 updates: https://machinelearning.apple.com/research/apple-foundation-models-2025-updates
- python-apple-fm-sdk (Python bindings): https://github.com/apple/python-apple-fm-sdk
- FoundationModelsTranslator (EN→ZH community project): https://github.com/FradSer/FoundationModelsTranslator
- AFMTrainer (GUI wrapper for adapter training): https://github.com/scouzi1966/AFMTrainer
- Electron native code — Swift (macOS): https://www.electronjs.org/docs/latest/tutorial/native-code-and-electron-swift-macos
- JParaCrawl v3.0 paper: https://aclanthology.org/2022.lrec-1.721/
- JParaCrawl filtered dataset (HuggingFace): https://huggingface.co/datasets/Verah/JParaCrawl-Filtered-English-Japanese-Parallel-Corpus
- JESC (Japanese-English Subtitle Corpus): https://paperswithcode.com/dataset/jesc
- Apple Intelligence Foundation Language Models paper: https://arxiv.org/html/2507.13575v3
- ANE characterization (Orion): https://arxiv.org/html/2603.06728v1
