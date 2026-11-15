import { ipcMain } from 'electron'
import { parseAudioMessage, routeAudio } from './audio-routing'
import { setupAudioPort } from './audio-port'
import type { AppContext } from './app-context'

/**
 * Register the invoke-based audio channels. The renderer prefers the
 * MessagePort set up in audio-port.ts and uses these only until that port
 * has arrived.
 */
export function registerAudioHandlers(ctx: AppContext): void {
  ipcMain.on('request-audio-port', (event) => {
    // Only the settings window captures audio.
    if (event.sender !== ctx.mainWindow?.webContents) return
    setupAudioPort(ctx, event.sender)
  })

  ipcMain.handle('process-audio-streaming', async (_event, payload: unknown) => {
    const msg = parseAudioMessage('interim', payload)
    return msg ? routeAudio(ctx, msg, 'ipc') : null
  })

  ipcMain.handle('finalize-streaming', async (_event, payload: unknown) => {
    const msg = parseAudioMessage('final', payload)
    return msg ? routeAudio(ctx, msg, 'ipc') : null
  })
}
