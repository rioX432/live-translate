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

  // Glossary management (#240, #517)
  saveGlossary: (terms: Array<{ source: string; target: string }>) =>
    ipcRenderer.invoke('save-glossary', terms),
  saveOrgGlossary: (terms: Array<{ source: string; target: string }>) =>
    ipcRenderer.invoke('save-org-glossary', terms),
  importGlossary: (target: 'personal' | 'org') =>
    ipcRenderer.invoke('import-glossary', target),
  exportGlossary: (target: 'personal' | 'org', format: 'json' | 'csv') =>
    ipcRenderer.invoke('export-glossary', target, format),
  getMergedGlossary: () => ipcRenderer.invoke('get-merged-glossary'),

  // #238: Check if draft model is available for speculative decoding
  isDraftModelAvailable: (engine?: string) => ipcRenderer.invoke('is-draft-model-available', engine),

  // #261: Whisper model variant info
  getWhisperVariants: () => ipcRenderer.invoke('get-whisper-variants'),

  // #243: Platform detection for hiding platform-specific options
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // Display change notifications (#192)
  onDisplaysChanged: (callback: () => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('displays-changed', handler)
    return () => ipcRenderer.off('displays-changed', handler)
  },

  // WebSocket audio server for Chrome extension (#264)
  wsAudioStart: (port?: number) => ipcRenderer.invoke('ws-audio-start', port),
  wsAudioStop: () => ipcRenderer.invoke('ws-audio-stop'),
  wsAudioGetStatus: () => ipcRenderer.invoke('ws-audio-get-status'),
  onWsAudioStatus: (callback: (status: { running: boolean; connected: boolean; port: number | null }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { running: boolean; connected: boolean; port: number | null }): void => callback(status)
    ipcRenderer.on('ws-audio-status', handler)
    return () => ipcRenderer.off('ws-audio-status', handler)
  },

  // System audio loopback (#501)
  enableLoopbackAudio: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopbackAudio: () => ipcRenderer.invoke('disable-loopback-audio'),

  // Subtitle drag mode (#509)
  toggleSubtitleDragMode: (enabled: boolean) =>
    ipcRenderer.invoke('toggle-subtitle-drag-mode', enabled),
  moveSubtitleByDelta: (dx: number, dy: number) =>
    ipcRenderer.send('move-subtitle-by-delta', dx, dy),
  saveSubtitlePosition: () => ipcRenderer.invoke('save-subtitle-position'),
  resetSubtitlePosition: () => ipcRenderer.invoke('reset-subtitle-position'),
  onDragModeChanged: (callback: (enabled: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean): void => callback(enabled)
    ipcRenderer.on('drag-mode-changed', handler)
    return () => ipcRenderer.off('drag-mode-changed', handler)
  },

  // TTS (#508)
  ttsSetEnabled: (enabled: boolean) => ipcRenderer.invoke('tts-set-enabled', enabled),
  ttsSetVoice: (voiceId: string) => ipcRenderer.invoke('tts-set-voice', voiceId),
  ttsSetVolume: (volume: number) => ipcRenderer.invoke('tts-set-volume', volume),
  ttsSetOutputDevice: (deviceId: string) => ipcRenderer.invoke('tts-set-output-device', deviceId),
  ttsGetSettings: () => ipcRenderer.invoke('tts-get-settings'),
  onTtsAudio: (callback: (data: { audio: number[]; sampleRate: number; volume: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { audio: number[]; sampleRate: number; volume: number }): void => callback(data)
    ipcRenderer.on('tts-audio', handler)
    return () => ipcRenderer.off('tts-audio', handler)
  },

  // Virtual Mic (#515)
  virtualMicGetStatus: () => ipcRenderer.invoke('virtual-mic-get-status'),
  virtualMicEnable: (deviceId: number) => ipcRenderer.invoke('virtual-mic-enable', deviceId),
  virtualMicDisable: () => ipcRenderer.invoke('virtual-mic-disable'),
  virtualMicRefreshDevices: () => ipcRenderer.invoke('virtual-mic-refresh-devices'),

  // Quick Start onboarding (#510)
  quickStartRecommend: () => ipcRenderer.invoke('quick-start-recommend'),
  quickStartApply: (options: { sourceLanguage: string; targetLanguage: string; recommendation: unknown }) =>
    ipcRenderer.invoke('quick-start-apply', options),
  quickStartIsCompleted: () => ipcRenderer.invoke('quick-start-is-completed'),
  quickStartSkip: () => ipcRenderer.invoke('quick-start-skip'),
  quickStartSystemInfo: () => ipcRenderer.invoke('quick-start-system-info'),

  // Auto-update (#314)
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  updateGetStatus: () => ipcRenderer.invoke('update-get-status'),
  onUpdateStatus: (callback: (status: { state: string; version?: string; progress?: number; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { state: string; version?: string; progress?: number; error?: string }): void => callback(status)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.off('update-status', handler)
  }
})
