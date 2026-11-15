# Issue, PR and branch triage (2026-11-15)

The project moved to local-only meeting subtitles plus a desktop character. This records how the existing issues,
PRs and branches were sorted against that direction, so later work starts from the open set below instead of old
titles. State was read with `gh` and `git` on 2026-11-15.

## Issues

| Issue | Category | Outcome |
|---|---|---|
| #725 Cascade modernization epic | Merge and redefine | Kept open. Scope narrowed to the first translated subtitle latency (bench: p50 about 6–9 s against a 1.5 s target, caused by when partial translations are emitted, not by engine speed) and SimulStreaming-style streaming. Multi-engine QE routing is dropped: `AdaptiveRouter` (#547) was removed in `0ab1d4c` and one engine pair is now chosen. |
| #724 Kotoba-Whisper-Bilingual direct S2TT | Future research | Kept open, not scheduled. Must beat the cascade on a latency/quality gate before any work. |
| #722 CloudRealtimeE2E | Obsolete | Closed: cloud realtime translation removed (#752). |
| #733 CloudRealtimeE2E abort bug | Obsolete | Closed: the code it applies to is removed (#752). |
| #698 GPT-Realtime-Whisper evaluation | Obsolete (findings kept) | Closed: cloud STT is out of scope. Findings: `docs/research/698-gpt-realtime-whisper-eval.md`, `benchmark/gpt-realtime-whisper-eval/RESULTS.md`. |

No issue currently falls under "still needed as is" or "already implemented": every other issue was already closed.
New work (character, glossary memory, meeting E2E) is tracked by its PRs rather than new planning issues.

## Pull requests

| PR | Judgment |
|---|---|
| #750 Sync ai-dev-template (web) | Superseded. Its two files (`.agents/skills/review/SKILL.md`, `.claude/skills/review/SKILL.md`) are identical on `main` since #751; it carries nothing unmerged. Left open for the owner to close. |
| #752, #753, #754 | Active local-companion work; not triaged here. |

## Remote branches

Counts are commits behind/ahead of `origin/main`.

| Branch | Behind/ahead | Judgment |
|---|---|---|
| `research/583-copilot-translation` | 146/1 | Its only commit is a research note; brought in as `docs/research/583-windows-copilot-translation.md` (written 2026-04-09, not re-checked). Deletion candidate after this lands. |
| `research/562-gemma4-translation` | 152/0 | Fully merged (`docs/research/562-gemma4-translation.md`). Deletion candidate. |
| `research/586-demo-gif` | 149/0 | Fully merged (`docs/research/586-demo-gif-video.md`). Deletion candidate. |
| `fix/407-hunyuan-mt-p95-profiling` | 324/1 | One docs commit describing the old OPUS-MT default and cloud engines; #407 is closed. Nothing to keep. Deletion candidate. |
| `sync/ai-dev-template-20260928-062437` | 2/1 | Head of #750. Deletion candidate once #750 is closed. |
| `local-companion`, `task/*` | — | Active. |

No branch was deleted.

## Removed features

TTS, virtual mic output, the Chrome extension audio server and MDM/Enterprise are removed; see
`docs/research/removed-tts-virtual-mic-extension-mdm.md`. Cloud inference was removed earlier; see
`docs/research/local-only-removed-cloud.md`.
