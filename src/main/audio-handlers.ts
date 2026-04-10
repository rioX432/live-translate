import { ipcMain } from 'electron'
import { sanitizeErrorMessage } from './error-utils'
import { createLogger } from './logger'
import { SAMPLE_RATE } from './constants'
import { MIN_AUDIO_CHUNK_SAMPLES, SILENCE_THRESHOLD } from './audio-constants'
import type { AppContext } from './app-context'

const log = createLogger('audio')

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
  // IPC-level concurrency flags — drop duplicate requests before they reach
  // the pipeline to prevent concurrent native addon calls (#363)
  let processingAudio = false
  let processingStreaming = false
  let processingFinalize = false

  // Process audio chunk from renderer
  ipcMain.handle('process-audio', async (_event, audioData: unknown) => {
    if (!ctx.pipeline?.running) return null
    if (processingAudio) return null

    const chunk = toValidAudioChunk(audioData)
    if (!chunk) return null

    processingAudio = true
    const t0 = performance.now()
    try {
      const result = await ctx.pipeline.process(chunk, SAMPLE_RATE)
      const elapsed = (performance.now() - t0).toFixed(0)
      if (result) log.info(`process-audio: ${elapsed}ms, ${(chunk.length / SAMPLE_RATE).toFixed(1)}s audio`)
      return result
    } catch (err) {
      log.error('Pipeline error:', err)
      const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err))
      ctx.mainWindow?.webContents.send('status-update', `Processing error: ${message}`)
      return null
    } finally {
      processingAudio = false
    }
  })

  // Process streaming audio (rolling buffer during speech)
  ipcMain.handle('process-audio-streaming', async (_event, audioData: unknown) => {
    if (!ctx.pipeline?.running) return null
    // Drop if another streaming call is in-flight — the next interval
    // will resend accumulated audio via the rolling buffer (#363)
    if (processingStreaming) return null

    const chunk = toValidAudioChunk(audioData)
    if (!chunk) return null

    processingStreaming = true
    const t0 = performance.now()
    try {
      const result = await ctx.pipeline.processStreaming(chunk, SAMPLE_RATE)
      const elapsed = (performance.now() - t0).toFixed(0)
      if (result) log.info(`streaming: ${elapsed}ms, ${(chunk.length / SAMPLE_RATE).toFixed(1)}s audio`)
      return result
    } catch (err) {
      log.error('Streaming pipeline error:', err)
      return null
    } finally {
      processingStreaming = false
    }
  })

  // Finalize streaming (speech segment ended)
  ipcMain.handle('finalize-streaming', async (_event, audioData: unknown) => {
    if (!ctx.pipeline?.running) return null
    if (processingFinalize) return null

    const chunk = toValidAudioChunk(audioData)
    if (!chunk) return null

    processingFinalize = true
    const t0 = performance.now()
    try {
      const result = await ctx.pipeline.finalizeStreaming(chunk, SAMPLE_RATE)
      const elapsed = (performance.now() - t0).toFixed(0)
      if (result) log.info(`finalize: ${elapsed}ms, ${(chunk.length / SAMPLE_RATE).toFixed(1)}s audio`)
      return result
    } catch (err) {
      log.error('Finalize streaming error:', err)
      return null
    } finally {
      processingFinalize = false
    }
  })
}
