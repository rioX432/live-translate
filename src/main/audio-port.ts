import { MessageChannelMain } from 'electron'
import { createLogger } from './logger'
import { SAMPLE_RATE } from './constants'
import { MIN_AUDIO_CHUNK_SAMPLES, SILENCE_THRESHOLD } from './audio-constants'
import type { AppContext } from './app-context'

const log = createLogger('audio-port')

/**
 * Set up a MessagePort channel for zero-copy audio transfer between
 * renderer and main process.
 *
 * The renderer sends Float32Array buffers as transferable ArrayBuffers
 * via `port.postMessage()`, avoiding the JSON serialization overhead of
 * the standard `ipcRenderer.invoke('process-audio', Array.from(...))` path.
 *
 * Falls back gracefully — if this setup fails, existing IPC handlers in
 * audio-handlers.ts continue to work.
 */
export function setupAudioPort(ctx: AppContext): void {
  if (!ctx.mainWindow) {
    log.warn('Cannot setup audio port: mainWindow is null')
    return
  }

  try {
    const { port1, port2 } = new MessageChannelMain()

    // IPC-level concurrency flags — drop duplicate requests before they reach
    // the pipeline to prevent concurrent native addon calls (#363)
    let processingAudio = false
    let processingStreaming = false
    let processingFinalize = false

    // Main process receives audio on port1
    port1.on('message', (event) => {
      const { type, audio } = event.data ?? {}
      if (!audio || !type) return

      // Convert from ArrayBuffer to Float32Array
      let chunk: Float32Array
      if (audio instanceof ArrayBuffer) {
        chunk = new Float32Array(audio)
      } else if (Buffer.isBuffer(audio)) {
        chunk = new Float32Array(
          audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)
        )
      } else {
        log.error('Unexpected audio data type on MessagePort:', typeof audio)
        return
      }

      // Silence and minimum length check
      if (chunk.length < MIN_AUDIO_CHUNK_SAMPLES) return
      let maxAmp = 0
      for (let i = 0; i < chunk.length; i++) {
        const abs = Math.abs(chunk[i])
        if (abs > maxAmp) maxAmp = abs
      }
      if (maxAmp < SILENCE_THRESHOLD) return

      // Route to pipeline based on message type
      if (!ctx.pipeline?.running) return

      if (type === 'process-audio') {
        if (processingAudio) return
        processingAudio = true
        const t0 = performance.now()
        ctx.pipeline.process(chunk, SAMPLE_RATE).then((result) => {
          const elapsed = (performance.now() - t0).toFixed(0)
          if (result) log.info(`process-audio (port): ${elapsed}ms, ${(chunk.length / SAMPLE_RATE).toFixed(1)}s audio`)
        }).catch((err) => {
          log.error('Pipeline error (port):', err)
        }).finally(() => {
          processingAudio = false
        })
      } else if (type === 'process-audio-streaming') {
        if (processingStreaming) return
        processingStreaming = true
        const t0 = performance.now()
        ctx.pipeline.processStreaming(chunk, SAMPLE_RATE).then((result) => {
          const elapsed = (performance.now() - t0).toFixed(0)
          if (result) log.info(`streaming (port): ${elapsed}ms, ${(chunk.length / SAMPLE_RATE).toFixed(1)}s audio`)
        }).catch((err) => {
          log.error('Streaming pipeline error (port):', err)
        }).finally(() => {
          processingStreaming = false
        })
      } else if (type === 'finalize-streaming') {
        if (processingFinalize) return
        processingFinalize = true
        const t0 = performance.now()
        ctx.pipeline.finalizeStreaming(chunk, SAMPLE_RATE).then((result) => {
          const elapsed = (performance.now() - t0).toFixed(0)
          if (result) log.info(`finalize (port): ${elapsed}ms, ${(chunk.length / SAMPLE_RATE).toFixed(1)}s audio`)
        }).catch((err) => {
          log.error('Finalize streaming error (port):', err)
        }).finally(() => {
          processingFinalize = false
        })
      }
    })

    port1.start()

    // Send port2 to the renderer via the main window's webContents
    ctx.mainWindow.webContents.postMessage('audio-port', null, [port2])
    log.info('Audio MessagePort channel established')
  } catch (err) {
    log.error('Failed to setup audio MessagePort, falling back to IPC:', err)
  }
}
