import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Pipeline control
  pipelineStart: (config: unknown) => ipcRenderer.invoke('pipeline-start', config),
  pipelineStop: () => ipcRenderer.invoke('pipeline-stop'),
  processAudio: (audioData: number[]) => ipcRenderer.invoke('process-audio', audioData),
  processAudioStreaming: (audioData: number[]) => ipcRenderer.invoke('process-audio-streaming', audioData),
  finalizeStreaming: (audioData: number[]) => ipcRenderer.invoke('finalize-streaming', audioData),

  // Translation results
  onTranslationResult: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('translation-result', handler)
    return () => ipcRenderer.off('translation-result', handler)
  },
  onInterimResult: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('interim-result', handler)
    return () => ipcRenderer.off('interim-result', handler)
  },
  // Draft result from hybrid translation (#235)
  onDraftResult: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('draft-result', handler)
    return () => ipcRenderer.off('draft-result', handler)
  },

  // Status updates from main process
  onStatusUpdate: (callback: (message: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('status-update', handler)
    return () => ipcRenderer.off('status-update', handler)
  },

  // Session info
  getSessionStartTime: () => ipcRenderer.invoke('get-session-start-time'),

  // Display management
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  moveSubtitleToDisplay: (displayId: number) =>
    ipcRenderer.send('move-subtitle-to-display', displayId),

  // Settings persistence (#49)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('save-settings', settings),

  // Crash recovery (#54)
  getCrashedSession: () => ipcRenderer.invoke('get-crashed-session'),

  // Session management (#121)
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  loadSession: (id: string) => ipcRenderer.invoke('load-session', id),
  searchSessions: (query: string) => ipcRenderer.invoke('search-sessions', query),
  deleteSession: (id: string) => ipcRenderer.invoke('delete-session', id),
  exportSession: (id: string, format: string) => ipcRenderer.invoke('export-session', id, format),

  // GGUF model management (#133)
  getGgufVariants: (modelSize?: string) => ipcRenderer.invoke('get-gguf-variants', modelSize),

  // Plugin management (#127)
  listPlugins: () => ipcRenderer.invoke('list-plugins'),

  // Session logs (#116)
  getSessionLogs: () => ipcRenderer.invoke('get-session-logs'),

  // Meeting summary (#124)
  generateSummary: (transcriptPath: string) =>
    ipcRenderer.invoke('generate-summary', transcriptPath),

  // GPU detection (#132)
  detectGpu: () => ipcRenderer.invoke('detect-gpu'),

  // Subtitle settings (#118)
  saveSubtitleSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('save-subtitle-settings', settings),
  onSubtitleSettingsChanged: (callback: (settings: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: unknown): void => callback(settings)
    ipcRenderer.on('subtitle-settings-changed', handler)
    return () => ipcRenderer.off('subtitle-settings-changed', handler)
  },

  // Glossary management (#240)
  saveGlossary: (terms: Array<{ source: string; target: string }>) =>
    ipcRenderer.invoke('save-glossary', terms),

  // #238: Check if draft model (4B) is available for speculative decoding
  isDraftModelAvailable: () => ipcRenderer.invoke('is-draft-model-available'),

  // #261: Whisper model variant info
  getWhisperVariants: () => ipcRenderer.invoke('get-whisper-variants'),

  // #243: Platform detection for hiding platform-specific options
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Display change notifications (#192)
  onDisplaysChanged: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('displays-changed', handler)
    return () => ipcRenderer.off('displays-changed', handler)
  }
})
