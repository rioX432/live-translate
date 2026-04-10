# Adaptive SimulMT Policy Replacing Fixed Wait-k

**Issue:** #612
**Date:** 2026-04-10
**Status:** Research complete — confidence-weighted adaptive policy recommended, extending existing ClauseBoundaryDetector

## 1. Summary

The current `StreamingProcessor` uses a fixed wait-k policy combined with `ClauseBoundaryDetector` for simultaneous translation. Recent research — SimulPL (ICLR 2025), DaP-SiMT, TAF, and CUNI's IWSLT 2025 winning system — demonstrates that adaptive read/write policies significantly outperform fixed wait-k, especially for structurally divergent language pairs like JA↔EN (SOV↔SVO). This document surveys the state of the art and proposes a confidence-weighted adaptive boundary policy that builds on the existing particle-based `ClauseBoundaryDetector` while adding divergence-based write decisions.

## 2. Background & Motivation

### 2.1 Current Implementation

The existing SimulMT pipeline (`StreamingProcessor.handleSimulMtStreaming()`) works as follows:

1. **Fixed wait-k gate**: `countUnits(text, lang) < waitK` blocks translation until k units arrive
2. **Clause boundary detection**: `detectClauseBoundary()` finds the last particle boundary (JA) or whitespace boundary (EN) and returns a `stablePrefix` / `pendingSuffix` split
3. **Incremental translation**: `translator.translateSimulMt()` uses KV cache reuse for low-latency incremental output
4. **LocalAgreement**: Stabilizes STT output by comparing consecutive transcription results

The fixed wait-k approach has two problems:
- **Under-waiting at verb boundaries (JA→EN)**: Japanese verbs appear clause-finally (SOV); translating at a particle boundary before the verb arrives forces the MT model to hallucinate or reorder without the main predicate
- **Over-waiting at conjunctive boundaries**: Particles like けど/ので/から mark clause endings where translation can safely proceed, but the fixed threshold doesn't distinguish these from mid-clause particles like を/に

### 2.2 Why Adaptive Matters for JA↔EN

Japanese-English is among the most challenging SimulMT pairs due to near-complete word order reversal:
- **JA→EN (SOV→SVO)**: The English verb must be generated before the Japanese verb has been spoken. Human interpreters solve this by anticipating verbs from context or restructuring into passive/nominal constructions.
- **EN→JA (SVO→SOV)**: The Japanese verb must wait until the English predicate + object are both received, requiring longer buffering.

CUNI's IWSLT 2025 system achieved 13–22 BLEU improvement on EN→JA/DE/ZH by using offline models (Whisper + EuroLLM) with adaptive SimulStreaming policies (AlignAtt, LocalAgreement), confirming that adaptive policies are essential for these language pairs.

## 3. Literature Review

### 3.1 SimulPL — Preference Learning for SimulMT (ICLR 2025)

**Paper:** arXiv:2502.00634 | **Venue:** ICLR 2025

SimulPL frames SimulMT as a preference optimization problem with five human preference dimensions:

| Preference | Metric | Relevance to live-translate |
|---|---|---|
| Translation quality | BLEU/COMET | Core metric |
| Monotonicity | Reordering distance | Critical for JA↔EN (high reordering) |
| Key point preservation | Key-phrase recall | Important for meeting context |
| Simplicity | Dependency tree depth | Simpler output = faster reading for subtitles |
| Latency | Average lagging (AL) | Must stay under ~2s for real-time overlay |

**Method:** Multi-task Supervised Fine-tuning (MSFT) jointly trains translation + read/write policy, followed by SimulDPO (preference optimization with latency penalty integrated). GPT-4o generates preference pairs for training data.

**Takeaway for live-translate:** The five-preference framework is useful for evaluation design. However, SimulPL requires DPO fine-tuning of the MT model, which is impractical for our frozen GGUF models (HY-MT1.5-1.8B, PLaMo-2 10B). The preference dimensions should inform our evaluation metrics instead.

### 3.2 DaP-SiMT — Divergence-based Adaptive Policy

**Paper:** arXiv:2310.14853 | **Published:** EMNLP 2023, journal version in IJMLC 2025

DaP decouples the read/write policy from the translation model by training a lightweight policy network that measures **translation distribution divergence** between partial and complete source input:

- **Core idea:** If seeing more source tokens would significantly change the translation distribution, READ more. If the distribution is stable, WRITE.
- **Implementation:** A small classifier over encoder/decoder states predicts divergence. Trained with automatically generated labels (compare translation distributions with partial vs. full input).
- **Key advantage:** Works as a plug-in on top of any frozen wait-k model. Memory and compute efficient.

