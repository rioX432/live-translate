# MDM Configuration Reference

Live Translate reads MDM-managed configuration on macOS from
`/Library/Managed Preferences/com.live-translate.app.plist`. The plist is
written by an MDM-deployed configuration profile (PayloadType
`com.live-translate.app`).

On non-macOS platforms there is currently no MDM enforcement and every value
defaults to `null` / `false`.

## Supported keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `lockedEngine` | string | `null` | Force the translator engine ID. Overrides user selection. |
| `lockedSttEngine` | string | `null` | Force the STT engine ID. Overrides user selection. |
| `telemetryDisabled` | boolean (`<true/>` / `<false/>`) | `false` | When `true`, blocks the user from enabling telemetry. |
| `managedApiKey` | string | `null` | Google Cloud Translation API key injected when the user has not set one. |
| `managedDeeplApiKey` | string | `null` | DeepL API key injected when the user has not set one. |
| `managedGeminiApiKey` | string | `null` | Gemini API key injected when the user has not set one. |
| `managedMicrosoftApiKey` | string | `null` | **(#704)** Microsoft (Azure) Translator API key injected when the user has not set one. |
| `managedMicrosoftRegion` | string | `null` | **(#704)** Microsoft (Azure) Translator region (e.g. `japaneast`, `eastus`). Required together with `managedMicrosoftApiKey` for the engine to start. |
| `organizationName` | string | `null` | Organization label shown in the Enterprise settings panel. |
| `autoUpdateDisabled` | boolean | `false` | When `true`, suppresses in-app auto-update (admin manages updates via MDM). |

## Injection behaviour

When the user starts a pipeline, the main process merges MDM-managed API keys
into the runtime config in `src/main/ipc/pipeline-ipc.ts`:

1. MDM keys are only applied when the user has **not** set a key of their own.
2. `managedMicrosoftApiKey` is only effective when `managedMicrosoftRegion` is
   also provided — Azure Translator requires both.
3. The MDM `lockedEngine` / `lockedSttEngine` values override the user's
   engine selection unconditionally.

## Renderer exposure

`src/main/ipc/enterprise-ipc.ts` strips secret values before sending the MDM
config to the renderer. The renderer receives only boolean presence flags for
each API key. The region (a non-secret identifier) is sent as-is so the UI can
display it.

Renderer-visible shape:

```ts
interface MdmConfig {
  lockedEngine: string | null
  lockedSttEngine: string | null
  telemetryDisabled: boolean
  hasManagedApiKey: boolean
  hasManagedDeeplApiKey: boolean
  hasManagedGeminiApiKey: boolean
  hasManagedMicrosoftApiKey: boolean
  managedMicrosoftRegion: string | null
  organizationName: string | null
  autoUpdateDisabled: boolean
}
```

## Example configuration profile

```xml
<dict>
  <key>PayloadType</key>
  <string>com.live-translate.app</string>

  <key>organizationName</key>
  <string>Acme Corp</string>

  <key>lockedEngine</key>
  <string>rotation-controller</string>

  <key>managedMicrosoftApiKey</key>
  <string>YOUR-AZURE-TRANSLATOR-KEY</string>
  <key>managedMicrosoftRegion</key>
  <string>japaneast</string>

  <key>telemetryDisabled</key>
  <true/>
  <key>autoUpdateDisabled</key>
  <true/>
</dict>
```

## Out of scope

- Region string validation (Azure publishes a finite list of regions). Tracked
  for Phase 2 once the broader managed-policy spec lands.
- Windows registry / Group Policy support for managed preferences.
