# Local-only migration: removed cloud inference

Cloud inference was removed so the app holds no API keys and sends no meeting content off the device.
The code is not lost: every path below exists at commit `3db2c34` (the parent of this migration, `main` after PR #751).
Recover a file with `git show 3db2c34:<path>`.

## Removed code (paths at `3db2c34`)

| Area | Paths |
|---|---|
| Cloud translators | `src/engines/translator/{GoogleTranslator,DeepLTranslator,GeminiTranslator,MicrosoftTranslator}.ts` and their tests |
| Provider rotation | `src/engines/translator/ApiRotationController.ts` (+ test), `src/engines/translator/api-utils.ts` |
| Cloud realtime E2E | `src/engines/e2e/{CloudRealtimeE2E,GeminiLiveE2E,audioEncoding}.ts` (+ tests) |
| Cloud streaming plumbing | `src/main/realtime-audio.ts`, `src/renderer/hooks/realtimeChunker.ts`, `src/pipeline/E2EStreamingAdapter.ts` (+ tests), the realtime mode of `useAudioCapture`, the preload `#721` realtime API |
| Shadow harness cloud path | `src/pipeline/shadow/paths/E2EStreamingShadowPath.ts` (+ test) |
| Benchmark cloud engines | `benchmark/src/engines/{google-translate,deepl,gemini,microsoft}.ts`, `benchmark/gpt-realtime-whisper-eval/*` except `RESULTS.md` |
| Docs | `docs/cloud-boost.md` |

Also removed: key-input UI and the onboarding key step, MDM key injection (`managed*ApiKey`), the automatic Google
fallback, `auto` mode switching to rotation, and the `package.json` cloud scripts.

## Kept

Past research and measurements stay in `docs/research/` (for example `698-gpt-realtime-whisper-eval.md`) and
`benchmark/gpt-realtime-whisper-eval/RESULTS.md`. They describe the cloud options as they were evaluated.

## Migration of existing installs

- `src/main/legacy-store.ts` rewrites an old encrypted `config.json` as plain JSON without any key, quota or session
  fields, before the store opens. An unreadable file is never modified.
- `src/main/store-migrations.ts` maps the removed engine IDs (`rotation`, `online`, `online-deepl`, `online-gemini`) to `auto`.
