# #698 — GPT-Realtime-Whisper Evaluation

Research scaffold and public-data summary for Issue
[#698](https://github.com/rioX432/live-translate/issues/698).

Filed under `docs/research/` per `.claude/rules/ai-ops.md` — research
documents are **not** implementations. The Phase 3 decision in #698 still
gates whether any production code changes happen.

## Scope

Evaluate whether OpenAI's `gpt-realtime-whisper` (Realtime API streaming
transcription, released 2026-05-07) should be wired as an **opt-in cloud STT
mode** in live-translate. Per #698:

- Phase 1 — measure JA CER, EN WER, latency, and cost.
- Phase 2 — compare against the existing local STT engines.
- Phase 3 decision gate:
  - JA CER improvement ≤ 2.0 pp over best local → close as `won't`.
  - JA CER improvement > 2.0 pp → open follow-up design issue.

Core Value alignment: this does **not** change the offline default. Cloud STT
would be opt-in only, parallel to the existing Microsoft Translator / Google
Translate / Gemini rotation on the translation side. CV #1 (offline-first)
remains intact; CV #2 (realtime) is the candidate improvement axis.

## What gpt-realtime-whisper actually is

| Attribute | Value | Source |
|---|---|---|
| Release | 2026-05-07 | [MarkTechPost coverage](https://www.marktechpost.com/2026/05/08/openai-releases-three-realtime-audio-models-gpt-realtime-2-gpt-realtime-translate-and-gpt-realtime-whisper-in-the-realtime-api/) |
| Pricing | USD 0.017 / minute of audio | [OpenAI model docs](https://developers.openai.com/api/docs/models/gpt-realtime-whisper) |
| Protocol | Realtime API WebSocket, `session.type = "transcription"`, model in `audio.input.transcription.model` | [OpenAI Realtime Transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription) |
| Audio format | pcm16 mono @ 24 kHz | Same guide |
| Latency tuning | `audio.input.transcription.delay` ∈ {`minimal`,`low`,`medium`,`high`,`xhigh`} | Same guide |
| Marketing claim | "Lowest-latency streaming transcription path" | [Realtime models overview](https://www.mindstudio.ai/blog/gpt-realtime-voice-models-explained) |
| Relation to `whisper-1` | Streaming successor for live-output use cases; whisper-1 still cheaper for batch | Same overview |
| Relation to `gpt-4o-transcribe` | Different model; gpt-4o-transcribe is batch HTTP, optimized for accuracy | [OpenAI model docs](https://developers.openai.com/api/docs/models/gpt-4o-transcribe) |

### Published accuracy data (or lack thereof)

- **OpenAI**: no per-language WER/CER published for `gpt-realtime-whisper`
  as of 2026-06.
- **Artificial Analysis**: has a leaderboard slot for the model but the
  entry is empty (no AA-WER reported). [Page](https://artificialanalysis.ai/speech-to-text/models/openai-gpt-realtime-whisper).
- **Artificial Analysis (sibling model gpt-4o-transcribe)**: AA-WER 4.0 %
  on the combined English benchmark, 33.0 audio-seconds-per-second median
  speed, USD 6.00 / 1,000 minutes. No JA breakdown.
- **Independent JA ASR benchmarks (2026)**:
  - [Neosophie 2026-02 JA ASR benchmark](https://neosophie.com/en/blog/20260226-japanese-asr-benchmark)
    reports (CER, conversational JA):
    - `qwen/qwen3-asr-1.7b`: 14.0 %
    - `openai/whisper-large-v3-turbo`: 18.4 %
    - `mistralai/voxtral-mini-4b-realtime-2602`: 21.2 %
    - `kotoba-tech/kotoba-whisper-v2.0`: 49.5 %
    - Neither `gpt-realtime-whisper` nor `gpt-4o-transcribe` appears in the
      table.
  - Numbers from this external benchmark use a different test set
    (~10 min of natural conversational Japanese vs the in-repo
    business/technical sentence fixtures), so they are **not directly
    comparable** to live-translate's published baselines. They are useful
    only as a sanity check on the *relative ordering* of local engines.

### Why "no JA number" is itself informative

The conservative prior for a streaming model launched in May 2026 with no
language-specific accuracy story:

1. OpenAI explicitly markets the model as **latency-first**, not
   accuracy-first. The press materials position gpt-4o-transcribe as the
   "high-accuracy" sibling for batch use.
2. Streaming systems with low-latency partial output (sub-second TTFD) have
   historically given up several percentage points of accuracy vs their
   batch counterparts (e.g. Microsoft / Google streaming-vs-batch deltas
   in [Soniox 2026 benchmark](https://soniox.com/benchmarks)).
3. Japanese is consistently 1.5–3× harder than English for current
   multilingual ASR systems. If the English AA-WER for `gpt-4o-transcribe`
   is ≈ 4 %, the JA equivalent is typically ≥ 8–10 %.

A 2 pp improvement over the current best local JA CER of 5.6 % means cloud
JA CER **≤ 3.6 %**, which is *better than the published English number for
the higher-accuracy batch sibling*. That is implausible but not impossible —
hence the need to actually measure rather than assume.

## What we built

`benchmark/gpt-realtime-whisper-eval/` — a self-contained STT bench scaffold:

- `realtime-client.ts` — WebSocket client implementing the documented
  Realtime transcription protocol. Exports a pure `buildSessionUpdate`
  helper so the schema is locked in by unit tests.
- `audio.ts` — local 16-bit mono WAV reader + linear resampler
  (16 kHz → 24 kHz, the format the Realtime endpoint requires). Avoids an
  ffmpeg dependency.
- `cost.ts` — pure helpers for monthly USD projection at the documented
  $0.017/min price.
- `bench-gpt-realtime-whisper.ts` — CLI runner over the existing
  `benchmark/testset/stt-manifest.jsonl` corpus, reusing `wer.ts` so CER/WER
  numbers are directly comparable to existing engines.
- `cost.test.ts`, `audio.test.ts`, `realtime-client.test.ts` — 14 unit tests
  (vitest) covering price math, audio helpers, and the session.update
  payload shape.
- `README.md` — how to run, audio-source suggestions for extending the
  corpus (Common Voice JA, ReazonSpeech v2).
- `RESULTS.md` — Phase 3 decision template with the local-engine baseline
  table, public-data summary, and a "how to finalize" checklist.

Skipping cleanly without `OPENAI_API_KEY` is intentional so the bench can
live in CI without flaking.

## Preliminary recommendation

**Inconclusive, leaning `won't-do`.** Justification:

- No third party has published a JA CER for `gpt-realtime-whisper`, so the
  Phase 3 gate cannot be evaluated from public data alone.
- The implied threshold (JA CER ≤ ~3.6 %) is below the *English* AA-WER of
  the higher-accuracy batch sibling. Reaching it with a streaming model on
  Japanese would be an outlier.
- A measured bench is cheap (USD < 1 to run the bundled 20-clip manifest at
  $0.017/min). The blocker is access to a Realtime API key.

Next steps once a key is available:

1. Run `OPENAI_API_KEY=sk-... npx tsx --expose-gc benchmark/gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts`.
2. Append the resulting markdown into `benchmark/gpt-realtime-whisper-eval/RESULTS.md`.
3. Apply the Phase 3 gate and either close #698 as `won't` or open a
   "design opt-in cloud STT mode" follow-up.

## Sources

- [OpenAI — gpt-realtime-whisper model card](https://developers.openai.com/api/docs/models/gpt-realtime-whisper)
- [OpenAI — Realtime transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI — Advancing voice intelligence (announcement)](https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/)
- [Artificial Analysis — gpt-realtime-whisper](https://artificialanalysis.ai/speech-to-text/models/openai-gpt-realtime-whisper)
- [Artificial Analysis — gpt-4o-transcribe](https://artificialanalysis.ai/speech-to-text/models/openai-gpt-4o-transcribe)
- [MarkTechPost — OpenAI Releases Three Realtime Audio Models](https://www.marktechpost.com/2026/05/08/openai-releases-three-realtime-audio-models-gpt-realtime-2-gpt-realtime-translate-and-gpt-realtime-whisper-in-the-realtime-api/)
- [Neosophie — 2026 Japanese ASR benchmark](https://neosophie.com/en/blog/20260226-japanese-asr-benchmark)
- [Soniox 2026 STT benchmark](https://soniox.com/benchmarks)
- [9to5Mac — OpenAI voice models that reason, translate and transcribe (2026-05-07)](https://9to5mac.com/2026/05/07/openai-has-new-voice-models-that-reason-translate-and-transcribe-as-you-speak/)
- [Latent.Space AINews — GPT-Realtime-2, -Translate, -Whisper](https://www.latent.space/p/ainews-gpt-realtime-2-translate-and)
