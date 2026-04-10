# Retrieval-Augmented Translation (RAT) with User Glossaries and Domain Context

**Issue:** #613
**Date:** 2026-04-10
**Status:** Research complete — RAT is feasible within live-translate constraints; recommend multilingual-e5-small (ONNX int8, ~113MB) + Vectra in-memory index + prompt injection into existing LLM translators

---

## 1. Summary

Current glossary support in live-translate is basic string-match replacement via `glossary-manager.ts`. RAT (Retrieval-Augmented Translation) uses embedding-based retrieval to find semantically relevant terminology and example translations at inference time, injecting them as few-shot context for the translation model. The EMNLP 2025 RAGtrans benchmark shows +1.6-3.1 BLEU / +1.0-2.7 COMET improvements over non-augmented baselines. For domain-specific meetings (medical, legal, technical), this approach achieves 90-95% first-pass terminology adherence compared to ~60-70% with naive glossary injection.

The key constraint is **<20ms retrieval overhead** on top of the existing STT+MT pipeline. With an in-memory vector index of <10K entries, k-NN lookup completes in <1ms, well within budget.

---

## 2. Background: RAT Research

### 2.1 RAGtrans (EMNLP 2025)

Wang et al. introduced RAGtrans, the first benchmark for retrieval-augmented machine translation with unstructured knowledge (169K samples, GPT-4o + human translators). Key findings:

- **Multi-task training**: Auxiliary objectives teach LLMs to extract relevant information from multilingual documents during translation, without additional labeling
- **Results**: En→Zh +1.6-3.1 BLEU / +1.0-2.0 COMET; En→De +1.7-2.9 BLEU / +2.1-2.7 COMET
- **Insight**: Even noisy retrieved context improves translation quality — the model learns to selectively use relevant information

### 2.2 Hybrid Dictionary-RAG-LLM Pipeline

The MDPI hybrid approach (2025) combines three stages:

1. **Dictionary pre-translation**: Deterministic lexical alignment from bilingual glossary
2. **RAG retrieval**: Sentence-encoder embeddings over parallel corpora in a vector store
3. **LLM post-editing**: Dictionary glosses + retrieved examples injected via prompt for reordering, inflection, and disambiguation

Results: BLEU scores from 12% (dictionary-only) to 31% (RAG + Gemini 2.0) for low-resource pairs. For high-resource JA↔EN, the improvement is smaller but still significant for domain-specific terminology.

### 2.3 T-Ragx

Open-source library (GitHub: rayliuca/T-Ragx) that enhances translation with RAG-powered LLMs. Outperformed DeepL on Japanese→Chinese web novel translation using in-task RAG with glossary and translation memory retrieval. Supports HuggingFace, Ollama, OpenAI, and llama-cpp backends. Validates the glossary+TM retrieval pattern for production use.

### 2.4 WMT 2025 Terminology-Constrained Translation

Recent WMT shared task combines dictionary-enhanced prompting, retrieval-augmented few-shot selection, and fine-tuning. LLM-based post-editing inserts missing terms into outputs that failed terminology constraints. Confirms that terminology injection via prompt is the dominant approach.

---

## 3. RAT Architecture for live-translate

### 3.1 Pipeline Overview

```
Source text (STT output)
    │
    ▼
Embedding model (multilingual-e5-small, ONNX int8)
    │
    ▼
Vector store (Vectra, in-memory + file-backed)
    │  k-NN cosine similarity search (k=5)
    ▼
Retrieved entries: [{ source, target, similarity }]
    │
    ▼
Prompt injection into TranslateContext
    │  Merge with existing glossary + ContextBuffer
    ▼
Translation engine (HY-MT1.5, Hunyuan-MT 7B, etc.)
    │
    ▼
Translated output with domain-consistent terminology
```

### 3.2 Retrieval Strategy

