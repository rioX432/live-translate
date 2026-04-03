---
description: React renderer and UI patterns
globs: src/renderer/**/*.tsx, src/renderer/**/*.ts
---

# Renderer Rules

## Audio Capture
- Use `getUserMedia` with `{ channelCount: 1, sampleRate: { ideal: 16000 } }`
- Buffer audio in 3-second chunks before sending to main process via IPC
- Convert `Float32Array` to `Array.from()` before IPC send

## Subtitle Overlay
- Transparent background (`rgba(0,0,0,0)` on body)
- Max 3 lines visible, old lines fade out after 8 seconds
- Source text in white, translated text color-coded by source language
- Font: system font, 28-30px, semi-bold, with text shadow for readability

## Settings Panel
- Dark theme (slate-900 background)
- Disable controls while pipeline is running
- Show status messages from main process via `onStatusUpdate` IPC
- Persist settings with electron-store
- Settings are split into modular components under `components/settings/`

## Accessibility
- `AccessibilitySettings.tsx` — high contrast mode, dyslexia-friendly font (OpenDyslexic), letter/word spacing
- Accessibility state applies to both settings panel and subtitle overlay
- WCAG compliance: sufficient contrast ratios, keyboard navigation support

## Keyboard Shortcuts
- `KeyboardShortcuts.tsx` — shortcut configuration UI
- Shortcuts registered globally via `shortcut-manager.ts` in main process
- Ctrl+Shift based default bindings for overlay control (toggle, position, etc.)

## Enterprise Settings
- `EnterpriseSettings.tsx` — MDM configuration display, admin lock, telemetry consent
- Admin-locked settings are read-only in UI
