import { ipcMain } from 'electron'
import { sanitizeErrorMessage } from './error-utils'
import type { AppContext } from './app-context'

/** Minimum amplitude to consider a chunk as non-silent */
const SILENCE_THRESHOLD = 0.001

/** Convert IPC audio data to Float32Array, returning null for silence */
function toFloat32Array(audioData: unknown): Float32Array | null {
  let chunk: Float32Array
  if (audioData instanceof Float32Array) {
    chunk = audioData
  } else if (Array.isArray(audioData)) {
    chunk = new Float32Array(audioData)
  } else if (audioData instanceof ArrayBuffer || Buffer.isBuffer(audioData)) {
    chunk = new Float32Array(
      Buffer.isBuffer(audioData) ? audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength) : audioData
    )
  } else {
    console.error('[audio] Unknown data type:', typeof audioData)
    return null
  }

  // Scan for max amplitude (used for silence detection)
  let maxAmp = 0
  for (let i = 0; i < chunk.length; i++) {
    const abs = Math.abs(chunk[i])
    if (abs > maxAmp) maxAmp = abs
  }

  if (maxAmp < SILENCE_THRESHOLD) {
    return null
  }

  return chunk
}

/** Register audio processing IPC handlers */
export function registerAudioHandlers(ctx: AppContext): void {
  // Process audio chunk from renderer
  ipcMain.handle('process-audio', async (_event, audioData: unknown) => {
    if (!ctx.pipeline?.running) return null

    const chunk = toFloat32Array(audioData)
    if (!chunk || chunk.length < 8000) return null

    try {
      return await ctx.pipeline.process(chunk, 16000)
    } catch (err) {
      console.error('[audio] Pipeline error:', err)
      // #43: propagate error to renderer
      const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err))
      ctx.mainWindow?.webContents.send('status-update', `Processing error: ${message}`)
      return null
    }
  })

  // Process streaming audio (rolling buffer during speech)
  ipcMain.handle('process-audio-streaming', async (_event, audioData: unknown) => {
    if (!ctx.pipeline?.running) return null

    const chunk = toFloat32Array(audioData)
    if (!chunk || chunk.length < 8000) return null

    try {
      return await ctx.pipeline.processStreaming(chunk, 16000)
    } catch (err) {
      console.error('[audio] Streaming pipeline error:', err)
      return null
    }
  })

  // Finalize streaming (speech segment ended)
  ipcMain.handle('finalize-streaming', async (_event, audioData: unknown) => {
    if (!ctx.pipeline?.running) return null

    const chunk = toFloat32Array(audioData)
    if (!chunk || chunk.length < 8000) return null

    try {
      return await ctx.pipeline.finalizeStreaming(chunk, 16000)
    } catch (err) {
      console.error('[audio] Finalize streaming error:', err)
      return null
    }
  })
}
