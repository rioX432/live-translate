import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { STTBenchmarkEngine } from '../stt-types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = join(__dirname, '..', '..', 'models', 'moonshine')

/** Minimal interface for HuggingFace ASR pipeline */
interface ASRPipeline {
  (audio: Float32Array, options: { sampling_rate: number }): Promise<{ text?: string }>
  dispose(): Promise<void>
}

/**
 * Moonshine benchmark engine using @huggingface/transformers.
 * Runs in-process with ONNX runtime — no Python dependency.
 */
export class MoonshineBench implements STTBenchmarkEngine {
  readonly id = 'moonshine'
  readonly label = 'Moonshine (HuggingFace)'

  private pipeline: ASRPipeline | null = null
  private modelId: string

  constructor(modelId = 'onnx-community/moonshine-base-ONNX') {
    this.modelId = modelId
  }

  async initialize(): Promise<void> {
    if (this.pipeline) return

    console.log(`[moonshine] Loading model: ${this.modelId}`)
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = MODELS_DIR

    this.pipeline = (await pipeline('automatic-speech-recognition', this.modelId, {
      dtype: 'q8'
    })) as unknown as ASRPipeline

    console.log('[moonshine] Model loaded')
  }

  async transcribe(audioPath: string, _language?: string): Promise<string> {
    if (!this.pipeline) throw new Error('Engine not initialized')

    const pcm = readWavAsPcm(audioPath)
    const result = await this.pipeline(pcm, { sampling_rate: 16000 })
    return (result?.text ?? '').trim()
  }

  async dispose(): Promise<void> {
    try {
      await this.pipeline?.dispose()
    } catch (err) {
      console.error('[moonshine] Error during disposal:', err)
    }
    this.pipeline = null
  }
}

/** Read a WAV file and return Float32Array of PCM samples */
function readWavAsPcm(wavPath: string): Float32Array {
  const buffer = readFileSync(wavPath)
  const dataOffset = 44
  const bitsPerSample = buffer.readUInt16LE(34)
  const numSamples = (buffer.length - dataOffset) / (bitsPerSample / 8)

  const samples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    if (bitsPerSample === 16) {
      samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768.0
    } else if (bitsPerSample === 32) {
      samples[i] = buffer.readFloatLE(dataOffset + i * 4)
    }
  }

  return samples
}
