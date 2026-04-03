---
description: Electron main process and IPC patterns
globs: src/main/**/*.ts, src/preload/**/*.ts
---

# Electron Main Process Rules

## IPC Communication
- All audio data transfer: `Array.from(Float32Array)` in renderer → `new Float32Array(array)` in main
- Never transfer `ArrayBuffer` or `Float32Array` directly via IPC — Electron serializes them incorrectly
- Use `ipcMain.handle` for request/response, `ipcMain.on` for fire-and-forget
- All IPC channels must be exposed via preload's `contextBridge`

## Window Management
- Main window: standard window for settings panel
- Subtitle window: `transparent: true, frame: false, alwaysOnTop: true`
- Subtitle window uses `setIgnoreMouseEvents(true)` for click-through
- Use `screen.getAllDisplays()` to detect external displays

## Native Addons
- whisper-node-addon runs in main process only (native code cannot run in renderer)
- Model files stored in `app.getPath('userData')/models/`
- Auto-download model on first use via `model-downloader.ts`

## Global Keyboard Shortcuts
- `shortcut-manager.ts` registers/unregisters global shortcuts via Electron's `globalShortcut` API
- Default bindings use Ctrl+Shift modifier pattern
- Shortcuts are configurable via `KeyboardShortcuts.tsx` settings panel
- IPC: `shortcut-ipc.ts` handles shortcut registration/update from renderer

## Cross-Platform (Windows)
- Window management: platform-specific transparency handling (Windows requires different config)
- Native addons: whisper-node-addon has separate Windows binaries
- CUDA recommended for GPU acceleration on Windows (auto-detected via `gpu-detector.ts`)
- CI builds for both macOS and Windows via GitHub Actions

## Enterprise / MDM
- `mdm-config.ts` reads MDM-managed configuration (e.g., macOS managed preferences, Windows registry)
- Admin lock prevents users from changing certain settings
- `enterprise-ipc.ts` exposes enterprise config to renderer
- Usage analytics and telemetry consent tracked via electron-store
