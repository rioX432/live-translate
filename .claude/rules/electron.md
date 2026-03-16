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
