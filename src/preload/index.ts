import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Pipeline control
  pipelineStart: (config: unknown) => ipcRenderer.invoke('pipeline-start', config),
  pipelineStop: () => ipcRenderer.invoke('pipeline-stop'),
  processAudio: (audioData: number[]) => ipcRenderer.invoke('process-audio', audioData),

  // Translation results
  sendTranslationResult: (data: unknown) => ipcRenderer.send('translation-result', data),
  onTranslationResult: (callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('translation-result', handler)
    return () => ipcRenderer.off('translation-result', handler)
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
    ipcRenderer.send('move-subtitle-to-display', displayId)
})