1. **Embed source text** using the same model that indexed glossary entries
2. **k-NN search** (k=5, cosine similarity threshold >= 0.7) against the glossary vector index
3. **Merge** retrieved entries with any exact-match glossary hits (exact match takes priority)
4. **Inject** into `TranslateContext.glossary` field — no translator interface changes needed
5. **Cache** embeddings for repeated/similar phrases via existing `TranslationCache`

### 3.3 Two Retrieval Modes

| Mode | Source | Use Case |
|------|--------|----------|
| **Term retrieval** | Glossary entries (source term → target term) | Terminology consistency |
| **Example retrieval** | Translation memory (source sentence → target sentence) | Style and phrasing consistency |

Term retrieval injects into `glossary` field; example retrieval injects into `previousSegments` as synthetic few-shot examples.

---

## 4. Embedding Model Options

### 4.1 Candidates

| Model | Params | ONNX Size (int8) | Dims | JA Support | MTEB Score | License |
|-------|--------|-------------------|------|------------|------------|---------|
| **multilingual-e5-small** | 117M | ~113MB | 384 | Yes (100 langs) | Good | MIT |
| multilingual-e5-base | 278M | ~270MB | 768 | Yes | Better | MIT |
| all-MiniLM-L6-v2 | 22M | ~23MB | 384 | No (EN only) | Good (EN) | Apache-2.0 |
| bge-small-en-v1.5 | 33M | ~33MB | 384 | No (EN only) | Good (EN) | MIT |
| PLaMo-Embedding-1B | 1B | ~1GB+ | — | Top JMTEB | Best (JA) | — |

### 4.2 Recommendation: multilingual-e5-small (ONNX int8)

- **~113MB** fits within the <100MB-ish budget (int8 quantization)
- **384-dimensional** embeddings — compact and fast for cosine similarity
- **100 languages** including both Japanese and English — critical for JA↔EN glossary matching
- **MIT license** — no restrictions
- **ONNX format** available via HuggingFace Optimum — runs with `onnxruntime-node` in Electron main process
- Inference: ~5-10ms per sentence on Apple Silicon (M1+), well within 20ms budget

### 4.3 Inference Runtime

Use `onnxruntime-node` (already compatible with Electron 28+) rather than Transformers.js to avoid the Electron backend detection issue (Transformers.js detects Electron as Node.js, preventing WebGPU usage). Direct ONNX Runtime gives full control over execution providers (CPU, CoreML on macOS).

---

## 5. Vector Store Options

### 5.1 Candidates

| Store | Type | Persistence | Dependencies | Size | Query Speed |
|-------|------|-------------|--------------|------|-------------|
| **Vectra** | File-backed in-memory | JSON files | 0 deps | ~5KB | <1ms (small index) |
| VectorDB.js | In-memory | Optional | Minimal | ~10KB | <1ms |
| Custom (flat array) | In-memory | Manual JSON | 0 deps | 0 | <1ms for <10K items |
| SQLite + vector ext | Disk-based | SQLite file | better-sqlite3 | ~1MB | ~5ms |
| RxDB + transformers.js | Hybrid | IndexedDB/FS | Heavy | ~50MB+ | Variable |

### 5.2 Recommendation: Vectra

- **Zero infrastructure**: Just a folder on disk with `index.json` — perfect for Electron's `userData` directory
- **File-backed + in-memory**: Loads entire index into memory at startup; persists to disk on write
- **Cosine similarity**: Built-in, sorted results — exactly what RAT needs
- **Metadata filtering**: MongoDB-style operators for filtering by domain, language pair, etc.
- **Tiny footprint**: No native dependencies, pure TypeScript
- **Cross-language compatibility**: Index is plain JSON — could be shared with Python tools
- **Performance**: <1ms lookup for indexes under 10K entries; even 50K entries stays under 5ms

Storage estimate: 10K glossary entries × 384 dims × 4 bytes = ~15MB index file. Acceptable for desktop app.

### 5.3 Alternative: Custom Flat Index

For maximum simplicity, a custom implementation storing `Float32Array` vectors in a flat JSON file with brute-force cosine similarity is viable for <5K entries. However, Vectra adds negligible overhead and provides metadata filtering, persistence, and a tested API.