**Takeaway for live-translate:** DaP's architecture — lightweight policy network on top of a frozen MT model — maps directly to our setup. We can approximate divergence scoring without retraining the translator by comparing confidence scores or token probabilities from the LLM worker.

### 3.3 TAF — Translation by Anticipating Future (NAACL 2025)

**Paper:** arXiv:2410.22499 | **Venue:** NAACL 2025

TAF uses an LLM to predict future source words and speculatively translate multiple continuations:

1. LLM generates N possible continuations of the partial source input
2. Each continuation is translated by the MT model
3. Majority voting selects the translation prefix agreed upon by most candidates

**Results:** Up to +5 BLEU at latency of 3 words across 4 language directions. Longer document context improves LLM predictions.

**Takeaway for live-translate:** TAF is elegant but expensive — running N MT inferences per step is not viable at ~180ms/translation on our target hardware. However, the insight that **source continuation prediction reduces latency** can be applied more cheaply: use the LLM worker to predict the next 1–2 Japanese words (especially verb predictions) to decide whether to wait or write.

### 3.4 CUNI SimulStreaming — IWSLT 2025 Winner

**Paper:** arXiv:2506.17077 | **Venue:** IWSLT 2025

CUNI's winning system uses a cascaded approach (Whisper ASR → EuroLLM translation) with two simultaneous policies:

- **AlignAtt:** Attention-alignment-based read/write policy (requires access to cross-attention weights)
- **LocalAgreement:** When attention weights are unavailable (e.g., EuroLLM), falls back to comparing consecutive translation outputs — translate only the prefix that is stable across runs

**Results:** Top-scoring system for EN→JA (human evaluation), EN→DE, EN→ZH. 13–22 BLEU improvement over SeamlessM4T baseline. Operates in 4–5s latency regime.

**Takeaway for live-translate:** We already implement `LocalAgreement` for STT stabilization. The same concept can be applied to translation output — only emit translation prefixes that are stable across consecutive MT calls. This is directly implementable without model changes.

### 3.5 AliBaStr-MT — On-Device Streaming MT

**Paper:** arXiv:2508.13358

AliBaStr-MT enables streaming translation in pretrained non-streaming encoder/decoder models by adding a lightweight read/write policy module:

- **Policy learning:** Binary classifier over encoder/decoder states, trained with pseudo-labels derived from non-monotonic attention weights of the pretrained model
- **On-device focus:** Designed for mobile/edge deployment, balancing quality and latency constraints
- **Results:** Outperforms baseline streaming models in BLEU while maintaining competitive latency

**Takeaway for live-translate:** The pseudo-label generation from attention weights is relevant if we gain access to attention scores from the LLM worker. The on-device constraint aligns with our Electron desktop target.

### 3.6 IWSLT 2026 Simultaneous Track

IWSLT 2026 (co-located with ACL 2026, San Diego, July 3–4) continues the simultaneous translation shared task with EN→JA as a primary direction. Evaluation uses LongYAAL metric via OmniSTEval with two latency regimes (low/high). This confirms EN→JA SimulMT remains an active research focus and provides a benchmark framework we can adopt for evaluation.

## 4. JA-Specific Considerations

### 4.1 SOV→SVO Reordering Challenge

Japanese clause structure follows Subject + (modifiers) + Object + Verb, while English requires Subject + Verb + Object. This creates a fundamental timing problem:

```
JA input:  私は | 東京で | 友達と | 会議を | しました
           (I)   (in Tokyo) (with friend) (meeting) (did)
                                                     ↑ verb arrives last

EN output: I had a meeting with a friend in Tokyo
              ↑ verb needed early
```

At the particle boundary after を, the current detector would try to translate "I [something] meeting" — but cannot produce the verb "had" until しました arrives.

### 4.2 Particle-Level Confidence Classification

Not all particles carry equal signal for translation readiness:

| Category | Particles | Wait Behavior |
|---|---|---|
| **Clause-ending (safe to translate)** | けど, ので, から, ため, けれど | Immediate WRITE — clause is semantically complete |
| **Topic/subject markers** | は, が | WRITE if followed by enough content (≥3 units) |
| **Case particles (mid-clause)** | を, に, で, と | READ more — verb likely pending |
| **Conjunctive** | も, まで, より | Context-dependent |

