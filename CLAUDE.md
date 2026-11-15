# CLAUDE.md

Strictly follow the rules in [AGENTS.md](./AGENTS.md).

## Core Values

1. **ローカルファースト翻訳** — 翻訳は端末内で完結し、クラウド推論とAPI鍵は持たない。会議内容を外部へ送らず、ネット非依存を維持する（モデルのダウンロードと自動更新のみ通信）
2. **リアルタイム性の極限追求** — 発話から翻訳表示までの遅延を最小化。会話の流れを止めない即時翻訳
3. **JA↔EN会議字幕特化** — 多言語汎用ではなくJA↔ENの口語会議用途に集中。会議体験の最適化にリソースを集中投下

## Won't Do
- **エンジン選択をUIに見せる** — 役割ごとに1エンジン（STT: Apple Silicon は Qwen3-ASR 0.6B、それ以外は whisper.cpp / 翻訳: Hy-MT2 1.8B）。プラットフォームで自動決定し、ユーザーに選ばせない
- **多言語対応の汎用拡大（40+言語）** — JA↔EN特化がCore Value③。汎用多言語はSokuji/Feloの領域
- **会議プラットフォーム直接統合（Teams/Zoom/Meetプラグイン）** — オーバーレイの責務外。仮想マイクで既に対応可能
- **Linux対応** — ユーザーベースが小さく、ネイティブオーディオAPI対応のコストがCore Value向上に見合わない
- **TTS（音声出力）機能** — 字幕オーバーレイの責務外。音声合成はSokujiの領域
- **Chrome拡張化** — Sokujiの領域。Electronで仮想マイク+システム音声キャプチャまでカバー済み

## Think Twice

Before acting, always pause and reconsider. Re-read the requirements, re-check your assumptions, and verify your approach is correct before writing any code.

## Research-First Development (No Guessing)

**Guessing is prohibited.** Never design or implement based on assumptions. Always follow this order:

1. **Investigate first** — Read official docs, inspect source code, or web-search to confirm API signatures, behavior, and best practices. If a library API is unfamiliar, look it up before using it.
2. **Self-review** — After designing or implementing, verify:
   - Consistency with existing patterns in the codebase
   - Edge cases are handled
   - No unverified assumptions crept in
3. **Cross-review with Codex** — If Codex MCP (`mcp__codex__codex`) is available, use it to cross-check:
   - New module or architecture designs
   - Implementations that deviate from existing patterns
   - Code review requests (always cross-review with Codex)
4. **Proceed only with confirmed information** — If the source of truth is unclear, investigate further or ask the user before writing code.

## Key Gotchas

- whisper-node-addon ships `mac-arm64/` dir but code expects `darwin-arm64/` — postinstall script creates symlink
- whisper-node-addon dylib has hardcoded `@rpath` from CI — postinstall adds local rpath via `install_name_tool`
- Electron IPC cannot transfer `Float32Array` directly — use `Array.from()` in renderer, `new Float32Array()` in main
- macOS microphone permission: Electron dev mode runs via Terminal — grant mic access to Terminal.app in System Preferences
- VAD uses `AudioWorkletNode` via `processorType: 'AudioWorklet'` — do not revert to deprecated `ScriptProcessorNode`
- electron-vite 2.x requires `build.lib.entry` for main/preload configs
- One engine per role, chosen by `selectEngines()` in `src/engines/engine-selection.ts`: Qwen3-ASR 0.6B (8-bit MLX) on Apple Silicon, whisper.cpp large-v3-turbo elsewhere; Hy-MT2 1.8B (Q4_K_M) translates everywhere. Main ignores engine IDs sent by the renderer
- Qwen3-ASR runs in a resident Swift helper (`scripts/qwen3-asr-helper`, built by `scripts/build-qwen3-asr-helper.sh` with xcodebuild so MLX's Metal kernels ship) — no Python install. `ResidentProcess` restarts it and gives up after repeated failures
- HY-MT1.5 must not come back as a default: its license excludes the EU, UK and South Korea
- Default models (~600MB-1.1GB each) download on first launch — handle offline gracefully
- TranslateGemma GGUF is used only for meeting summaries, not for live translation
- GGUF models download with resume support and SHA256 verification
- node-llama-cpp runs in shared UtilityProcess pool (worker-pool.ts → slm-worker.ts), not main process
- electron-store is plain JSON (no encryption key) — the app holds no secrets; `legacy-store.ts` strips keys left by old versions before the store opens
- Model downloads are pinned to a Hugging Face commit and SHA256 (`model-pins.test.ts` enforces it)
- The renderer CSP lives in `src/renderer/index.html`; the dev server relaxes it via `devCsp()` in `electron.vite.config.ts`
- IPC paths must be validated against directory traversal before file operations

## Language

- All code (comments, variable names, documentation) must be written in English
- All PR titles, descriptions, and commit messages must be written in English

## Git Commits

- Keep commit messages concise (one line or short paragraph)
- Do NOT add AI stamps or `Co-Authored-By` lines
