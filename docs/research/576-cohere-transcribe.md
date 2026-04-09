# Cohere Transcribe Evaluation for live-translate

**Issue:** #576
**Date:** 2026-04-09
**Status:** Research complete — integration viable via Python bridge (Option A) or Transformers.js/ONNX (Option B)

## 1. Summary

Cohere Transcribe (`CohereLabs/cohere-transcribe-03-2026`) is a 2B-parameter Conformer-based encoder-decoder ASR model released March 26, 2026 under **Apache 2.0**. It ranks #1 on the Hugging Face Open ASR Leaderboard with 5.42% average WER for English, outperforming Whisper Large v3 (7.44%) and Qwen3-ASR-1.7B (5.76%).

For Japanese, human preference evaluation shows **70% win rate vs Qwen3-ASR-1.7B** and **66% win rate vs Whisper Large v3**. Specific JA CER values are not publicly disclosed but appear as chart data (CER for zh/ja/ko) in the official blog; the model consistently outperforms or matches the best open-source model per language across FLEURS, Common Voice 17.0, MLS, and Wenet test sets.

## 2. Model Architecture

| Property | Value |
|----------|-------|
| Architecture | Conformer encoder (>90% of params) + lightweight Transformer decoder |
| Parameters | 2B |
| Input | 16 kHz mono audio → log-Mel spectrogram (128 bins) |
| Chunk length | 35s max; auto-splits longer audio at energy boundaries |
| Vocabulary size | 16,384 tokens |
| License | Apache 2.0 |
| Release date | 2026-03-26 |
| Training | Supervised cross-entropy from scratch on 14 languages |

## 3. Supported Languages

14 languages: `en`, `fr`, `de`, `es`, `it`, `pt`, `nl`, `pl`, `el`, `ar`, `ja`, `zh`, `vi`, `ko`

**Language must be specified explicitly** — no automatic language detection.

## 4. Benchmarks

### English ASR Leaderboard (WER — lower is better)

| Model | Avg WER | LS clean | LS other | AMI | Earnings22 | Gigaspeech |
|-------|---------|----------|----------|-----|-----------|-----------|
| **Cohere Transcribe** | **5.42** | **1.25** | **2.37** | **8.15** | 10.84 | 9.33 |
| Zoom Scribe v1 | 5.47 | 1.63 | 2.81 | 10.03 | 9.53 | 9.61 |
| IBM Granite 4.0 1B | 5.52 | 1.42 | 2.85 | 8.44 | 8.48 | 10.14 |
| Qwen3-ASR-1.7B | 5.76 | 1.63 | 3.40 | 10.56 | 10.25 | **8.74** |
| Whisper Large v3 | 7.44 | 2.01 | 3.91 | 15.95 | 11.29 | 10.02 |

### Japanese (Human Preference Evaluation)

| Comparison | Cohere Transcribe Win Rate |
|------------|---------------------------|
| vs Qwen3-ASR-1.7B | **70%** |
| vs Whisper Large v3 | **66%** |

Note: JA CER absolute values are in a chart image in the blog post but not published as a table. Benchmarked against FLEURS, Common Voice 17.0, MLS, and Wenet.

### Context for live-translate