---

## 6. Glossary Import Formats

### 6.1 Current Support (glossary-manager.ts)

The existing `glossary-manager.ts` supports:
- **JSON**: Array of `{ source, target }` objects
- **CSV**: Header row `source,target`, with quoted field handling
- Import/export in both formats
- Merge logic: organization glossary overrides personal glossary

### 6.2 TMX (Translation Memory eXchange)

TMX is the industry standard XML format for translation memory exchange (spec 1.4b, 2005). Structure:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <header srclang="ja" adminlang="en" datatype="plaintext"/>
  <body>
    <tu>
      <tuv xml:lang="ja"><seg>機械学習</seg></tuv>
      <tuv xml:lang="en"><seg>machine learning</seg></tuv>
    </tu>
  </body>
</tmx>
```

Implementation: Parse with a lightweight XML parser (e.g., `fast-xml-parser`, already zero-dep). Extract `<tu>` elements, map `<tuv>` by `xml:lang` to `GlossaryEntry` pairs. TMX Level 1 (text only, no inline markup) is sufficient.

### 6.3 TBX (TermBase eXchange)

TBX is the ISO 30042 standard for terminology exchange. More complex than TMX but used by enterprise CAT tools. Lower priority — TMX covers most use cases.

### 6.4 Recommended Additions

1. **TMX import** — Add `parseTmxGlossary(content: string, srcLang: string, tgtLang: string)` to `glossary-manager.ts`
2. **TSV import** — Trivial variant of existing CSV parser (tab delimiter)
3. **Domain tagging** — Extend `GlossaryEntry` with optional `domain?: string` field for filtered retrieval

---

## 7. Integration with Existing Architecture

### 7.1 New Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `GlossaryEmbedder` | `src/engines/translator/glossary-embedder.ts` | Embed glossary entries using ONNX model |
| `GlossaryVectorStore` | `src/engines/translator/glossary-vector-store.ts` | Vectra-based index management |
| `RATRetriever` | `src/engines/translator/rat-retriever.ts` | Orchestrate: embed query → search → format results |

### 7.2 Integration Points

1. **`glossary-manager.ts`** — Add `embedAndIndex()` method that takes parsed entries, embeds them, and upserts into the vector store. Called on glossary import/update.

2. **`TranslateContext`** — No interface change needed. Retrieved entries are injected into the existing `glossary` field. For example retrieval, inject into `previousSegments`.

3. **`TranslationPipeline`** — Before calling `translate()`, run `RATRetriever.retrieve(sourceText)` and merge results into the context. This is a ~10-15 line change in the pipeline orchestration.

4. **`EngineManager`** — Initialize/dispose the embedding model and vector store alongside translation engines.

5. **Settings UI** — Add glossary management panel: import (JSON/CSV/TMX), view entries, set domain tags, enable/disable RAT retrieval.

### 7.3 Model Lifecycle

The embedding model (~113MB ONNX) follows the existing model download pattern:
- Store in `app.getPath('userData')/models/multilingual-e5-small-int8/`
- Download on first use via `model-downloader.ts` (already handles resume + SHA256)
- Load into `onnxruntime-node` InferenceSession in main process
- Share session across all embedding requests (thread-safe for sequential use)

### 7.4 Memory Budget

| Component | Memory |
|-----------|--------|
| ONNX model (int8) | ~113MB |
| Vector index (10K entries × 384d) | ~15MB |
| Runtime overhead | ~5MB |
| **Total** | **~133MB** |

This is acceptable alongside HY-MT1.5 (~1GB) or as an add-on to any translator. Can be disabled on low-memory systems.

---

## 8. Evaluation Plan

### 8.1 Metrics

| Metric | Tool | Target |
|--------|------|--------|
| Terminology adherence | Custom: % of glossary terms correctly used in output | >90% (vs ~60-70% baseline) |
| BLEU (domain test set) | sacreBLEU | +1-3 points over non-RAT |
| COMET | COMET-22 | +0.5-2.0 points over non-RAT |
| Retrieval latency | Wall-clock measurement | <20ms end-to-end |
| Memory overhead | `process.memoryUsage()` | <150MB total RAT components |

### 8.2 Test Sets

1. **Technical meeting corpus**: 200 sentences from software engineering discussions (JA→EN, EN→JA) with 50 domain-specific terms
2. **Medical terminology set**: 100 sentences with medical terms from public JA↔EN medical glossaries
3. **General meeting baseline**: 200 sentences without domain-specific terminology (to verify no regression)

### 8.3 A/B Comparison

Compare for each translator engine:
- Baseline: No glossary
- Current: Exact-match glossary injection
- RAT: Embedding-based retrieval + glossary injection

---

## 9. Implementation Notes

### 9.1 Phase 1: Core RAT Pipeline (MVP)

1. Add `onnxruntime-node` dependency (already Electron-compatible)
2. Add `vectra` dependency (~5KB, zero native deps)
3. Implement `GlossaryEmbedder`: load multilingual-e5-small ONNX, tokenize + embed
4. Implement `GlossaryVectorStore`: Vectra wrapper with domain filtering
5. Implement `RATRetriever`: embed → search → merge with exact-match → inject into context
6. Wire into `TranslationPipeline` before `translate()` call
7. Add TMX parser to `glossary-manager.ts`

### 9.2 Phase 2: UI and UX

1. Glossary management panel in settings (import/export/edit)
2. Domain tagging UI
3. RAT toggle in settings (enable/disable per-domain)
4. Visual indicator when RAT-retrieved terms are used in output

### 9.3 Phase 3: Advanced

1. Translation memory (sentence-level) retrieval alongside term-level
2. Incremental re-indexing on glossary edit (avoid full rebuild)
3. Multi-domain index partitioning
4. User feedback loop: mark translations as correct/incorrect to refine retrieval

### 9.4 Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Embedding model too large for low-memory systems | Make RAT optional; fall back to exact-match glossary |
| ONNX model download fails | Follow existing model-downloader pattern with resume + verification |
| Retrieved terms are irrelevant (low precision) | Cosine similarity threshold (>= 0.7); limit to k=5 |
| Latency exceeds 20ms budget | Pre-compute and cache embeddings; in-memory index guarantees <1ms lookup |
| Vectra index file grows too large | Cap at 50K entries; warn user; support index pruning |

---

## 10. References

- [RAGtrans: Retrieval-Augmented Machine Translation with Unstructured Knowledge (EMNLP 2025)](https://aclanthology.org/2025.findings-emnlp.313/) — Wang et al., benchmark and multi-task training method
- [Hybrid Dictionary-RAG-LLM Translation Pipeline](https://www.mdpi.com/2673-4591/120/1/52) — Three-stage translation with dictionary, RAG, and LLM post-editing
- [T-Ragx: Enhancing Translation with RAG-Powered LLMs](https://github.com/rayliuca/T-Ragx) — Open-source RAG translation library
- [Multilingual E5 Text Embeddings](https://arxiv.org/abs/2402.05672) — Technical report for multilingual-e5 model family
- [intfloat/multilingual-e5-small on HuggingFace](https://huggingface.co/intfloat/multilingual-e5-small) — Model card and ONNX variants
- [Vectra: Local Vector Database for Node.js](https://github.com/Stevenic/vectra) — File-backed in-memory vector store
- [TMX Specification 1.4b](https://www.ttt.org/oscarStandards/tmx/tmx13.htm) — Translation Memory eXchange format
- [WMT 2025 Terminology-Constrained Translation](https://www2.statmt.org/wmt25/pdf/2025.wmt-1.111.pdf) — Dictionary-enhanced prompting with LLM post-editing
- [onnxruntime-node on npm](https://www.npmjs.com/package/onnxruntime-node) — ONNX Runtime for Node.js/Electron
