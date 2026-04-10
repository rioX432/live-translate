import { ipcMain } from 'electron'
import { WsAudioServer } from '../ws-audio-server'
import { store } from '../store'
import { sanitizeErrorMessage } from '../error-utils'
import { createLogger } from '../logger'
import type { AppContext } from '../app-context'
import { DEFAULT_WS_PORT, SAMPLE_RATE } from '../constants'

const log = createLogger('ipc:audio')

/** Register WebSocket audio server IPC handlers */
export function registerAudioIpc(ctx: AppContext): void {
  ipcMain.handle('ws-audio-start', async (_event, port?: number) => {
    try {
      if (ctx.wsAudioServer?.running) {
        return { error: 'WebSocket audio server is already running' }
      }

      ctx.wsAudioServer = new WsAudioServer(port || store.get('wsAudioPort') || DEFAULT_WS_PORT)

      // Forward received audio to the pipeline
      ctx.wsAudioServer.on('audio', async (chunk: Float32Array) => {
        if (!ctx.pipeline?.running) return

        try {
          await ctx.pipeline.process(chunk, SAMPLE_RATE)
        } catch (err) {
          log.error('Pipeline processing error (ws-audio):', err)
        }
      })

      ctx.wsAudioServer.on('connected', () => {
        ctx.mainWindow?.webContents.send('status-update', 'Chrome extension connected')
        ctx.mainWindow?.webContents.send('ws-audio-status', { connected: true, running: true, port: ctx.wsAudioServer?.port })
      })

      ctx.wsAudioServer.on('disconnected', () => {
        ctx.mainWindow?.webContents.send('status-update', 'Chrome extension disconnected')
        ctx.mainWindow?.webContents.send('ws-audio-status', { connected: false, running: ctx.wsAudioServer?.running ?? false, port: ctx.wsAudioServer?.port })
      })

      ctx.wsAudioServer.on('error', (err: Error) => {
        ctx.mainWindow?.webContents.send('status-update', `WebSocket error: ${sanitizeErrorMessage(err.message)}`)
      })

      await ctx.wsAudioServer.start()
      ctx.mainWindow?.webContents.send('ws-audio-status', { connected: false, running: true, port: ctx.wsAudioServer.port })
      return { success: true, port: ctx.wsAudioServer.port }
    } catch (err) {
      return { error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) }
    }
  })

  ipcMain.handle('ws-audio-stop', async () => {
    try {
      if (ctx.wsAudioServer) {
        ctx.wsAudioServer.removeAllListeners()
        await ctx.wsAudioServer.stop()
        ctx.wsAudioServer = null
      }
      ctx.mainWindow?.webContents.send('ws-audio-status', { connected: false, running: false, port: null })
      return { success: true }
    } catch (err) {
      return { error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) }
    }
  })

  ipcMain.handle('ws-audio-get-status', () => {
    return {
      running: ctx.wsAudioServer?.running ?? false,
      connected: ctx.wsAudioServer?.hasClient ?? false,
      port: ctx.wsAudioServer?.port ?? store.get('wsAudioPort') ?? DEFAULT_WS_PORT
    }
  })
}
