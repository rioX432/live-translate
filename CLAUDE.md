# CLAUDE.md

Strictly follow the rules in [AGENTS.md](./AGENTS.md).

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
- `ScriptProcessorNode` is deprecated — migrate to `AudioWorkletNode` when stability is confirmed
- electron-vite 2.x requires `build.lib.entry` for main/preload configs
- Whisper model (~540MB) downloads on first launch — handle offline gracefully
- TranslateGemma is experimental only (8s/sentence too slow for real-time) — OPUS-MT is the fast default (279ms)
- Hunyuan-MT 7B is quality mode only (3.7s JA→EN) — not suitable for real-time streaming
- GGUF models (~2.6GB+) download with resume support and SHA256 verification
- Google Cloud Translation API v2 free tier: 500K chars/month, 6000 req/min
- node-llama-cpp runs in UtilityProcess (slm-worker.ts), not main process
- Lightning Whisper MLX and Moonshine removed — JA CER too high (162% and 221% respectively)
- electron-store is encrypted — API keys are not stored in plaintext
- IPC paths must be validated against directory traversal before file operations

## Language

- All code (comments, variable names, documentation) must be written in English
- All PR titles, descriptions, and commit messages must be written in English

## Git Commits

- Keep commit messages concise (one line or short paragraph)
- Do NOT add AI stamps or `Co-Authored-By` lines