The current `ClauseBoundaryDetector` treats all particles equally. An adaptive policy should weight clause-ending particles much higher than mid-clause case particles.

### 4.3 Te-form and Verb Conjugation Boundaries

Japanese te-form (〜て/〜で) marks clause chaining and is a strong translation trigger — the preceding clause is complete. Similarly, verb endings like 〜ます/〜ました/〜ている signal clause completion. These patterns are not currently detected by `ClauseBoundaryDetector`.

## 5. Proposed Approach: Confidence-Weighted Boundary Policy

### 5.1 Design Principles

1. **No model retraining required** — policy operates on top of frozen GGUF translators
2. **Extend existing ClauseBoundaryDetector** — not replace it
3. **Lightweight** — adds <10ms overhead per decision
4. **Tunable** — confidence thresholds adjustable per language pair

### 5.2 Architecture

```
                          ┌─────────────────────────┐
  STT output ────────────►│  AdaptiveBoundaryPolicy  │
                          │                           │
                          │  1. ClauseBoundaryDetector │
                          │     (particle detection)   │
                          │                           │
                          │  2. BoundaryClassifier     │
                          │     (confidence scoring)   │
                          │                           │
                          │  3. TranslationAgreement   │
                          │     (output stability)     │
                          └───────────┬───────────────┘
                                      │
                              READ or WRITE decision
                                      │
                                      ▼
                          ┌─────────────────────────┐
                          │   StreamingProcessor     │
                          │   translateSimulMt()     │
                          └─────────────────────────┘
```

### 5.3 Three-Layer Decision

**Layer 1 — Boundary Classification (extends ClauseBoundaryDetector)**

Assign confidence scores to detected boundaries:

```typescript
interface AdaptiveBoundary extends ClauseBoundary {
  confidence: number       // 0.0–1.0: how safe to translate here
  boundaryType: 'clause-end' | 'topic' | 'case' | 'conjunctive' | 'verb-end' | 'whitespace'
}
```

Scoring rules (JA):
- Clause-ending particles (けど/ので/から/ため): confidence 0.9
- Verb endings (〜ました/〜ます/〜ている/〜た/〜て): confidence 0.85
- Topic marker (は) with ≥3 following units: confidence 0.7
- Subject marker (が) with ≥3 following units: confidence 0.6
- Case particles (を/に/で) with <3 following units: confidence 0.3
- Case particles with ≥5 following units: confidence 0.5

**Layer 2 — Divergence Approximation (inspired by DaP)**

Without access to model internals, approximate divergence by comparing the current translation candidate with the previous one:

```typescript
function estimateDivergence(
  currentTranslation: string,
  previousTranslation: string
): number {
  // Normalized edit distance as divergence proxy
  // High divergence = translation is unstable = READ more
  // Low divergence = translation is stable = safe to WRITE
}
```

**Layer 3 — Translation Agreement (inspired by CUNI LocalAgreement)**

Apply LocalAgreement at the translation output level (not just STT):
- Run translation on current partial input
- Compare with previous translation output
- Only emit the agreed-upon prefix

### 5.4 Decision Logic

```typescript
function shouldWrite(
  boundary: AdaptiveBoundary,
  divergence: number,
  unitCount: number,
  minUnits: number  // replaces fixed waitK
): boolean {
  // Always wait for minimum units
  if (unitCount < minUnits) return false

  // High-confidence boundaries override divergence
  if (boundary.confidence >= 0.85) return true

  // Low divergence + medium confidence = write
  if (boundary.confidence >= 0.5 && divergence < 0.3) return true

  // High divergence = always read more
  if (divergence > 0.7) return false

  // Default: write if enough units accumulated beyond threshold
  return unitCount >= minUnits + 5
}
```

### 5.5 Integration Points

| File | Change |
|---|---|
| `ClauseBoundaryDetector.ts` | Add `detectAdaptiveBoundary()` returning `AdaptiveBoundary` with confidence scores; add verb-ending detection patterns |
| `StreamingProcessor.ts` | Replace fixed `unitCount < waitK` gate with `AdaptiveBoundaryPolicy.shouldWrite()` call |
| `TranslationPipeline.ts` | Add `getSimulMtConfig()` to include adaptive policy parameters |
| New: `AdaptiveBoundaryPolicy.ts` | Orchestrates three-layer decision, maintains divergence history |
| Settings UI | Replace "Wait-k" slider with "Latency preference" (low/balanced/quality) preset |

