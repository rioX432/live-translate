import { readFileSync } from 'fs'
import type { STTBenchmarkEngine } from '../stt-types.js'

/**
 * Moonshine STT benchmark engine using @huggingface/transformers (Node.js, no Python).
 * Matches the app's MoonshineEngine implementation.
 */
export class MoonshineBench implements STTBenchmarkEngine {
  readonly id: string
  readonly label: string

  private pipeline: any = null
  private model: string

  constructor(options?: { model?: string; id?: string; label?: string }) {
    this.model = options?.model ?? 'onnx-community/moonshine-base-ONNX'
    this.id = options?.id ?? 'moonshine'
    this.label = options?.label ?? 'Moonshine (Edge)'
  }

  async initialize(): Promise<void> {
    if (this.pipeline) return

    console.log(`[moonshine] Loading model: ${this.model}...`)
    const { join } = await import('path')
    const { homedir } = await import('os')
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = join(homedir(), '.cache', 'huggingface', 'transformers')

    this.pipeline = await pipeline(
      'automatic-speech-recognition',
      this.model,
      { dtype: 'q8' }
    )
    console.log('[moonshine] Model loaded')
  }

  async transcribe(audioPath: string): Promise<{ text: string; language?: string }> {
    if (!this.pipeline) {
      throw new Error('[moonshine] Not initialized')
    }

    // Read WAV file and extract raw PCM float32 samples
    const wavBuffer = readFileSync(audioPath)
    const float32Data = wavToFloat32(wavBuffer)

    const result = await this.pipeline(float32Data, { sampling_rate: 16000 })
    const text = (result as any).text ?? ''

    return { text: text.trim() }
  }

  async dispose(): Promise<void> {
    if (this.pipeline) {
      await this.pipeline.dispose?.()
      this.pipeline = null
    }
  }
}

/**
 * Parse a 16-bit PCM WAV file into Float32Array.
 * Assumes 16kHz mono WAV (standard for STT).
 */
function wavToFloat32(buffer: Buffer): Float32Array {
  // Find 'data' chunk
  let offset = 12 // skip RIFF header
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    if (chunkId === 'data') {
      const dataStart = offset + 8
      const numSamples = chunkSize / 2 // 16-bit = 2 bytes per sample
      const float32 = new Float32Array(numSamples)
      for (let i = 0; i < numSamples; i++) {
        const sample = buffer.readInt16LE(dataStart + i * 2)
        float32[i] = sample / 32768.0
      }
      return float32
    }
    offset += 8 + chunkSize
  }
  throw new Error('No data chunk found in WAV file')
}