| Engine | JA CER | EN WER | Notes |
|--------|--------|--------|-------|
| MLX Whisper | 8.1% | 3.8% | Current best JA, primary quality engine |
| Moonshine Tiny JA | 10.1% | — | Experimental, ultra-fast |
| Qwen3-ASR-1.7B | — | 5.76% | Under evaluation (#268) |
| **Cohere Transcribe** | **est. <8%** | **5.42%** | 70% win rate vs Qwen3-ASR in JA |

## 5. Model Size and Memory

| Artifact | Size |
|----------|------|
| `model.safetensors` (fp32/bf16) | **4.13 GB** |
| `tokenizer.model` | 493 kB |
| ONNX q4 (via `onnx-community`) | ~1–1.5 GB (estimated from 20 quantization variants) |

**Runtime memory (estimated):**
- PyTorch bf16 GPU: ~4–5 GB VRAM
- PyTorch CPU: ~8–10 GB RAM
- ONNX q4 CPU: ~1.5–2 GB RAM (estimated)

No official memory benchmarks published; estimates based on 2B parameter count at different precisions.

## 6. Inference Latency

| Metric | Value |
|--------|-------|
| RTFx (real-time factor multiple) | 524.88× |
| Throughput vs peers | 3× faster than similar-size dedicated ASR models |
| Example | 55-minute audio transcribed in ~11–15s on GPU |
| MLX (Apple Silicon) | 4× faster than PyTorch via `mlx-audio` (if supported) |

Note: RTFx 524.88× means the model processes 524 minutes of audio per minute on the evaluation GPU. On M-series Mac CPU with PyTorch MPS, real-time performance for 3-second chunks would need empirical benchmarking.

## 7. Integration Options

### Option A: Python Bridge (like MlxWhisperEngine) — RECOMMENDED

**How:** Spawn a Python subprocess with JSON-over-stdio protocol, same pattern as `MlxWhisperEngine.ts`.

**Dependencies:**
```bash
pip install "transformers>=5.4.0" torch soundfile librosa sentencepiece protobuf huggingface_hub
```

**Bridge script pattern:**
```python
from transformers import AutoProcessor, CohereAsrForConditionalGeneration
import torch, json, sys

processor = AutoProcessor.from_pretrained("CohereLabs/cohere-transcribe-03-2026")
model = CohereAsrForConditionalGeneration.from_pretrained(
    "CohereLabs/cohere-transcribe-03-2026",
    device_map="auto",
    torch_dtype=torch.bfloat16,
)

for line in sys.stdin:
    req = json.loads(line)
    audio = req["audio"]  # list[float] at 16kHz
    inputs = processor(audio, sampling_rate=16000, return_tensors="pt", language="ja")
    inputs = inputs.to(model.device, dtype=model.dtype)
    outputs = model.generate(**inputs, max_new_tokens=256)
    text = processor.decode(outputs, skip_special_tokens=True)
    print(json.dumps({"text": text}), flush=True)
```

**Pros:**
- Official transformers support (≥5.4.0) — stable API
- MPS (Apple Silicon), CUDA, and CPU all work
- Long-form auto-chunking built-in
- Proven pattern in codebase (`MlxWhisperEngine`)
- Model auto-downloads from HuggingFace

**Cons:**
- Requires Python 3.12+ and PyTorch (~2.5 GB with deps)
- 4.13 GB model download on first use
- Subprocess startup latency (~3–6s cold start)
- No timestamps or speaker diarization
- Language must be hard-coded to `"ja"` — cannot do multilingual auto-detect

**Effort:** Low-medium. Re-use `MlxWhisperEngine` pattern with new bridge script.

### Option B: Transformers.js + ONNX (WebGPU in renderer) — EXPERIMENTAL

**How:** Use `onnx-community/cohere-transcribe-03-2026-ONNX` via `@huggingface/transformers` in the Electron renderer process.

**Dependencies:**
```bash
npm i @huggingface/transformers
```

**Usage:**
```js
import { pipeline } from "@huggingface/transformers";

const transcriber = await pipeline(
  "automatic-speech-recognition",
  "onnx-community/cohere-transcribe-03-2026-ONNX",
  { dtype: "q4", device: "webgpu" },
);
const output = await transcriber(audio, { max_new_tokens: 1024, language: "ja" });
```

**Pros:**
- No Python dependency — pure JS
- ONNX q4 ~1–1.5 GB vs 4.13 GB safetensors
- WebGPU uses Apple Neural Engine/Metal on M-series

**Cons:**
- WebGPU in Electron renderer requires explicit context setup
- ONNX export is community-maintained (`onnx-community`), not official Cohere
- 20 quantization variants need testing for JA accuracy vs size tradeoff
- No community reports yet on JA accuracy for ONNX q4 variant
- Large model still downloads on first use

**Effort:** Medium. More unknowns than Option A; needs careful testing.

### Option C: Rust (`cohere_transcribe_rs`) — FUTURE

A Rust crate `cohere_transcribe_rs` exists (mentioned in official model card) but no NAPI-RS bindings exist. High effort, skip for now.

## 8. Limitations and Risks

| Risk | Severity | Notes |
|------|----------|-------|
| No auto language detection | Medium | Must specify `language="ja"` — breaks mixed-language sessions |
| Hallucination on silence/noise | Medium | "Eager transcription" — prone to hallucinating on noisy background |
| No timestamps | Low | Not needed for subtitle overlay use case |
| 4.13 GB model size | Medium | Comparable to PLaMo-2 (5.5 GB); needs resume-download support |
| No JA CER absolute value published | Low | Can only infer from win-rate comparisons |
| PyTorch MPS latency unknown | High | Must benchmark on M-series Mac for real-time suitability |

## 9. Recommendation

**Verdict: Viable for quality mode — proceed to implementation with benchmarking gate.**

Cohere Transcribe is the strongest open-source ASR model for Japanese as of April 2026, with a 70% human preference win rate over Qwen3-ASR-1.7B and 66% over Whisper Large v3. Apache 2.0 license and first-class transformers integration make it a low-risk addition.

**Recommended path:**
1. Implement `CohereTranscribeEngine.ts` via Python bridge (Option A), following `MlxWhisperEngine` pattern
2. Register as experimental STT engine (hidden from UI until benchmarks pass)
3. Benchmark JA CER against MLX Whisper (8.1% target) on internal JA test set
4. Benchmark latency on Apple M-series CPU (3s chunk target: <2s for real-time)
5. If JA CER < 8.1% AND latency < 2s, promote to primary quality-mode engine

**Do not promote to UI until real-time latency is confirmed on CPU.** The model is large (4.13 GB) and CPU inference for 3-second chunks may exceed real-time, unlike the GPU-measured RTFx of 524×.

## 10. References

- HuggingFace model card: https://huggingface.co/CohereLabs/cohere-transcribe-03-2026
- HuggingFace blog post: https://huggingface.co/blog/CohereLabs/cohere-transcribe-03-2026-release
- Cohere blog: https://cohere.com/blog/transcribe
- Transformers docs: https://huggingface.co/docs/transformers/model_doc/cohere_asr
- ONNX variant: https://huggingface.co/onnx-community/cohere-transcribe-03-2026-ONNX
- Open ASR Leaderboard: https://huggingface.co/spaces/hf-audio/open_asr_leaderboard
