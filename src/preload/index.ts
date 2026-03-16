import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  sendTranslationResult: (data: unknown) => ipcRenderer.send('translation-result', data),
  onTranslationResult: (callback: (data: unknown) => void) => {
    ipcRenderer.on('translation-result', (_event, data) => callback(data))
  },
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  moveSubtitleToDisplay: (displayId: number) =>
    ipcRenderer.send('move-subtitle-to-display', displayId)
})
