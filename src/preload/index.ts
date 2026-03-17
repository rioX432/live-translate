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
    ipcRenderer.on('translation-result', (_event, data) => callback(data))
  },
  onInterimResult: (callback: (data: unknown) => void) => {
    ipcRenderer.on('interim-result', (_event, data) => callback(data))
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
