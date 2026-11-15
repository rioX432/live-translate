# Removed: TTS, virtual mic, Chrome extension audio server, MDM/Enterprise

These four features sat outside the subtitle overlay's job (see `## Won't Do` in `CLAUDE.md`) and added native
dependencies and IPC surface to maintain. The code is not lost: every path below exists at commit `95ad6fb`.
Recover a file with `git show 95ad6fb:<path>`.

## Removed code (paths at `95ad6fb`)

| Feature | Paths |
|---|---|
| TTS (#508, Kokoro) | `src/engines/tts/KokoroTTSEngine.ts`, `src/main/tts-manager.ts`, `src/main/ipc/tts-ipc.ts`, `src/renderer/components/settings/TTSSettings.tsx`, the `TTSEngine`/`TTSResult` types in `src/engines/types.ts` |
| Virtual mic output (#515, naudiodon) | `src/main/virtual-mic-manager.ts` (+ test), `src/main/ipc/virtual-mic-ipc.ts`, `src/renderer/components/settings/VirtualMicSettings.tsx` |
| Chrome extension audio (#264) | `chrome-extension/`, `src/main/ws-audio-server.ts`, `src/main/ipc/audio-ipc.ts`, `DEFAULT_WS_PORT` in `src/main/constants.ts` |
| MDM / Enterprise (#519) | `src/main/mdm-config.ts` (+ test), `src/main/ipc/enterprise-ipc.ts`, `src/renderer/components/settings/EnterpriseSettings.tsx`, the engine admin lock in `src/main/ipc/pipeline-ipc.ts`, `docs/mdm-config.md` |

Also removed: the matching preload methods and types, the `save-settings` allowlist entries, the `kokoro-js`, `ws`,
`@types/ws` and `naudiodon` dependencies, and the `naudiodon` build external.

## Kept

`src/logger/UsageAnalytics.ts` still records aggregate session counts (no meeting content) to `userData/analytics`.
Its only reader was the Enterprise panel, so nothing displays it now.

## Existing installs

The store has no JSON schema, so keys an older version saved (`ttsEnabled`, `ttsVoice`, `ttsOutputDevice`,
`ttsVolume`, `virtualMicEnabled`, `virtualMicDeviceId`, `wsAudioPort`, `telemetryConsent`, `telemetryConsentShown`)
stay in `config.json` and are ignored: `get-settings` no longer returns them and the renderer no longer sends them.
