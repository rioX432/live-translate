import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Pipeline control
  pipelineStart: (config: unknown) => ipcRenderer.invoke('pipeline-start', config),
  pipelineStop: () => ipcRenderer.invoke('pipeline-stop'),
  processAudio: (audioData: number[]) => ipcRenderer.invoke('process-audio', audioData),

  // Translation results
  sendTranslationResult: (data: unknown) => ipcRenderer.send('translation-result', data),
  onTranslationResult: (callback: (data: unknown) => void) => {
    ipcRenderer.on('translation-result', (_event, data) => callback(data))
  },

  // Status updates from main process
  onStatusUpdate: (callback: (message: string) => void) => {
    ipcRenderer.on('status-update', (_event, message) => callback(message))
  },

  // Display management
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  moveSubtitleToDisplay: (displayId: number) =>
    ipcRenderer.send('move-subtitle-to-display', displayId)
})
