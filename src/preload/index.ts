import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Pipeline control
  pipelineStart: (config: unknown) => ipcRenderer.invoke('pipeline-start', config),
  pipelineStop: () => ipcRenderer.invoke('pipeline-stop'),
  processAudio: (audioData: number[]) => ipcRenderer.invoke('process-audio', audioData),
  processAudioStreaming: (audioData: number[]) => ipcRenderer.invoke('process-audio-streaming', audioData),
  finalizeStreaming: (audioData: number[]) => ipcRenderer.invoke('finalize-streaming', audioData),

  // Translation results
  sendTranslationResult: (data: unknown) => ipcRenderer.send('translation-result', data),
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

  // GPU detection (#132)
  detectGpu: () => ipcRenderer.invoke('detect-gpu'),

  // Subtitle settings (#118)
  saveSubtitleSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('save-subtitle-settings', settings),
  onSubtitleSettingsChanged: (callback: (settings: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: unknown): void => callback(settings)
    ipcRenderer.on('subtitle-settings-changed', handler)
    return () => ipcRenderer.off('subtitle-settings-changed', handler)
  }
})
