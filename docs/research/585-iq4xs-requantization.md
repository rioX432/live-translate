# Research: IQ4_XS GGUF Re-quantization with Importance Matrix

**Date**: 2026-04-09
**Issue**: [#585](https://github.com/rioX432/live-translate/issues/585)
**Models in scope**: HY-MT1.5-1.8B, Hunyuan-MT-7B

---

## Summary

IQ4_XS is an importance-matrix-guided 4-bit i-quant that achieves ~9% smaller file size than Q4_K_M with comparable or slightly better perplexity when built with a high-quality imatrix. For the two models currently shipped:

| Model | Q4_K_M size | IQ4_XS estimate | Saving |
|---|---|---|---|
| HY-MT1.5-1.8B | ~1.1 GB | ~1.0 GB | ~100 MB |
| Hunyuan-MT-7B | ~4.7 GB | ~4.2 GB | ~500 MB |

The primary benefit for live-translate is reduced first-launch download time and lower RAM headroom required for the fast (1.8B) model, with no code changes needed beyond updating URLs, sizes, and SHA256 hashes in `model-downloader.ts`.

---

## Quantization Type Comparison

| Format | bpw | Size (8B ref) | PP speed | TG speed | imatrix req | Notes |
|---|---|---|---|---|---|---|
| Q4_K_M | 4.89 | 4.58 GiB | Fast | Fast | No | Reliable default, no imatrix needed |
| IQ4_XS | 4.46 | 4.17 GiB | Slightly slower | Slightly faster | **Yes** | Best balanced i-quant; requires good imatrix |
| IQ4_NL | ~4.5 | ~4.3 GiB | CPU-friendly | Similar to IQ4_XS | Yes | Non-linear 32-block variant; often redundant vs IQ4_XS |
| IQ3_XXS | ~3.28 | ~3.1 GiB | Slow (5–10%) | Slow (5–10%) | Yes | Aggressive compression; perplexity noticeably worse |
| Q3_K_M | 3.91 | 3.74 GiB | Fast | Fast | No | Simpler 3-bit, no imatrix, lower quality floor |

Perplexity reference (Llama-3.1-8B, wikitext):
- Q4_K_M: ~3.0184
- IQ4_XS: ~3.0310 (+0.4% vs Q4_K_M — within noise)
- IQ4_NL: ~3.0261 (~same as IQ4_XS)
- IQ3_XXS: ~3.9671 (+31% — visible quality drop)

**Key finding**: IQ4_XS perplexity is essentially identical to Q4_K_M when quantized with a domain-matched imatrix. Without an imatrix, IQ4_XS can be worse than Q4_K_M, making the imatrix step mandatory.

---

## Importance Matrix (imatrix) Overview

The imatrix tool runs the model on a calibration corpus and records per-layer activation magnitudes. These statistics are passed to `llama-quantize` so that weights with higher activation importance are quantized more carefully (more bits allocated implicitly via the i-quant lookup tables).

**Effect**: Reduces effective perplexity by 10–30% compared to naive IQ4_XS quantization and is required to match Q4_K_M quality at lower bit depth.

### Calibration Data Guidelines

- Use domain-representative text — for JA↔EN translation models, this means bilingual parallel sentences (JA and EN)
- Corpus size: 1,000–10,000 sentences is typical; diminishing returns beyond ~5,000
- Avoid single-domain overfitting: mix formal (news), informal (conversation), and technical (software) registers
- Pseudo-random / wiki data is an acceptable fallback but slightly worse than domain-matched data for translation models
- For Japanese: ensure the calibration set has adequate JA coverage (Japanese requires more tokens for equivalent semantic coverage vs English)

Suggested calibration sources for translation:
- [JESC](https://nlp.stanford.edu/projects/jesc/) — 3.2M JA/EN parallel sentences, conversational
- [JParaCrawl](https://www.kecl.ntt.co.jp/icl/lirg/jparacrawl/) — web-crawled JA/EN parallel corpus
- [tatoeba JA/EN](https://tatoeba.org) — short sentence pairs, good for dialogue

---

## Step-by-Step Re-quantization Process

### Prerequisites

```bash
# Clone and build llama.cpp (latest master recommended)
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DLLAMA_METAL=ON   # macOS Apple Silicon
cmake --build build --config Release -j8

# Tools needed:
#   build/bin/llama-imatrix
#   build/bin/llama-quantize
#   build/bin/llama-gguf-split (if model is multi-part)
```

### Step 1: Obtain the F16 base GGUF

```bash
# Download F16 (or BF16) GGUF — needed as quantization source
# HY-MT1.5-1.8B
huggingface-cli download tencent/HY-MT1.5-1.8B-GGUF \
  HY-MT1.5-1.8B-F16.gguf --local-dir ./models/hy-mt15

# Hunyuan-MT-7B
huggingface-cli download Mungert/Hunyuan-MT-7B-GGUF \
  Hunyuan-MT-7B-f16.gguf --local-dir ./models/hunyuan7b
# Note: if F16 is not available on HF, convert from safetensors:
# python llama.cpp/convert_hf_to_gguf.py <hf_model_dir> --outtype f16
```

### Step 2: Prepare calibration data

```bash
# Create a bilingual calibration text file (one sentence/paragraph per line)
# Recommended: 2,000–5,000 lines of mixed JA/EN translation pairs
# Example using Tatoeba:
python -c "
import json, random
# load JA/EN pairs from tatoeba tsv or similar source
# write to calibration.txt, one sentence per line
"
# Alternatively, use llama.cpp's bundled wikitext as a starting fallback:
# wget https://huggingface.co/datasets/ggml-org/ci/resolve/main/wikitext-2-raw-v1.zip
```

### Step 3: Generate the importance matrix

```bash
# HY-MT1.5-1.8B (fast, ~5–10 min on M-series Mac)
./build/bin/llama-imatrix \
  -m ./models/hy-mt15/HY-MT1.5-1.8B-F16.gguf \
  -f calibration.txt \
  --chunk 512 \
  -o ./models/hy-mt15/imatrix.dat \
  -ngl 99   # offload all layers to Metal

# Hunyuan-MT-7B (slower, ~30–60 min on M-series Mac)
./build/bin/llama-imatrix \
  -m ./models/hunyuan7b/Hunyuan-MT-7B-f16.gguf \
  -f calibration.txt \
  --chunk 512 \
  -o ./models/hunyuan7b/imatrix.dat \
  -ngl 99
```

### Step 4: Quantize to IQ4_XS

```bash
# HY-MT1.5-1.8B
./build/bin/llama-quantize \
  --imatrix ./models/hy-mt15/imatrix.dat \
  ./models/hy-mt15/HY-MT1.5-1.8B-F16.gguf \
  ./models/hy-mt15/HY-MT1.5-1.8B-IQ4_XS.gguf \
  IQ4_XS

# Hunyuan-MT-7B
./build/bin/llama-quantize \
  --imatrix ./models/hunyuan7b/imatrix.dat \
  ./models/hunyuan7b/Hunyuan-MT-7B-f16.gguf \
  ./models/hunyuan7b/Hunyuan-MT-7B-IQ4_XS.gguf \
  IQ4_XS
```

### Step 5: Benchmark quality

```bash
# Perplexity check (compare to Q4_K_M baseline)
./build/bin/llama-perplexity \
  -m ./models/hy-mt15/HY-MT1.5-1.8B-IQ4_XS.gguf \
  -f calibration.txt --chunks 50

# Translation quality: run a BLEU/COMET eval against a held-out test set
# e.g. FLORES-200 devtest JA→EN subset (1,012 sentences)
# Target: BLEU within ±0.5 and COMET within ±0.01 of Q4_K_M baseline

# Inference speed
./build/bin/llama-bench -m ./models/hy-mt15/HY-MT1.5-1.8B-IQ4_XS.gguf -p 512 -n 128
```

### Step 6: Compute SHA256 and update model-downloader.ts

```bash
shasum -a 256 ./models/hy-mt15/HY-MT1.5-1.8B-IQ4_XS.gguf
shasum -a 256 ./models/hunyuan7b/Hunyuan-MT-7B-IQ4_XS.gguf
```

Upload GGUFs to a Hugging Face repo (or use a fork of the existing repos), then update `src/engines/model-downloader.ts`:

```typescript
// Replace in HUNYUAN_MT_15_VARIANTS
'IQ4_XS': {
  filename: 'HY-MT1.5-1.8B-IQ4_XS.gguf',
  url: 'https://huggingface.co/<org>/HY-MT1.5-1.8B-GGUF/resolve/main/HY-MT1.5-1.8B-IQ4_XS.gguf',
  sha256: '<hash>',
  sizeMB: 1020,   // ~1.0 GB estimated
  label: 'IQ4_XS (Recommended, ~1.0GB)'
}

// Replace in HUNYUAN_MT_VARIANTS
'IQ4_XS': {
  filename: 'Hunyuan-MT-7B-IQ4_XS.gguf',
  url: 'https://huggingface.co/<org>/Hunyuan-MT-7B-GGUF/resolve/main/Hunyuan-MT-7B-IQ4_XS.gguf',
  sha256: '<hash>',
  sizeMB: 4200,   // ~4.2 GB estimated
  label: 'IQ4_XS (Recommended, ~4.2GB)'
}
```

---

## Alternative Quantization Types

| Format | Recommendation | Use case |
|---|---|---|
| IQ4_NL | Skip (redundant vs IQ4_XS) | CPU-only systems; test if IQ4_XS is slow on target hardware |
| IQ3_XXS | Not recommended for MT | ~31% perplexity increase; translation quality likely to degrade noticeably |
| IQ3_S | Possible fallback | 3.44 bpw, ~20% smaller than IQ4_XS; evaluate with COMET before shipping |
| Q5_K_M | Conservative alternative | Slightly larger than Q4_K_M but better quality; no imatrix needed |

---

## Memory and Speed Impact

For the primary use-case (HY-MT1.5-1.8B, real-time translation):

| Metric | Q4_K_M | IQ4_XS (estimated) |
|---|---|---|
| File size | 1,130 MB | ~1,020 MB (~−9%) |
| RAM at runtime | ~1.3 GB | ~1.2 GB |
| TG speed | baseline | +2–5% faster |
| PP speed | baseline | −3–5% slower |
| Perplexity delta | 0 | +0.1–0.5% with good imatrix |

For Hunyuan-MT-7B (quality mode):

| Metric | Q4_K_M | IQ4_XS (estimated) |
|---|---|---|
| File size | 4,700 MB | ~4,200 MB (~−11%) |
| RAM at runtime | ~5.5 GB | ~5.0 GB |
| TG speed | baseline | +2–5% faster |
| PP speed | baseline | −3–5% slower |

---

## Recommendation

**Proceed with IQ4_XS re-quantization for both models, conditioned on benchmark results.**

Priority:
1. HY-MT1.5-1.8B first — smaller model, faster iteration, higher user impact (default fast path)
2. Hunyuan-MT-7B second — quality mode, 500 MB saving is meaningful but less critical

Go/no-go criteria:
- BLEU delta < 0.5 points vs Q4_K_M on FLORES-200 JA→EN
- COMET delta < 0.01 (absolute) vs Q4_K_M
- Inference latency for HY-MT1.5 < 200 ms per segment (currently ~180 ms)

If benchmarks pass, ship IQ4_XS as the new default variant and keep Q4_K_M as the fallback option in the UI variant selector.

**IQ4_NL and IQ3_XXS are not recommended** — IQ4_NL is redundant and IQ3_XXS causes unacceptable quality loss for MT tasks.

---

## References

- [llama.cpp quantize README](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md)
- [llama.cpp imatrix README](https://github.com/ggml-org/llama.cpp/blob/master/tools/imatrix/README.md)
- [GGUF quantizations overview (community gist)](https://gist.github.com/Artefact2/b5f810600771265fc1e39442288e8ec9)
- [Kaitchup: Choosing a GGUF Model — K-Quants, I-Quants](https://kaitchup.substack.com/p/choosing-a-gguf-model-k-quants-i)
- [imatrix overfitting discussion](https://github.com/ggml-org/llama.cpp/discussions/5263)
- [imatrix best on near-random data discussion](https://github.com/ggml-org/llama.cpp/discussions/5006)
- [Mungert/Hunyuan-MT-7B-GGUF (HF)](https://huggingface.co/Mungert/Hunyuan-MT-7B-GGUF)
- [tencent/HY-MT1.5-1.8B-GGUF (HF)](https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF)
- [Blind testing different quants — llama.cpp discussion #5962](https://github.com/ggml-org/llama.cpp/discussions/5962)
