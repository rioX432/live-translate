# GPT-Realtime-Whisper Benchmark Results

This file is the single source of truth for the Phase 3 decision in issue
[#698](https://github.com/rioX432/live-translate/issues/698). Bench runs go
under `results/` (gitignored); summaries and decisions go here so they are
version-controlled.

## Local-engine baselines we are comparing against

Numbers below are taken from the existing in-repo STT bench
(`benchmark/run.ts --stt`) on `benchmark/testset/stt-manifest.jsonl`. They are
the basis for the Phase 3 gate: a cloud STT mode is only worth designing if
gpt-realtime-whisper improves on the **best** of these by **> 2.0 percentage
points** of JA CER.

| Engine | JA CER | EN WER | Apple Silicon latency | Notes |
|---|---|---|---|---|
| Kotoba-Whisper | 5.6% | — | — | JA-only |
| Qwen3-ASR 0.6B | 6.8% | 1.9% | ~2.2 s | Current best balanced (JA + EN) |
| MLX Whisper | 8.1% | 3.8% | 2.9 s | macOS only |
| Whisper Local (whisper.cpp) | baseline | baseline | — | Cross-platform default |
| Moonshine Tiny JA | 10.1% | — | 845 ms | Experimental draft STT |

Best local JA CER (incl. all primary + experimental engines): **5.6 %**
(Kotoba-Whisper, JA-only). Best balanced JA+EN: **6.8 %** (Qwen3-ASR 0.6 B).

## Public information about gpt-realtime-whisper (collected 2026-06)

Sourced from the OpenAI Realtime API documentation and announcement coverage
(see `docs/research/698-gpt-realtime-whisper-eval.md`).

- Released 2026-05-07 alongside gpt-realtime-2 and gpt-realtime-translate.
- **Price**: USD 0.017 / minute of audio (≈ 2.8× the legacy `whisper-1`
  price).
- **Protocol**: WebSocket-only via the Realtime API,
  `session.type = "transcription"`,
  `audio.input.transcription.model = "gpt-realtime-whisper"`,
  pcm16 / 24 kHz input.
- **Latency**: tunable via `audio.input.transcription.delay`, documented
  tiers `minimal | low | medium | high | xhigh`. OpenAI explicitly markets
  the model as the "lowest-latency streaming transcription path" in their
  API. No latency numbers (milliseconds) have been published.
- **Accuracy**: OpenAI has not published per-language numbers for
  gpt-realtime-whisper. The closest external reference is the Artificial
  Analysis leaderboard's AA-WER score for the sister model `gpt-4o-transcribe`
  (≈ 4.0 % English, no JA breakdown). No JA CER number has been published by
  OpenAI or any third party that we could verify as of 2026-06.

Projected cost @ 4 h/day x 22 days/month: **USD 89.76 / user / month**.

## Decision

> Re-evaluate once a real bench run produces measured numbers. Update this
> section in the next PR.

### Preliminary (no live bench data yet) — **inconclusive, lean towards
won't-do**

- OpenAI has not committed to a Japanese accuracy improvement publicly. The
  GA blog post describes gpt-realtime-whisper as "the streaming counterpart"
  to whisper-1, not "more accurate than whisper-1".
- gpt-4o-transcribe (the higher-quality, batch-only sibling) shows ≈ 4.0 %
  English AA-WER per Artificial Analysis. Without official JA numbers, the
  conservative prior is that gpt-realtime-whisper is *not better* than
  gpt-4o-transcribe on JA (since it trades accuracy for streaming latency).
- The current best local JA CER is **5.6 %** (Kotoba-Whisper) and **6.8 %**
  (Qwen3-ASR balanced). A > 2 pp improvement would mean cloud JA CER ≤
  ~3.6 %. That is below the published *English* AA-WER for gpt-4o-transcribe
  — implausible for the streaming variant given that JA is harder than EN
  for current ASR.
- Cost is USD 89.76/user/month for 4 h/day usage, vs the current zero
  marginal cost.

**Implication**: unless a measured run shows JA CER ≤ ~3.6 %, the issue
should close as `won't`. Until that run lands, this remains **inconclusive**
because the decision must be based on measured numbers (research-first
principle from `CLAUDE.md`).

### How to finalize the decision

1. Acquire an `OPENAI_API_KEY` with Realtime API access.
2. Regenerate `benchmark/testset/stt-audio/` via `npm run stt:generate-testset`.
3. Run `OPENAI_API_KEY=sk-... npx tsx --expose-gc gpt-realtime-whisper-eval/bench-gpt-realtime-whisper.ts`.
4. Append the resulting markdown to this file under a new `## Runs` heading
   with the measured JA CER.
5. Apply the Phase 3 gate from #698:
   - JA CER improvement ≤ 2.0 pp over best local → close #698 with label
     `won't`; add this RESULTS.md as the rationale.
   - JA CER improvement > 2.0 pp → open a follow-up "Design opt-in cloud STT
     mode" issue that references this RESULTS.md.

## Runs

> Populate as bench runs land.

### Pending: first reference run

No reference run has been executed yet. Use the prerequisites in
`README.md` and append results here.
