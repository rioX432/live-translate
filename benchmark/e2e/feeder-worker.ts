/**
 * Renderer stand-in on its own thread. The pipeline can block the main thread
 * (whisper.cpp inference did for >20 s in a smoke run), and in the app the renderer
 * keeps capturing regardless, so the 1x clock, VAD and chunker must not share that
 * thread. Memory sampling lives here for the same reason.
 *
 * Every message carries `t`, epoch ms (performance.timeOrigin + now), so the main
 * thread can place events on the same clock.
 */
import { parentPort, workerData } from 'worker_threads'
import { performance } from 'perf_hooks'
import { NodeVad, FRAME_SAMPLES, MS_PER_FRAME } from './vad-node'
import { RollingChunker, DEFAULT_STREAMING_INTERVAL_MS } from './renderer-chunker'
import { MemSampler } from './mem-sampler'

export type FeederMsg =
  | { type: 'started'; t: number }
  | { type: 'vad-start'; t: number }
  | { type: 'vad-end'; t: number; audio: Float32Array }
  | { type: 'vad-misfire'; t: number }
  | { type: 'stream'; t: number; chunk: Float32Array }
  | { type: 'done'; t: number; maxLagMs: number }
  | { type: 'mem'; t: number; summary: unknown }

const port = parentPort!
const epochMs = (): number => performance.timeOrigin + performance.now()
const send = (m: FeederMsg, transfer: ArrayBuffer[] = []): void => port.postMessage(m, transfer)

const mem = new MemSampler()
mem.start()

port.on('message', async (m: { type: string }) => {
  if (m.type === 'start') await feed()
  if (m.type === 'stop-mem') {
    const summary = await mem.stop()
    send({ type: 'mem', t: epochMs(), summary })
  }
})

async function feed(): Promise<void> {
  const audio = new Float32Array(workerData.audio as SharedArrayBuffer)
  const vad = await NodeVad.create()
  const chunker = new RollingChunker()
  const handlers = {
    onFrameProcessed: (frame: Float32Array) => chunker.onFrame(frame),
    onSpeechStart: () => {
      chunker.reset()
      chunker.speaking = true
      send({ type: 'vad-start', t: epochMs() })
    },
    onSpeechEnd: (vadAudio: Float32Array) => {
      chunker.speaking = false
      chunker.reset()
      const copy = vadAudio.slice()
      send({ type: 'vad-end', t: epochMs(), audio: copy }, [copy.buffer as ArrayBuffer])
    },
    onMisfire: () => {
      chunker.speaking = false
      chunker.reset()
      send({ type: 'vad-misfire', t: epochMs() })
    }
  }
  const timer = setInterval(() => {
    const chunk = chunker.tick()
    if (chunk) {
      const copy = chunk.slice()
      send({ type: 'stream', t: epochMs(), chunk: copy }, [copy.buffer as ArrayBuffer])
    }
  }, DEFAULT_STREAMING_INTERVAL_MS)

  // Drift-corrected clock: frame i is processed at t0 + i * 96 ms.
  const nFrames = Math.floor(audio.length / FRAME_SAMPLES)
  let maxLagMs = 0
  const t0 = performance.now()
  send({ type: 'started', t: performance.timeOrigin + t0 })
  for (let i = 0; i < nFrames; i++) {
    const wait = t0 + i * MS_PER_FRAME - performance.now()
    if (wait > 1) await new Promise((r) => setTimeout(r, wait))
    else maxLagMs = Math.max(maxLagMs, -wait)
    await vad.process(audio.slice(i * FRAME_SAMPLES, (i + 1) * FRAME_SAMPLES), handlers)
  }
  clearInterval(timer)
  send({ type: 'done', t: epochMs(), maxLagMs })
}
