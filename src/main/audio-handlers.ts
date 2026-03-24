import { ipcMain } from 'electron'
import { sanitizeErrorMessage } from './error-utils'
import { createLogger } from './logger'
import type { AppContext } from './app-context'

const log = createLogger('audio')

/** Minimum number of samples for a valid audio chunk (0.5s at 16kHz) */
const MIN_AUDIO_CHUNK_SAMPLES = 8000

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
    log.error('Unknown data type:', typeof audioData)
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

/**
 * Validate and convert IPC audio data to Float32Array.
 * Returns null if data is invalid, too short, or silent.
 */
function toValidAudioChunk(audioData: unknown): Float32Array | null {
  const chunk = toFloat32Array(audioData)
  if (!chunk || chunk.length < MIN_AUDIO_CHUNK_SAMPLES) return null
  return chunk
}

/** Register audio processing IPC handlers */
export function registerAudioHandlers(ctx: AppContext): void {
  // Process audio chunk from renderer
  ipcMain.handle('process-audio', async (_event, audioData: unknown) => {
    if (!ctx.pipeline?.running) return null

    const chunk = toValidAudioChunk(audioData)
    if (!chunk) return null

    try {
      return await ctx.pipeline.process(chunk, 16000)
    } catch (err) {
      log.error('Pipeline error:', err)
      // #43: propagate error to renderer
      const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err))
      ctx.mainWindow?.webContents.send('status-update', `Processing error: ${message}`)
      return null
    }
  })

  // Process streaming audio (rolling buffer during speech)
  ipcMain.handle('process-audio-streaming', async (_event, audioData: unknown) => {
    if (!ctx.pipeline?.running) return null

    const chunk = toValidAudioChunk(audioData)
    if (!chunk) return null

    try {
      return await ctx.pipeline.processStreaming(chunk, 16000)
    } catch (err) {
      log.error('Streaming pipeline error:', err)
      return null
    }
  })

  // Finalize streaming (speech segment ended)
  ipcMain.handle('finalize-streaming', async (_event, audioData: unknown) => {
    if (!ctx.pipeline?.running) return null

    const chunk = toValidAudioChunk(audioData)
    if (!chunk) return null

    try {
      return await ctx.pipeline.finalizeStreaming(chunk, 16000)
    } catch (err) {
      log.error('Finalize streaming error:', err)
      return null
    }
  })
}