## 6. Evaluation Plan

### 6.1 Metrics (aligned with SimulPL preferences)

| Metric | Tool | Target |
|---|---|---|
| Translation quality | BLEU, COMET | ≥ current fixed wait-k scores |
| Latency | Average Lagging (AL), end-to-end wall time | AL < 3 words (EN) / < 5 chars (JA) |
| Flicker rate | Count of changed translation prefixes per utterance | < current rate |
| Subtitle readability | Dependency tree depth (SimulPL's simplicity metric) | Lower = better |

### 6.2 Test Data

- IWSLT tst-COMMON EN→JA / JA→EN sets
- Internal meeting recordings (bilingual, real conversational speech)
- Synthetic stress tests: rapid speaker, long compound sentences, code-switching

### 6.3 A/B Comparison

1. **Baseline:** Current fixed wait-k=5 + ClauseBoundaryDetector
2. **Adaptive-v1:** Confidence-weighted boundary only (Layer 1)
3. **Adaptive-v2:** Confidence + divergence approximation (Layers 1+2)
4. **Adaptive-v3:** Full three-layer policy (Layers 1+2+3)

Each variant benchmarked on quality (BLEU/COMET), latency (AL), and flicker rate.

## 7. Implementation Notes

### 7.1 Phased Rollout

**Phase 1 — Confidence-weighted boundaries (low risk)**
- Extend `ClauseBoundaryDetector` with confidence scoring and verb-ending detection
- Add `AdaptiveBoundaryPolicy.ts` with Layer 1 only
- Replace fixed wait-k gate in `StreamingProcessor`
- Ship behind existing SimulMT feature flag

**Phase 2 — Divergence approximation**
- Add edit-distance-based divergence estimation
- Integrate as Layer 2 in `AdaptiveBoundaryPolicy`
- Requires running translation twice per step (current + speculative) — evaluate latency impact

**Phase 3 — Translation agreement**
- Apply LocalAgreement pattern to translation output
- Reduces subtitle flicker but increases latency by one translation cycle
- Gate behind "quality" preset

### 7.2 Performance Budget

The adaptive policy must add <10ms overhead per decision. Boundary classification is pure string matching (current `detectClauseBoundary` is <1ms). Divergence estimation (normalized edit distance) is O(n*m) on short strings (<100 chars) — typically <1ms. The main cost is in Phase 2 where speculative translation adds ~180ms (one extra HY-MT1.5 call).

### 7.3 Risks

- **False clause-end detection:** Japanese て-form can be mid-sentence (listing actions). Mitigation: require ≥2 content words before a て-boundary triggers WRITE.
- **Divergence noise from STT instability:** Unstable STT output causes spurious divergence signals. Mitigation: apply divergence scoring only to LocalAgreement-confirmed text.
- **Latency regression in Phase 2:** Double translation calls may exceed budget. Mitigation: run speculative translation only when boundary confidence is in the 0.4–0.7 uncertain range.

## 8. References

- [SimulPL: Aligning Human Preferences in Simultaneous Machine Translation (ICLR 2025)](https://arxiv.org/abs/2502.00634)
- [DaP: Adaptive Policy with Wait-k Model for Simultaneous Translation (EMNLP 2023)](https://arxiv.org/abs/2310.14853)
- [DaP-SiMT: Divergence-based Adaptive Policy (IJMLC 2025)](https://link.springer.com/article/10.1007/s13042-024-02323-z)
- [TAF: Anticipating Future with LLM for Simultaneous MT (NAACL 2025)](https://arxiv.org/abs/2410.22499)
- [CUNI IWSLT 2025: SimulStreaming with Whisper + EuroLLM](https://arxiv.org/abs/2506.17077)
- [CUNI top-scoring system announcement](https://elitr.eu/iwslt25/)
- [AliBaStr-MT: On-Device Streaming MT with Alignment-Based Policy](https://arxiv.org/abs/2508.13358)
- [IWSLT 2026 Simultaneous Track](https://iwslt.org/2026/simultaneous)
- [SimulStreaming GitHub (CUNI)](https://github.com/ufal/SimulStreaming)
- [AlignAtt: Attention-based Alignments for Simultaneous Speech Translation](https://arxiv.org/abs/2305.11408)
- [Agent-SiMT: Agent-assisted SimulMT with LLMs](https://arxiv.org/abs/2406.06910)
- [SeqPO-SiMT: Sequential Policy Optimization for SimulMT](https://arxiv.org/abs/2505.20622)
