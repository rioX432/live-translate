# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- GPT-Realtime-Whisper evaluation scaffold + research notes (5702384)
- Three-step onboarding with optional Azure F0 key step (73f30ca)
- `managedMicrosoftApiKey` + `managedMicrosoftRegion` to MDM config (d20938a)
- Progressive model loading with Tier 1/2 system for instant offline startup (264e9dc)
- Speculative decoding support to Hunyuan-MT 7B quality mode (9822d68)
- STT benchmark infrastructure for SenseVoice-Sherpa and Qwen3-ASR (a0c8e04)
- Core Values and Won't Do sections to CLAUDE.md (bd7c2f8)
- E2E streaming speech translation research (a6ca656)
- NAT ultra-low latency translation research (c47408f)
- RWKV-7 SSM translation research (d6a1d98)
- Adaptive SimulMT policy research (18ac545)
- ANE-accelerated translation via ANEMLL research (7cd385c)
- Apple Foundation Models JA↔EN translation adapter research (768a9cd)

### Changed
- Replace plamo with hunyuan-mt in adaptive routing quality engine list (81526d3)
- Trim UI engine list to 5 options + migrate legacy `translationEngine` to `auto` (4319f34)
- Inject local fallback into `ApiRotationController` and classify 429 errors (dea6237)
- Implement SSBD (Self-Speculative Biased Decoding) for streaming (3b7708f)
- Pre-warm translation model prefix cache at startup (1f9e5fb)
- Lower default streaming interval to 800ms and expose slider in Audio settings (391e9bb)
- Standardize error handling in settings components with structured types (3da0c7d)
- Overlap STT and clause-level translation in pipeline (a0c5768)
- MoE + SSD expert streaming research (2a9ebb6)
- RAT with user glossaries research (4c400d0)
- Qwen3-MT GGUF availability monitoring research (17fb6df)
- QE-based translation selection research (17d6638)
- LFM2.5-1.2B-JP translation evaluation research (1db9852)

### Fixed
- Remove duplicate `window-all-closed` handler and stray syntax from #705 merge (8929688)
- 24 UX/accessibility issues from comprehensive audit (382debb)
- Packaged app crashes and runtime failures on macOS 26 (3292b1f)
- E2E tests: skip onboarding, fix stale selector, remove compiled artifacts (d71d572)
- CI: install electron binary for tests, externalize naudiodon (efa93f1)
- CI: add esbuild@0.27.7 for vitest/vite@8, update shortcut test (2897c6c)
- Audit findings: compile errors, type safety, a11y, code quality (3c64f8d)

### Docs
- README/docs overhaul — Why/Comparison/Differentiating sections + cloud-boost + glossary (3a3edf9)
- Rewrite Core Values to local-first + JA-EN meeting focus (4ce2336)
- Expand Won't Do entries (multilingual/meeting-platform/Linux) (1d28082)
- Add `Conversational JA↔EN translation benchmark` scaffold (5259973)
- Voice cloning speech-to-speech output research (b174b13)
- Qwen3-MT translation evaluation research (f77b03b)
- SharedArrayBuffer zero-copy audio IPC feasibility research (8061d2e)
- Linux support feasibility evaluation research (7fbb09c)

### Infrastructure
- Sync ai-dev-template common + web layer files (85b6899, 84908d9, 47fb33d, 710be39, e4682e5, ced686e, bb60cad)
- Update package-lock.json to sync esbuild 0.27.7 (a5c8ec8)
