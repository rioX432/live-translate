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
| `organizationName` | string | `null` | Organization label shown in the Enterprise settings panel. |
| `autoUpdateDisabled` | boolean | `false` | When `true`, suppresses in-app auto-update (admin manages updates via MDM). |

## Injection behaviour

The MDM `lockedEngine` / `lockedSttEngine` values override the user's engine
selection unconditionally. The app holds no API keys, so MDM no longer injects
any. Keys left in an old profile (`managed*ApiKey`, `managedMicrosoftRegion`) are
ignored and never exposed.

## Renderer exposure

`src/main/ipc/enterprise-ipc.ts` sends the MDM config to the renderer.

Renderer-visible shape:

```ts
interface MdmConfig {
  lockedEngine: string | null
  lockedSttEngine: string | null
  telemetryDisabled: boolean
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
  <string>auto</string>

  <key>telemetryDisabled</key>
  <true/>
  <key>autoUpdateDisabled</key>
  <true/>
</dict>
```

## Out of scope

- Windows registry / Group Policy support for managed preferences.
